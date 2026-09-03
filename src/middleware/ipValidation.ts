/**
 * Validação de IP.
 *
 * O QUE MUDOU NA MIGRAÇÃO
 * -----------------------
 * As collections `ip_whitelist`, `ip_access_log` e `suspicious_ips` existem
 * (grupo `extras`), mas são server-only / server-doc: O CLIENTE NÃO ESCREVE
 * NELAS. As RPCs `is_ip_allowed`, `log_ip_access` e `report_suspicious_ip` eram
 * funções SQL e não foram migradas.
 *
 * O que ficou aqui é a checagem que faz sentido no navegador: LER a whitelist do
 * tenant e comparar com um IP, para a UI conseguir dizer "esse IP não vai
 * passar" antes de tentar. O BLOQUEIO DE VERDADE É DO SERVIDOR — rate limit e
 * bloqueio por IP são nativos do Appwrite, e a Function `hermes-mcp` é quem
 * confere a whitelist ao atender uma chave de API de tenant. Nada do que está
 * neste arquivo protege recurso nenhum sozinho.
 *
 * As funções que só existiam para ESCREVER no banco lançam erro, com TODO
 * apontando a Function que precisaria existir.
 */

import { listDocs, Query } from '@/integrations/appwrite/database';

export interface IPAccessOptions {
  enforceWhitelist?: boolean;
  logAllAccess?: boolean;
  autoBlockThreshold?: number;
}

/**
 * Extrai o IP do cliente de uma requisição (considerando proxies).
 * Função pura — continua igual.
 */
export function getClientIP(req: any): string {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress || 'unknown';
  return ip;
}

/** O IP cabe na entrada da whitelist? Aceita IP exato ou CIDR IPv4. */
function ipCombina(entrada: string, ip: string): boolean {
  if (!entrada) return false;
  if (entrada === ip) return true;
  if (!entrada.includes('/')) return false;

  const [rede, prefixoStr] = entrada.split('/');
  const prefixo = Number(prefixoStr);
  const paraInt = (v: string) => {
    const o = v.split('.').map(Number);
    if (o.length !== 4 || o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
    return ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
  };

  const a = paraInt(rede);
  const b = paraInt(ip);
  if (a === null || b === null || Number.isNaN(prefixo) || prefixo < 0 || prefixo > 32) return false;

  const mascara = prefixo === 0 ? 0 : (0xffffffff << (32 - prefixo)) >>> 0;
  return (a & mascara) === (b & mascara);
}

/**
 * O IP está liberado para o tenant?
 *
 * Antes: RPC `is_ip_allowed`. Agora: leitura da whitelist (o servidor concede
 * leitura por documento) e comparação em memória. Mantém o "fail open" do
 * original — inclusive porque um `false` daqui não bloquearia nada de verdade.
 *
 * Regra preservada do SQL antigo: tenant SEM nenhuma entrada ativa = tudo
 * liberado; com entradas, só o que casar.
 */
export async function isIPAllowed(tenantId: string, ipAddress: string): Promise<boolean> {
  try {
    const entradas = await listDocs('ip_whitelist', [
      Query.equal('tenant_id', tenantId),
      Query.equal('is_active', true),
      Query.limit(100),
    ]);

    if (entradas.length === 0) return true;
    return entradas.some((e) => ipCombina(e.ip_address, ipAddress));
  } catch (err) {
    console.error('IP validation check failed:', err);
    // Fail open: sem leitura da whitelist, quem decide é o servidor.
    return true;
  }
}

/**
 * Diagnóstico local. O log oficial de acesso por IP é `ip_access_log`, escrito
 * pelo servidor — o cliente não grava lá.
 */
export function logIPAccess(
  tenantId: string,
  ipAddress: string,
  endpoint: string,
  method: string,
  allowed: boolean,
  reason?: string,
): void {
  console.debug('[ipValidation]', { tenantId, ipAddress, endpoint, method, allowed, reason });
}

/**
 * `suspicious_ips` é server-only (no Postgres esta tabela ficou até SEM RLS).
 *
 * TODO(migração): reportar IP suspeito precisa virar uma Function; do cliente
 * qualquer um poderia sujar a lista de reputação.
 */
export async function reportSuspiciousIP(
  _ipAddress: string,
  _threatLevel: 'low' | 'medium' | 'high' | 'critical',
  _reason: string,
): Promise<void> {
  throw new Error(
    '[ipValidation] reportSuspiciousIP() não existe no cliente: suspicious_ips é server-only. ' +
      'Ver TODO(migração).',
  );
}

/**
 * `ip_whitelist` é server-doc: só a API key cria/edita documento.
 *
 * TODO(migração): a tela de admin precisa de uma Function (com checagem de papel
 * no tenant) para incluir e remover IP da whitelist.
 */
export async function addIPToWhitelist(
  _tenantId: string,
  _ipAddress: string,
  _description?: string,
): Promise<boolean> {
  throw new Error(
    '[ipValidation] addIPToWhitelist() não existe no cliente: ip_whitelist é server-doc. ' +
      'Ver TODO(migração).',
  );
}

/** Mesmo caso de addIPToWhitelist. */
export async function removeIPFromWhitelist(
  _tenantId: string,
  _ipAddress: string,
): Promise<boolean> {
  throw new Error(
    '[ipValidation] removeIPFromWhitelist() não existe no cliente: ip_whitelist é server-doc. ' +
      'Ver TODO(migração).',
  );
}

/**
 * Middleware compatível com Express/Fastify, agora sem escrita em banco.
 * Serve como filtro de conveniência; o bloqueio autoritativo é do servidor.
 */
export function createIPValidationMiddleware(options: IPAccessOptions = {}) {
  const { logAllAccess = true } = options;

  return async (req: any, res: any, next: any) => {
    try {
      const ipAddress = getClientIP(req);
      const tenantId = req.headers['x-tenant-id'] || req.user?.tenant_id;

      if (!tenantId) {
        // Sem contexto de tenant não há whitelist a aplicar.
        return next();
      }

      const allowed = await isIPAllowed(tenantId, ipAddress);

      if (!allowed) {
        if (logAllAccess) {
          logIPAccess(tenantId, ipAddress, req.path || req.url, req.method, false, 'IP not in whitelist');
        }

        return res.status(403).json({
          error: 'Forbidden',
          message: 'Your IP address is not authorized to access this resource.',
        });
      }

      if (logAllAccess) {
        logIPAccess(tenantId, ipAddress, req.path || req.url, req.method, true, 'IP in whitelist');
      }

      req.clientIP = ipAddress;
      req.ipAllowed = allowed;

      next();
    } catch (error) {
      console.error('IP validation middleware error:', error);
      // Fail open.
      next();
    }
  };
}

/**
 * Log de acesso de um IP — LEITURA continua possível quando o servidor concedeu
 * permissão nos documentos (server-doc). A coluna `timestamp` do Postgres virou
 * `created_at`, padrão de toda collection.
 */
export async function getIPAccessLogs(
  tenantId: string,
  ipAddress: string,
  hoursBack: number = 24,
  limit: number = 100,
) {
  try {
    const desde = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
    return await listDocs('ip_access_log', [
      Query.equal('tenant_id', tenantId),
      Query.equal('ip_address', ipAddress),
      Query.greaterThanEqual('created_at', desde),
      Query.orderDesc('created_at'),
      Query.limit(Math.min(limit, 100)), // teto de 100 documentos por request
    ]);
  } catch (err) {
    console.error('Failed to get IP access logs:', err);
    return [];
  }
}

/**
 * IPs liberados de um tenant (só leitura).
 */
export async function getWhitelistedIPs(tenantId: string) {
  try {
    return await listDocs('ip_whitelist', [
      Query.equal('tenant_id', tenantId),
      Query.equal('is_active', true),
      Query.orderDesc('created_at'),
      Query.limit(100),
    ]);
  } catch (err) {
    console.error('Failed to get whitelisted IPs:', err);
    return [];
  }
}

/**
 * Reputação de IP: `suspicious_ips` é server-only, o cliente nem lê.
 * Devolver "sem ameaça" daqui seria dar uma garantia falsa.
 *
 * TODO(migração): expor por Function caso a UI de segurança volte a existir.
 */
export async function checkIPReputation(_ipAddress: string): Promise<{
  isBlockedExternallyBlacklisted: boolean;
  threatLevel?: 'low' | 'medium' | 'high' | 'critical';
  failedAttempts: number;
}> {
  throw new Error(
    '[ipValidation] checkIPReputation() não existe no cliente: suspicious_ips é server-only. ' +
      'Ver TODO(migração).',
  );
}

/**
 * Formato de endereço IP. Função pura — continua igual.
 */
export function isValidIPAddress(ip: string): boolean {
  const ipv4Regex =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::)$/;

  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
}

/**
 * Sub-rede CIDR de um IP (para liberar uma faixa). Função pura — continua igual.
 */
export function getCIDRSubnet(ipAddress: string, prefixLength: number = 24): string {
  const parts = ipAddress.split('.');
  if (parts.length !== 4) return ipAddress;

  const octets = parts.map((p) => parseInt(p, 10));
  const maskBits = 32 - prefixLength;
  const mask = (0xffffffff << maskBits) >>> 0;

  const subnet = [
    (octets[0] & (mask >> 24)) & 0xff,
    (octets[1] & (mask >> 16)) & 0xff,
    (octets[2] & (mask >> 8)) & 0xff,
    octets[3] & mask & 0xff,
  ];

  return `${subnet.join('.')}/${prefixLength}`;
}
