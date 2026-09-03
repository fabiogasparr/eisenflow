/**
 * Camada de acesso ao Google Calendar compartilhada por google-calendar-auth e
 * google-calendar-sync: busca do token do tenant, refresh automático, chamada
 * REST e trilha de auditoria.
 *
 * DECISÃO DE ARQUITETURA (multi-tenant): existe UM app OAuth do EisenFlow no
 * Google Cloud (GOOGLE_CLIENT_ID/SECRET) e CADA TENANT conecta a própria conta
 * Google. Ou seja: N contas Google, 1 client_id. A conexão é identificada pelo
 * par (user_id, tenant_id) — o mesmo usuário pode conectar contas diferentes em
 * tenants diferentes.
 *
 * Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_TOKENS_ENCRYPTION_KEY,
 *      PUBLIC_WEBHOOK_BASE_URL
 */
import { db, Query, rawCall, DATABASE_ID } from './appwrite.js';
import { cifrar, decifrar } from './cripto.js';

export const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** Renova quando falta menos que isto para expirar. */
const MARGEM_REFRESH_MS = 5 * 60 * 1000;

/**
 * Escopos: o mínimo que o app usa de fato.
 *  - calendar.events   : criar/editar/apagar eventos (export de tarefas)
 *  - calendar.readonly : listar calendários e ler eventos (import)
 * O original pedia o escopo `calendar` inteiro (leitura+escrita+ACL) e ainda
 * `userinfo.email`; o e-mail já vem no id_token, então foi dispensado.
 */
export const ESCOPOS = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');

export function credenciais() {
  const client_id = process.env.GOOGLE_CLIENT_ID;
  const client_secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!client_id || !client_secret) {
    const e = new Error('GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET não configurados');
    e.status = 500; throw e;
  }
  return { client_id, client_secret };
}

/**
 * O redirect_uri É a URL pública desta própria function.
 * ATENÇÃO OPERACIONAL: esta URL exata precisa estar cadastrada em
 * "Authorized redirect URIs" no Google Cloud Console (APIs & Services →
 * Credentials → o OAuth client do EisenFlow). Se não estiver, o Google devolve
 * redirect_uri_mismatch antes mesmo de mostrar a tela de consentimento.
 */
export function redirectUri() {
  const base = (process.env.PUBLIC_WEBHOOK_BASE_URL || '').replace(/\/+$/, '');
  if (!base) { const e = new Error('PUBLIC_WEBHOOK_BASE_URL não configurada'); e.status = 500; throw e; }
  return `${base}/google-calendar-auth?action=callback`;
}

/** Erro que o front traduz em "reconecte sua conta Google". */
export function erroReconectar(motivo = 'acesso revogado no Google') {
  const e = new Error(`Conexão com o Google Calendar inválida (${motivo}). Reconecte sua conta Google.`);
  e.status = 409;
  e.codigo = 'google_reconnect_required';
  return e;
}

// ------------------------------------------------------------------- tokens
/** Conexão do par (user_id, tenant_id). Null se nunca conectou. */
export function buscarConexao(tenantId, userId) {
  return db.findOne('google_calendar_tokens', [
    Query.equal('tenant_id', tenantId),
    Query.equal('user_id', userId),
  ]);
}

/**
 * Devolve { accessToken, calendarId, doc } com o token já válido.
 * Renova se faltar menos de 5 min para expirar e regrava cifrado.
 */
export async function acessoValido(doc, { log } = {}) {
  if (!doc) throw erroReconectar('nenhuma conta conectada');
  if (doc.is_revoked) throw erroReconectar(doc.revoked_reason || 'conexão revogada');

  const expiraEm = new Date(doc.token_expires_at).getTime();
  if (Number.isFinite(expiraEm) && expiraEm - Date.now() > MARGEM_REFRESH_MS) {
    return { accessToken: decifrar(doc.access_token), calendarId: doc.calendar_id || 'primary', doc };
  }

  const refresh = decifrar(doc.refresh_token);
  if (!refresh) throw erroReconectar('sem refresh_token gravado');

  const { client_id, client_secret } = credenciais();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id, client_secret, refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // invalid_grant = o usuário removeu o acesso do EisenFlow na conta Google
    // (myaccount.google.com → Segurança → Apps de terceiros). O refresh_token
    // está morto para sempre; insistir só gera erro. Marcamos e pedimos reconexão.
    if (data.error === 'invalid_grant') {
      await marcarRevogado(doc, 'invalid_grant: acesso removido na conta Google');
      throw erroReconectar('invalid_grant');
    }
    const e = new Error(`falha ao renovar token do Google: ${data.error_description || data.error || res.status}`);
    e.status = 502; throw e;
  }

  const novoExpira = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString();
  const patch = { access_token: cifrar(data.access_token), token_expires_at: novoExpira };
  // O Google só reemite refresh_token em raras rotações; quando vem, guardamos.
  if (data.refresh_token) patch.refresh_token = cifrar(data.refresh_token);

  const atualizado = await db.update('google_calendar_tokens', doc.$id, patch);
  await auditar({ userId: doc.user_id, tenantId: doc.tenant_id, acao: 'refresh' });
  log?.(`google: token renovado para tenant ${doc.tenant_id}`);

  return { accessToken: data.access_token, calendarId: atualizado.calendar_id || 'primary', doc: atualizado };
}

export function marcarRevogado(doc, motivo) {
  return db.update('google_calendar_tokens', doc.$id, {
    is_revoked: true,
    revoked_at: new Date().toISOString(),
    revoked_reason: String(motivo).slice(0, 500),
  }).catch(() => null); // auditoria não pode derrubar o fluxo principal
}

// ---------------------------------------------------------------- API REST
/**
 * Chamada à API do Calendar já autenticada. 401/403 com token válido significa
 * consentimento retirado no meio do caminho -> mesmo tratamento do invalid_grant.
 */
export async function chamarGoogle(accessToken, caminho, opcoes = {}, doc = null) {
  const res = await fetch(`${GOOGLE_CALENDAR_API}${caminho}`, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(opcoes.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opcoes.headers || {}),
    },
  });

  if (res.status === 204) return {};
  const txt = await res.text();
  let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }

  if (!res.ok) {
    if ((res.status === 401 || res.status === 403) && doc) {
      await marcarRevogado(doc, `Google respondeu ${res.status}`);
      throw erroReconectar(`HTTP ${res.status}`);
    }
    const e = new Error(`Google API [${res.status}]: ${data?.error?.message || txt.slice(0, 200)}`);
    e.status = res.status >= 500 ? 502 : 400;
    e.googleStatus = res.status;
    throw e;
  }
  return data;
}

// --------------------------------------------------------------- auditoria
/**
 * Trilha em google_token_audit_log (grupo extras). Nunca lança: se a collection
 * de extras não foi criada no servidor, o fluxo principal continua.
 */
export async function auditar({ userId, tenantId, acao, req = null }) {
  try {
    const dados = { user_id: userId, action: acao, created_at: new Date().toISOString() };
    if (tenantId) dados.tenant_id = tenantId;
    const ip = (req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    if (ip) dados.ip_address = ip.slice(0, 45);
    const ua = req?.headers?.['user-agent'];
    if (ua) dados.user_agent = String(ua).slice(0, 500);

    // rawCall em vez de db.create: db.create carimba updated_at, e esta
    // collection só tem created_at — o Appwrite rejeitaria o atributo extra.
    await rawCall('POST', `/databases/${DATABASE_ID}/collections/google_token_audit_log/documents`, {
      documentId: 'unique()', data: dados,
    });
  } catch { /* auditoria é best-effort: nunca derruba o fluxo principal */ }
}
