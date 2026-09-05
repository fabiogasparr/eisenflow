/**
 * Camada de acesso ao Google Calendar compartilhada por google-calendar-auth e
 * google-calendar-sync: busca do token do tenant, refresh automático, chamada
 * REST e trilha de auditoria.
 *
 * DECISÃO DE ARQUITETURA (multi-tenant): existe UM app OAuth do EisenFlow no
 * Google Cloud (GOOGLE_CLIENT_ID/SECRET) e CADA TENANT conecta a própria conta
 * Google. Ou seja: N contas Google, 1 client_id. A conexão é identificada pelo
 * par (user_id, tenant_id) — o mesmo usuário pode conectar contas diferentes em
 * tenants diferentes. Porte de functions/_shared/google.js.
 *
 * Colunas usadas em google_calendar_tokens (a migration nova adiciona
 * tenant_id, is_revoked, revoked_at, revoked_reason e a unique (user_id, tenant_id)):
 *   user_id, tenant_id, access_token, refresh_token (blobs AES-256-GCM de
 *   cripto.ts), token_expires_at, calendar_id, sync_enabled, last_synced_at,
 *   google_email, is_revoked, revoked_at, revoked_reason.
 *
 * Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_TOKENS_ENCRYPTION_KEY,
 *      GOOGLE_STATE_SECRET, PUBLIC_FUNCTIONS_URL
 */
import { admin } from './supabase.ts';
import { cifrar, decifrar } from './cripto.ts';
import { HttpError, clientIp } from './http.ts';

// deno-lint-ignore no-explicit-any
type Json = any;

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

export function credenciais(): { client_id: string; client_secret: string } {
  const client_id = Deno.env.get('GOOGLE_CLIENT_ID');
  const client_secret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  if (!client_id || !client_secret) throw new HttpError('GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET não configurados', 500);
  return { client_id, client_secret };
}

/**
 * O redirect_uri É a URL pública desta própria function.
 * ATENÇÃO OPERACIONAL: esta URL exata precisa estar cadastrada em
 * "Authorized redirect URIs" no Google Cloud Console (APIs & Services →
 * Credentials → o OAuth client do EisenFlow). Se não estiver, o Google devolve
 * redirect_uri_mismatch antes mesmo de mostrar a tela de consentimento.
 */
export function redirectUri(): string {
  const base = (Deno.env.get('PUBLIC_FUNCTIONS_URL') || '').replace(/\/+$/, '');
  if (!base) throw new HttpError('PUBLIC_FUNCTIONS_URL não configurada', 500);
  return `${base}/google-calendar-auth?action=callback`;
}

/** Erro que o front traduz em "reconecte sua conta Google". */
export function erroReconectar(motivo = 'acesso revogado no Google'): HttpError {
  return new HttpError(`Conexão com o Google Calendar inválida (${motivo}). Reconecte sua conta Google.`, 409, 'google_reconnect_required');
}

export interface ConexaoGoogle {
  id: string;
  user_id: string;
  tenant_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  calendar_id: string | null;
  sync_enabled: boolean | null;
  last_synced_at: string | null;
  google_email: string | null;
  is_revoked: boolean | null;
  revoked_at: string | null;
  revoked_reason: string | null;
}

// ------------------------------------------------------------------- tokens
/** Conexão do par (user_id, tenant_id). Null se nunca conectou. */
export async function buscarConexao(tenantId: string, userId: string): Promise<ConexaoGoogle | null> {
  const { data, error } = await admin()
    .from('google_calendar_tokens')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new HttpError(`google_calendar_tokens: ${error.message}`, 500);
  return (data as ConexaoGoogle) ?? null;
}

export interface AcessoValido { accessToken: string; calendarId: string; doc: ConexaoGoogle }

/**
 * Devolve { accessToken, calendarId, doc } com o token já válido.
 * Renova se faltar menos de 5 min para expirar e regrava cifrado.
 */
export async function acessoValido(doc: ConexaoGoogle | null): Promise<AcessoValido> {
  if (!doc) throw erroReconectar('nenhuma conta conectada');
  if (doc.is_revoked) throw erroReconectar(doc.revoked_reason || 'conexão revogada');

  const expiraEm = new Date(doc.token_expires_at).getTime();
  if (Number.isFinite(expiraEm) && expiraEm - Date.now() > MARGEM_REFRESH_MS) {
    const accessToken = await decifrar(doc.access_token);
    if (!accessToken) throw erroReconectar('sem access_token gravado');
    return { accessToken, calendarId: doc.calendar_id || 'primary', doc };
  }

  const refresh = await decifrar(doc.refresh_token);
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
    throw new HttpError(`falha ao renovar token do Google: ${data.error_description || data.error || res.status}`, 502);
  }

  const novoExpira = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString();
  const patch: Record<string, Json> = { access_token: await cifrar(data.access_token), token_expires_at: novoExpira };
  // O Google só reemite refresh_token em raras rotações; quando vem, guardamos.
  if (data.refresh_token) patch.refresh_token = await cifrar(data.refresh_token);

  const { data: atualizado } = await admin()
    .from('google_calendar_tokens')
    .update(patch)
    .eq('id', doc.id)
    .select('*')
    .maybeSingle();
  await auditar({ userId: doc.user_id, tenantId: doc.tenant_id, acao: 'refresh' });
  console.log(`google: token renovado para tenant ${doc.tenant_id}`);

  const docNovo = (atualizado as ConexaoGoogle) || { ...doc, ...patch };
  return { accessToken: data.access_token, calendarId: docNovo.calendar_id || 'primary', doc: docNovo };
}

export async function marcarRevogado(doc: ConexaoGoogle, motivo: string): Promise<void> {
  try {
    await admin().from('google_calendar_tokens').update({
      is_revoked: true,
      revoked_at: new Date().toISOString(),
      revoked_reason: String(motivo).slice(0, 500),
    }).eq('id', doc.id);
  } catch { /* marcar revogação não pode derrubar o fluxo principal */ }
}

// ---------------------------------------------------------------- API REST
export class GoogleApiError extends HttpError {
  googleStatus: number;
  constructor(message: string, status: number, googleStatus: number) {
    super(message, status);
    this.googleStatus = googleStatus;
  }
}

/**
 * Chamada à API do Calendar já autenticada. 401/403 com token válido significa
 * consentimento retirado no meio do caminho -> mesmo tratamento do invalid_grant.
 */
export async function chamarGoogle(accessToken: string, caminho: string, opcoes: RequestInit = {}, doc: ConexaoGoogle | null = null): Promise<Json> {
  const res = await fetch(`${GOOGLE_CALENDAR_API}${caminho}`, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(opcoes.body ? { 'Content-Type': 'application/json' } : {}),
      ...((opcoes.headers as Record<string, string>) || {}),
    },
  });

  if (res.status === 204) return {};
  const txt = await res.text();
  let data: Json;
  try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }

  if (!res.ok) {
    if ((res.status === 401 || res.status === 403) && doc) {
      await marcarRevogado(doc, `Google respondeu ${res.status}`);
      throw erroReconectar(`HTTP ${res.status}`);
    }
    throw new GoogleApiError(
      `Google API [${res.status}]: ${data?.error?.message || txt.slice(0, 200)}`,
      res.status >= 500 ? 502 : 400,
      res.status,
    );
  }
  return data;
}

// --------------------------------------------------------------- auditoria
/**
 * Trilha em google_token_audit_log. Nunca lança: a tabela veio de uma migration
 * que talvez não tenha rodado (ARQUITETURA.md) — o fluxo principal continua.
 */
export async function auditar({ userId, tenantId, acao, req = null }: { userId: string; tenantId?: string | null; acao: string; req?: Request | null }): Promise<void> {
  try {
    const dados: Record<string, Json> = { user_id: userId, action: acao };
    if (tenantId) dados.tenant_id = tenantId;
    const ip = req ? clientIp(req) : null;
    if (ip) dados.ip_address = ip.slice(0, 45);
    const ua = req?.headers.get('user-agent');
    if (ua) dados.user_agent = String(ua).slice(0, 500);
    const { error } = await admin().from('google_token_audit_log').insert(dados);
    // A tabela original (migration 20260902194454) não tem tenant_id; se a
    // migration nova não adicionou a coluna, grava sem ela em vez de perder a trilha.
    if (error && dados.tenant_id) {
      delete dados.tenant_id;
      await admin().from('google_token_audit_log').insert(dados);
    }
  } catch { /* auditoria é best-effort */ }
}
