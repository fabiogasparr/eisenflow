/**
 * Sessões e rotação de token.
 *
 * O QUE MUDOU NA MIGRAÇÃO
 * -----------------------
 * Este arquivo dependia de duas tabelas (`session_tokens`, `token_rotation_log`)
 * e de RPCs do Postgres (`is_refresh_token_expired`, `revoke_all_user_tokens`,
 * `detect_token_reuse_attack`, `log_token_rotation`, `cleanup_expired_tokens`).
 * NADA disso foi migrado, de propósito:
 *
 * - Sessão é nativa do Appwrite. Criar, listar, expirar e revogar sessão é
 *   trabalho do `account.*` — não existe mais uma tabela paralela de sessões
 *   mantida à mão, que era exatamente a fonte de bugs que este arquivo tentava
 *   remediar.
 * - A rotação do token do GOOGLE (access/refresh do Google Calendar) acontece
 *   agora DENTRO da Function `google-calendar-auth`, no servidor, cifrada com
 *   `node:crypto` e a chave `GOOGLE_TOKENS_ENCRYPTION_KEY`. O cliente não toca
 *   em token do Google em momento nenhum — `google_calendar_tokens` é
 *   server-only.
 *
 * As assinaturas exportadas foram mantidas (menos o parâmetro do cliente de
 * banco, que deixou de existir). O que virou API nativa está implementado; o que não
 * tem equivalente LANÇA erro — nenhuma função aqui finge funcionar em silêncio,
 * porque um controle de segurança que falha calado é pior do que não existir.
 */

import { account } from '@/integrations/appwrite/client';
import type { Models } from 'appwrite';

/** Erro único para tudo que não tem equivalente do lado do cliente. */
function naoMigrado(funcao: string, detalhe: string): never {
  throw new Error(`[tokenRotation] ${funcao}() não existe mais no cliente: ${detalhe}`);
}

/**
 * Gera um id de família de token.
 * Função pura, mantida porque não dependia de banco.
 */
export function generateTokenFamily(): string {
  return `tf_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Antes: marcava token_family/token_generation em google_calendar_tokens.
 * Agora: quem emite e versiona o token do Google é a Function
 * `google-calendar-auth`, no servidor.
 */
export async function initializeTokenRotation(
  _userId: string,
  _refreshTokenExpiresIn: number = 30 * 24 * 60 * 60,
): Promise<void> {
  naoMigrado(
    'initializeTokenRotation',
    'a emissão do token do Google acontece dentro da Function google-calendar-auth; ' +
      'google_calendar_tokens é server-only.',
  );
}

/**
 * Antes: reescrevia access/refresh token cifrados na tabela.
 * Agora: a Function `google-calendar-auth` renova e regrava o token quando ele
 * expira. O navegador nunca vê o valor.
 */
export async function rotateRefreshToken(
  _userId: string,
  _newAccessToken: string,
  _accessTokenExpiresIn: number = 3600,
  _newRefreshToken?: string,
  _refreshTokenExpiresIn: number = 30 * 24 * 60 * 60,
): Promise<boolean> {
  naoMigrado(
    'rotateRefreshToken',
    'a rotação do token do Google é feita no servidor pela Function google-calendar-auth.',
  );
}

/**
 * Antes: RPC is_refresh_token_expired.
 * A validade do token do Google só é conhecida pelo servidor; responder daqui
 * seria chute.
 */
export async function isRefreshTokenExpired(_userId: string): Promise<boolean> {
  naoMigrado(
    'isRefreshTokenExpired',
    'só a Function google-calendar-auth conhece a validade do refresh token.',
  );
}

/**
 * Revoga TODAS as sessões do usuário logado — o equivalente nativo do
 * `revoke_all_user_tokens`. Note que o Appwrite age sobre a conta da sessão
 * atual: não dá (nem deve dar) para derrubar as sessões de outro usuário a
 * partir do cliente.
 */
export async function revokeAllTokens(
  userId?: string,
  reason: string = 'User requested revocation',
): Promise<void> {
  const me = await account.get();
  if (userId && userId !== me.$id) {
    naoMigrado(
      'revokeAllTokens',
      'derrubar a sessão de OUTRO usuário exige API key de servidor (Users API).',
    );
  }
  await account.deleteSessions();
  console.log(`Todas as sessões revogadas para ${me.$id}. Motivo: ${reason}`);
}

/**
 * Antes: RPC log_token_rotation gravando em token_rotation_log.
 * A tabela não foi migrada; a auditoria de token vive no servidor
 * (`google_token_audit_log`, escrita pelas Functions).
 */
export async function logTokenRotation(
  _userId: string,
  _tokenType: 'access' | 'refresh' | 'all',
  _action: 'issued' | 'rotated' | 'expired' | 'revoked' | 'refreshed',
  _tokenFamily?: string | null,
  _generation?: number | null,
  _ipAddress?: string | null,
  _userAgent?: string | null,
  _reason?: string | null,
): Promise<void> {
  naoMigrado(
    'logTokenRotation',
    'token_rotation_log não foi migrada; a auditoria é escrita pelas Functions em google_token_audit_log.',
  );
}

/**
 * Antes: SELECT em token_rotation_log.
 */
export async function getTokenRotationHistory(
  _userId: string,
  _hoursBack: number = 168,
): Promise<never[]> {
  naoMigrado(
    'getTokenRotationHistory',
    'token_rotation_log não foi migrada; exponha o histórico por uma Function se ele voltar a ser necessário.',
  );
}

/**
 * Antes: RPC detect_token_reuse_attack.
 * TODO(migração): não há equivalente. Detecção de reuso de token de sessão é
 * responsabilidade do servidor (Appwrite invalida a sessão sozinho); se o
 * produto precisar do sinal, ele tem que nascer numa Function com acesso aos
 * logs de sessão, nunca no cliente.
 */
export async function detectTokenReuseAttack(
  _sessionId: string,
  _ipAddress: string,
  _userAgent: string,
): Promise<boolean> {
  naoMigrado('detectTokenReuseAttack', 'sem equivalente no cliente — ver TODO(migração) acima.');
}

/**
 * Antes: INSERT em session_tokens.
 * Agora: sessão se cria fazendo login (`signIn` / `signInWithOAuth`). O cliente
 * não emite sessão avulsa.
 */
export async function createSessionToken(
  _userId: string,
  _expiresInSeconds: number = 3600,
  _ipAddress?: string,
  _userAgent?: string,
): Promise<{ session_id: string; token_family: string }> {
  naoMigrado(
    'createSessionToken',
    'sessão do Appwrite nasce do login (account.createEmailPasswordSession), não de um INSERT.',
  );
}

/**
 * Revoga UMA sessão — equivalente nativo do antigo `is_revoked = true`.
 * `sessionId` é o `$id` da sessão (ou 'current' para a sessão atual).
 */
export async function revokeSessionToken(sessionId: string): Promise<boolean> {
  try {
    await account.deleteSession(sessionId);
    return true;
  } catch (err) {
    console.error('Failed to revoke session:', err);
    return false;
  }
}

/**
 * Sessões ativas do usuário logado — equivalente nativo do SELECT em
 * session_tokens. O Appwrite já exclui as expiradas.
 */
export async function getActiveSessionTokens(_userId?: string): Promise<Models.Session[]> {
  try {
    const r = await account.listSessions();
    return r.sessions;
  } catch (err) {
    console.error('Failed to list sessions:', err);
    return [];
  }
}

/**
 * Limpeza de tokens expirados.
 *
 * VALOR NEUTRO DOCUMENTADO: devolve sempre 0 porque o Appwrite expira sessão
 * sozinho — não existe fila de limpeza para o cliente rodar. Mantida só para
 * não quebrar quem chamava; pode ser removida com segurança.
 */
export async function cleanupExpiredTokens(): Promise<number> {
  return 0;
}

/**
 * A sessão ainda vale? Responde com a lista nativa de sessões, comparando o
 * `$id` e a data de expiração que o próprio Appwrite devolve.
 */
export async function isSessionTokenValid(sessionId: string): Promise<boolean> {
  try {
    const sessions = await getActiveSessionTokens();
    const s = sessions.find((x) => x.$id === sessionId);
    if (!s) return false;
    return !s.expire || new Date(s.expire) > new Date();
  } catch (err) {
    console.error('Failed to validate session:', err);
    return false;
  }
}
