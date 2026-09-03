/**
 * Rate limiting.
 *
 * O QUE MUDOU NA MIGRAÇÃO
 * -----------------------
 * O ENFORCEMENT DE VERDADE É DO SERVIDOR. O Appwrite já aplica rate limit por
 * IP/endpoint nativamente, e o limite por chave de API de tenant é aplicado
 * dentro da Function `hermes-mcp`, que é a única com permissão para escrever em
 * `rate_limit_buckets` / `rate_limit_events` (ambas server-only no Appwrite).
 *
 * Este arquivo passou a ser uma cortesia do lado do cliente: um token bucket EM
 * MEMÓRIA, que evita disparar rajada de requisição e ajuda a UI a mostrar
 * "calma aí" antes de tomar 429. Ele não protege nada sozinho — quem for
 * malicioso simplesmente não roda este código. As funções que só faziam sentido
 * como controle de servidor (bloquear chave, bloquear IP, ler o log de eventos)
 * lançam erro em vez de fingir que agiram.
 *
 * Saiu: a RPC `check_rate_limit` e toda escrita em `rate_limit_buckets` /
 * `rate_limit_events`. Nenhuma escrita em banco a partir do cliente.
 */

export interface RateLimitConfig {
  tokensPerMinute: number;
  warningThreshold: number; // fração do limite que dispara o aviso
  blockDurationMinutes: number;
}

export interface RateLimitResult {
  allowed: boolean;
  tokensRemaining: number;
  resetAfterSeconds: number;
  status: 'allowed' | 'blocked' | 'warning';
  retryAfterSeconds?: number;
}

export const DEFAULT_CONFIG: RateLimitConfig = {
  tokensPerMinute: 120, // capacidade do balde
  warningThreshold: 0.2, // 20% restante já avisa
  blockDurationMinutes: 60,
};

/** Reposição: 2 fichas por minuto, como era o refill_rate da tabela. */
const REFILL_PER_MINUTE = 2;

interface Bucket {
  tokens: number;
  capacity: number;
  refillPerMinute: number;
  lastRefill: number;
  totalRequests: number;
  blockedRequests: number;
}

/** Estado local do processo. Some a cada reload — e tudo bem: é só cortesia. */
const buckets = new Map<string, Bucket>();

function ensureBucket(key: string, config: RateLimitConfig = DEFAULT_CONFIG): Bucket {
  let b = buckets.get(key);
  if (!b) {
    b = {
      tokens: config.tokensPerMinute,
      capacity: config.tokensPerMinute,
      refillPerMinute: REFILL_PER_MINUTE,
      lastRefill: Date.now(),
      totalRequests: 0,
      blockedRequests: 0,
    };
    buckets.set(key, b);
  }
  return b;
}

function refill(b: Bucket): void {
  const agora = Date.now();
  const minutos = (agora - b.lastRefill) / 60000;
  if (minutos <= 0) return;
  b.tokens = Math.min(b.capacity, b.tokens + minutos * b.refillPerMinute);
  b.lastRefill = agora;
}

/**
 * Cabeçalhos de rate limit para uma resposta. Inalterado — é só formatação.
 */
export function getRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(DEFAULT_CONFIG.tokensPerMinute),
    'X-RateLimit-Remaining': String(result.tokensRemaining),
    'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + result.resetAfterSeconds),
    ...(result.status === 'blocked' && {
      'Retry-After': String(result.retryAfterSeconds || result.resetAfterSeconds),
    }),
  };
}

/**
 * Cria (ou reinicia) o balde local de uma chave.
 * Antes fazia INSERT em `rate_limit_buckets`; a collection é server-only, então
 * agora isso só existe na memória deste cliente.
 */
export async function initializeRateLimit(
  apiKey: string,
  config: RateLimitConfig = DEFAULT_CONFIG,
): Promise<void> {
  if (!apiKey) return;
  buckets.delete(apiKey);
  ensureBucket(apiKey, config);
}

/**
 * Consome fichas do balde local.
 *
 * Mantém a semântica de "fail open" do original: qualquer imprevisto deixa a
 * requisição passar, porque o servidor é quem tem a palavra final.
 */
export async function checkRateLimit(
  apiKey: string,
  tokensNeeded: number = 1,
  _ipAddress?: string,
): Promise<RateLimitResult> {
  try {
    // Sem chave não há balde: era o comportamento antigo quando a RPC devolvia
    // vazio — trata como bloqueado.
    if (!apiKey) {
      return {
        allowed: false,
        tokensRemaining: 0,
        resetAfterSeconds: 60,
        status: 'blocked',
        retryAfterSeconds: 60,
      };
    }

    const b = ensureBucket(apiKey);
    refill(b);
    b.totalRequests += 1;

    if (b.tokens < tokensNeeded) {
      b.blockedRequests += 1;
      const faltam = tokensNeeded - b.tokens;
      const espera = Math.ceil((faltam / b.refillPerMinute) * 60);
      return {
        allowed: false,
        tokensRemaining: Math.floor(b.tokens),
        resetAfterSeconds: espera,
        status: 'blocked',
        retryAfterSeconds: espera,
      };
    }

    b.tokens -= tokensNeeded;
    const restantes = Math.floor(b.tokens);
    const avisando = restantes <= b.capacity * DEFAULT_CONFIG.warningThreshold;

    return {
      allowed: true,
      tokensRemaining: restantes,
      resetAfterSeconds: 60,
      status: avisando ? 'warning' : 'allowed',
    };
  } catch (error) {
    console.error('Unexpected error in checkRateLimit:', error);
    // Fail open: o enforcement real é do servidor.
    return {
      allowed: true,
      tokensRemaining: tokensNeeded,
      resetAfterSeconds: 60,
      status: 'allowed',
    };
  }
}

/**
 * Diagnóstico local. NÃO é auditoria: o registro oficial de eventos é escrito
 * pelo servidor em `rate_limit_events`, collection server-only.
 */
export function logRateLimitEvent(
  apiKey: string,
  endpoint: string,
  method: string,
  status: 'allowed' | 'blocked' | 'warning',
  tokensRemaining: number,
): void {
  console.debug('[rateLimit]', { apiKey: apiKey.slice(0, 8), endpoint, method, status, tokensRemaining });
}

/**
 * Bloquear uma chave de API é decisão de servidor: `rate_limit_buckets` é
 * server-only e quem escreve nela é a Function `hermes-mcp`.
 *
 * TODO(migração): se a UI de admin precisar disso, criar uma action na Function
 * que valide o papel do usuário no tenant antes de bloquear.
 */
export async function blockApiKey(_apiKey: string, _reason?: string): Promise<void> {
  throw new Error(
    '[rateLimit] blockApiKey() não existe no cliente: rate_limit_buckets é server-only. ' +
      'Ver TODO(migração) — precisa virar action de Function.',
  );
}

/**
 * Idem para IP: `suspicious_ips` é server-only e o bloqueio por IP já é nativo
 * do Appwrite.
 */
export async function blockIpAddress(
  _ipAddress: string,
  _durationMinutes: number = 60,
): Promise<void> {
  throw new Error(
    '[rateLimit] blockIpAddress() não existe no cliente: bloqueio por IP é nativo do Appwrite ' +
      'e suspicious_ips é server-only.',
  );
}

/**
 * Estatísticas do balde LOCAL — não é o contador do servidor.
 * `isBlocked` aqui significa apenas "este cliente está sem fichas agora".
 */
export async function getRateLimitStats(apiKey: string): Promise<{
  tokensRemaining: number;
  totalRequests: number;
  blockedRequests: number;
  isBlocked: boolean;
  blockReason?: string;
}> {
  const b = ensureBucket(apiKey);
  refill(b);
  return {
    tokensRemaining: Math.floor(b.tokens),
    totalRequests: b.totalRequests,
    blockedRequests: b.blockedRequests,
    isBlocked: b.tokens < 1,
    blockReason: b.tokens < 1 ? 'Balde local sem fichas' : undefined,
  };
}

/**
 * O histórico de eventos vive em `rate_limit_events`, que o cliente não lê.
 *
 * TODO(migração): expor por uma Function de relatório se a tela de monitoramento
 * for retomada.
 */
export async function getRateLimitEvents(
  _apiKey: string,
  _hoursBack: number = 24,
  _status?: 'allowed' | 'blocked' | 'warning',
): Promise<never[]> {
  throw new Error(
    '[rateLimit] getRateLimitEvents() não existe no cliente: rate_limit_events é server-only. ' +
      'Ver TODO(migração).',
  );
}

/**
 * Middleware compatível com Express/Fastify, agora sem banco.
 * Uso: `app.use(createRateLimitMiddleware())`.
 *
 * Continua útil num processo Node de front (SSR/proxy), mas o limite autoritativo
 * é o do Appwrite e o da Function `hermes-mcp`.
 */
export function createRateLimitMiddleware() {
  return async (req: any, res: any, next: any) => {
    try {
      const apiKey = req.headers['x-api-key'] || req.headers.authorization?.split(' ')[1];

      if (!apiKey) {
        // Sem chave: pode ser endpoint público.
        return next();
      }

      const result = await checkRateLimit(apiKey, 1);

      const headers = getRateLimitHeaders(result);
      Object.entries(headers).forEach(([key, value]) => {
        res.setHeader(key, value);
      });

      if (!result.allowed) {
        logRateLimitEvent(apiKey, req.path || req.url, req.method, 'blocked', result.tokensRemaining);
        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: 'Too many requests. Please try again later.',
          retryAfter: result.retryAfterSeconds,
        });
      }

      if (result.status === 'warning') {
        logRateLimitEvent(apiKey, req.path || req.url, req.method, 'warning', result.tokensRemaining);
      }

      req.rateLimit = result;
      next();
    } catch (error) {
      console.error('Rate limit middleware error:', error);
      // Fail open.
      next();
    }
  };
}

/**
 * Detectar abuso e bloquear é papel de quem vê TODOS os clientes — ou seja, do
 * servidor. Um balde em memória enxerga só a própria aba.
 *
 * TODO(migração): mover para a Function `hermes-mcp`, que já lê os contadores
 * reais em rate_limit_buckets.
 */
export async function detectAndBlockSuspiciousActivity(_apiKey: string): Promise<boolean> {
  throw new Error(
    '[rateLimit] detectAndBlockSuspiciousActivity() não existe no cliente: a detecção precisa dos ' +
      'contadores globais de rate_limit_buckets (server-only). Ver TODO(migração).',
  );
}
