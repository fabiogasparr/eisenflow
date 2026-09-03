/**
 * google-calendar-auth
 * ──────────────────────────────────────────────────────────────────────
 * OAuth2 do Google Calendar, multi-tenant: authorize, callback, status,
 * update-settings e disconnect.
 *
 * Origem: supabase/functions/google-calendar-auth/index.ts (Deno)
 * Destino: Appwrite Function, runtime node-20
 *
 * Gatilho .......... http-frontend (POST) + redirect do Google (GET callback)
 * Autenticação ..... sessão/JWT do usuário nas actions POST;
 *                    o GET callback é público e se autentica pelo `state` assinado
 * Entrada .......... POST { action, tenant_id, ... } | GET ?action=callback&code&state
 * Saída ............ JSON por action; HTML com postMessage no callback
 * Lê ............... google_calendar_tokens, tenant_members
 * Escreve .......... google_calendar_tokens, tasks (limpa google_event_id), google_token_audit_log
 * APIs externas .... Google OAuth2 + Google Calendar
 * Variáveis ........ GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
 *                    GOOGLE_TOKENS_ENCRYPTION_KEY, PUBLIC_WEBHOOK_BASE_URL
 * Complexidade ..... alta
 *
 * O QUE MUDOU EM RELAÇÃO AO ORIGINAL
 *  1. MULTI-TENANT. Um único app OAuth do EisenFlow no Google Cloud; cada tenant
 *     conecta a PRÓPRIA conta Google. A conexão é a chave (user_id, tenant_id),
 *     não mais só user_id. Só quem é membro do tenant consegue conectar.
 *  2. STATE ASSINADO. O original mandava o access_token da sessão do Supabase
 *     cru no `state` — credencial em URL e CSRF de manual. Agora o state é
 *     {user_id, tenant_id, nonce, exp} assinado com HMAC-SHA256 (cripto.js).
 *  3. CIFRA. encrypt_token/decrypt_token (pgcrypto) viraram AES-256-GCM em
 *     node:crypto. Não existe mais o caminho "texto plano" que o original
 *     mantinha como fallback.
 *  4. ESCOPOS MÍNIMOS: calendar.events + calendar.readonly (o original pedia o
 *     escopo `calendar` inteiro + userinfo.email).
 *
 * AÇÃO MANUAL NO GOOGLE CLOUD CONSOLE
 *   redirect_uri = `${PUBLIC_WEBHOOK_BASE_URL}/google-calendar-auth?action=callback`
 *   precisa estar em "Authorized redirect URIs" do OAuth client. Sem isso o
 *   Google responde redirect_uri_mismatch.
 */
import { db, Query } from '../_shared/appwrite.js';
import { requireUser, getTenantRole } from '../_shared/auth.js';
import { body, query } from '../_shared/http.js';
import { cifrar, decifrar, assinarState, verificarState } from '../_shared/cripto.js';
import {
  ESCOPOS, credenciais, redirectUri, buscarConexao, acessoValido,
  auditar, chamarGoogle,
} from '../_shared/google.js';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/** Página de retorno do popup — avisa a janela-mãe e se fecha (igual ao original). */
function pagina(titulo, subtitulo, sucesso, avisarOpener = false) {
  const icone = sucesso
    ? '<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
    : '<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
  const script = avisarOpener
    ? "<script>if(window.opener){window.opener.postMessage({type:'google-calendar-connected'},'*')}setTimeout(function(){window.close()},2000);</script>"
    : '<script>setTimeout(function(){window.close()},3000);</script>';
  const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;">
<div style="text-align:center;padding:2rem;">${icone}
<h1 style="margin:1.5rem 0 .5rem;font-size:1.5rem;color:#1e293b;">${esc(titulo)}</h1>
<p style="color:#64748b;font-size:1rem;">${esc(subtitulo)}</p>
</div>${script}</body></html>`;
}

/** Só membro do tenant conecta/lê a conexão do tenant. */
async function exigirMembroDoTenant(tenantId, userId) {
  if (!tenantId) { const e = new Error('tenant_id é obrigatório'); e.status = 400; throw e; }
  const papel = await getTenantRole(db, tenantId, userId);
  if (!papel) { const e = new Error('você não é membro deste tenant'); e.status = 403; throw e; }
  return papel;
}

/** Metadados não sensíveis — é tudo que o navegador pode saber. */
const metadados = (doc) => ({
  connected: !!doc && !doc.is_revoked,
  google_email: doc?.google_email ?? null,
  calendar_id: doc?.calendar_id ?? 'primary',
  sync_enabled: doc?.sync_enabled ?? null,
  last_synced_at: doc?.last_synced_at ?? null,
  is_revoked: doc?.is_revoked ?? false,
  revoked_reason: doc?.revoked_reason ?? null,
});

export default async ({ req, res, log, error }) => {
  try {
    const q = query(req);
    const input = body(req);
    const action = input.action || q.action;

    // ────────────────────────────────────────────────── CALLBACK (público)
    // O Google redireciona o NAVEGADOR para cá: não há sessão do Appwrite no
    // request. Quem prova a identidade é o `state` assinado.
    if (action === 'callback') {
      const html = (t, s, ok, avisar) => res.send(pagina(t, s, ok, avisar), 200, { 'content-type': 'text/html; charset=utf-8' });

      if (q.error) {
        log(`google-calendar-auth: consentimento negado (${q.error})`);
        return html('Autorização cancelada', 'Pode fechar esta aba.', false);
      }
      if (!q.code || !q.state) return html('Erro ao conectar', 'Faltou code ou state.', false);

      let payload;
      try { payload = verificarState(q.state); }
      catch (e) { error(`google-calendar-auth: state rejeitado — ${e.message}`); return html('Erro ao conectar', e.message, false); }

      const { user_id: userId, tenant_id: tenantId } = payload;

      // Revalida a associação: entre o authorize e o callback o usuário pode
      // ter sido removido do tenant.
      if (!(await getTenantRole(db, tenantId, userId))) {
        return html('Erro ao conectar', 'Você não é mais membro desta organização.', false);
      }

      const { client_id, client_secret } = credenciais();
      const tokenRes = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: q.code, client_id, client_secret,
          redirect_uri: redirectUri(), grant_type: 'authorization_code',
        }),
      });
      const tokenData = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok) {
        error(`google-calendar-auth: troca de code falhou — ${JSON.stringify(tokenData).slice(0, 300)}`);
        return html('Erro ao conectar', 'O Google recusou a autorização. Tente novamente.', false);
      }

      // O e-mail vem no id_token (JWT não verificado aqui — veio direto do
      // Google por HTTPS, só o usamos como rótulo na tela).
      let googleEmail = null;
      try {
        const claim = JSON.parse(Buffer.from(String(tokenData.id_token).split('.')[1], 'base64url').toString('utf8'));
        googleEmail = claim.email ?? null;
      } catch { /* rótulo opcional */ }

      const existente = await buscarConexao(tenantId, userId);
      const dados = {
        user_id: userId,
        tenant_id: tenantId,
        access_token: cifrar(tokenData.access_token),
        token_expires_at: new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000).toISOString(),
        google_email: googleEmail,
        is_revoked: false,
        revoked_at: null,
        revoked_reason: null,
      };
      // access_type=offline + prompt=consent garantem refresh_token; se mesmo
      // assim não vier (reautorização silenciosa), preservamos o que já havia —
      // o campo é required na collection.
      if (tokenData.refresh_token) dados.refresh_token = cifrar(tokenData.refresh_token);
      else if (!existente) return html('Erro ao conectar', 'O Google não devolveu refresh_token. Remova o acesso do EisenFlow na sua Conta Google e tente de novo.', false);

      if (existente) await db.update('google_calendar_tokens', existente.$id, dados);
      else await db.create('google_calendar_tokens', { ...dados, calendar_id: 'primary', sync_enabled: true });

      await auditar({ userId, tenantId, acao: 'connect', req });
      log(`google-calendar-auth: tenant ${tenantId} conectado a ${googleEmail || '(e-mail desconhecido)'}`);
      return html('Google Calendar conectado!', 'Esta janela será fechada automaticamente...', true, true);
    }

    // ──────────────────────────────────── daqui para baixo exige usuário
    const user = await requireUser(req);
    const userId = user.$id;
    const tenantId = input.tenant_id || q.tenant_id;

    // ── AUTHORIZE: devolve a URL de consentimento (o front abre o popup) ──
    if (action === 'authorize') {
      await exigirMembroDoTenant(tenantId, userId);
      const { client_id } = credenciais();

      const url = new URL(AUTH_ENDPOINT);
      url.searchParams.set('client_id', client_id);
      url.searchParams.set('redirect_uri', redirectUri());
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', `openid email ${ESCOPOS}`);
      url.searchParams.set('access_type', 'offline'); // sem isto não há refresh_token
      url.searchParams.set('prompt', 'consent');      // sem isto o refresh_token só vem na 1ª autorização
      url.searchParams.set('include_granted_scopes', 'true');
      url.searchParams.set('state', assinarState({ user_id: userId, tenant_id: tenantId }));

      return res.json({ url: url.toString() });
    }

    // ── STATUS ──
    if (action === 'status') {
      await exigirMembroDoTenant(tenantId, userId);
      return res.json(metadados(await buscarConexao(tenantId, userId)));
    }

    // ── LIST-CALENDARS: os calendários da conta conectada por este tenant ──
    // Fica aqui além de em google-calendar-sync porque a tela de escolha de
    // calendário é parte do fluxo de conexão.
    if (action === 'list-calendars') {
      await exigirMembroDoTenant(tenantId, userId);
      const doc = await buscarConexao(tenantId, userId);
      const { accessToken } = await acessoValido(doc, { log });
      const data = await chamarGoogle(accessToken, '/users/me/calendarList?maxResults=250', {}, doc);
      const calendars = (data.items || []).map((c) => ({
        id: c.id, summary: c.summary, primary: !!c.primary,
        backgroundColor: c.backgroundColor, accessRole: c.accessRole,
      }));
      return res.json({ calendars });
    }

    // ── UPDATE-SETTINGS: escolha de calendário e liga/desliga sync ──
    if (action === 'update-settings') {
      await exigirMembroDoTenant(tenantId, userId);
      const doc = await buscarConexao(tenantId, userId);
      if (!doc) { const e = new Error('nenhuma conta Google conectada neste tenant'); e.status = 404; throw e; }

      const patch = {};
      if (typeof input.sync_enabled === 'boolean') patch.sync_enabled = input.sync_enabled;
      if (typeof input.calendar_id === 'string' && input.calendar_id.trim()) patch.calendar_id = input.calendar_id.trim();
      if (!Object.keys(patch).length) { const e = new Error('nada para atualizar'); e.status = 400; throw e; }

      return res.json(metadados(await db.update('google_calendar_tokens', doc.$id, patch)));
    }

    // ── DISCONNECT ──
    if (action === 'disconnect') {
      await exigirMembroDoTenant(tenantId, userId);
      const doc = await buscarConexao(tenantId, userId);
      if (!doc) return res.json({ success: true });

      // Revoga no Google antes de apagar aqui: senão o app fica listado como
      // autorizado na conta do usuário para sempre.
      try {
        const alvo = decifrar(doc.refresh_token) || decifrar(doc.access_token);
        if (alvo) {
          await fetch(REVOKE_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: alvo }),
          });
        }
      } catch (e) { log(`google-calendar-auth: revoke no Google falhou (segue mesmo assim): ${e.message}`); }

      // Sem cascade no Appwrite: limpar o vínculo das tarefas DESTE tenant é
      // manual. Só as do próprio usuário — a conexão é dele dentro do tenant.
      const tarefas = await db.listAll('tasks', [
        Query.equal('tenant_id', tenantId),
        Query.equal('created_by', userId),
        Query.isNotNull('google_event_id'),
      ]);
      for (const t of tarefas) {
        await db.update('tasks', t.$id, { google_event_id: null }).catch(() => null);
      }

      await db.delete('google_calendar_tokens', doc.$id);
      await auditar({ userId, tenantId, acao: 'revoke', req });
      log(`google-calendar-auth: tenant ${tenantId} desconectado (${tarefas.length} tarefas desvinculadas)`);
      return res.json({ success: true, unlinked_tasks: tarefas.length });
    }

    const e = new Error(`action desconhecida: ${action ?? '(vazia)'}`);
    e.status = 400; throw e;
  } catch (e) {
    error(`google-calendar-auth: ${e.message}`);
    return res.json({ ok: false, error: e.message, ...(e.codigo ? { code: e.codigo } : {}) }, e.status || 500);
  }
};
