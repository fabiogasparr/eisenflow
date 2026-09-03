/**
 * Verificação de identidade dentro de uma Appwrite Function.
 *
 * O Appwrite entrega o usuário de duas formas:
 *  1. Header `x-appwrite-user-id` — preenchido quando a function é chamada pelo
 *     SDK do cliente com sessão ativa. É o caminho normal do frontend.
 *  2. Header `x-appwrite-user-jwt` — quando o cliente gera um JWT
 *     (account.createJWT()). Validamos chamando /account com o JWT.
 *
 * Substitui `supabase.auth.getUser()` / `getClaims()` das Edge Functions.
 */
import { rawCall, ENDPOINT, PROJECT } from './appwrite.js';

export async function getUser(req) {
  const h = req.headers || {};
  const userId = h['x-appwrite-user-id'];
  const jwt = h['x-appwrite-user-jwt'] || (h.authorization || '').replace(/^Bearer\s+/i, '');

  if (jwt) {
    const res = await fetch(`${ENDPOINT}/account`, {
      headers: { 'X-Appwrite-Project': PROJECT, 'X-Appwrite-JWT': jwt },
    });
    if (res.ok) return res.json();
  }
  if (userId) {
    try { return await rawCall('GET', `/users/${userId}`); } catch { /* ignora */ }
  }
  return null;
}

export async function requireUser(req) {
  const user = await getUser(req);
  if (!user) { const e = new Error('Não autenticado'); e.status = 401; throw e; }
  return user;
}

/**
 * Equivalente às funções is_tenant_member / get_tenant_role / is_tenant_admin.
 * Consulta a collection tenant_members (fonte da verdade dos papéis).
 */
export async function getTenantRole(db, tenantId, userId) {
  const { Query } = await import('./appwrite.js');
  const m = await db.findOne('tenant_members', [
    Query.equal('tenant_id', tenantId),
    Query.equal('user_id', userId),
  ]);
  return m?.role ?? null;
}

export async function requireTenantAdmin(db, tenantId, userId) {
  const role = await getTenantRole(db, tenantId, userId);
  if (!['owner', 'admin'].includes(role)) {
    const e = new Error('Requer papel owner/admin no tenant'); e.status = 403; throw e;
  }
  return role;
}

/** Autenticação por API key de tenant (usada pelo hermes-mcp). */
export async function authenticateTenantApiKey(db, rawKey) {
  const { Query } = await import('./appwrite.js');
  const { createHash } = await import('node:crypto');
  if (!rawKey) { const e = new Error('API key ausente'); e.status = 401; throw e; }

  const hash = createHash('sha256').update(rawKey).digest('hex');
  const key = await db.findOne('tenant_api_keys', [Query.equal('key_hash', hash)]);
  if (!key) { const e = new Error('API key inválida'); e.status = 401; throw e; }
  if (key.revoked_at) { const e = new Error('API key revogada'); e.status = 401; throw e; }
  if (key.expires_at && new Date(key.expires_at) < new Date()) {
    const e = new Error('API key expirada'); e.status = 401; throw e;
  }
  return key;
}
