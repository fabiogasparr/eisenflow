/**
 * google-calendar-auth
 * ──────────────────────────────────────────────────────────────────────
 * OAuth2 do Google Calendar, multi-tenant: authorize, callback, status,
 * list-calendars, update-settings e disconnect.
 *
 * Chamada ........... front (POST com JWT) + redirect do Google (GET callback)
 *                     verify_jwt = false (o callback chega sem sessão); as
 *                     actions POST validam o JWT aqui dentro.
 * Entrada ........... POST { action, tenant_id?, ... } | GET ?action=callback&code&state
 * Saída ............. authorize -> { url }; status/update-settings -> metadados;
 *                     disconnect -> { success, unlinked_tasks }; callback -> HTML
 * Lê ................ google_calendar_tokens, tenant_members
 * Escreve ........... google_calendar_tokens, tasks (limpa google_event_id),
 *                     google_token_audit_log
 * Env ............... GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
 *                     GOOGLE_TOKENS_ENCRYPTION_KEY, GOOGLE_STATE_SECRET,
 *                     PUBLIC_FUNCTIONS_URL
 *
 * O QUE MUDOU EM RELAÇÃO À VERSÃO LOVABLE
 *  1. MULTI-TENANT. Um único app OAuth do EisenFlow no Google Cloud; cada tenant
 *     conecta a PRÓPRIA conta Google. A conexão é a chave (user_id, tenant_id).
 *     `tenant_id` vem no corpo; se o front não mandar, usa o tenant mais antigo
 *     do usuário (o pessoal), para não quebrar o hook antigo.
 *  2. STATE ASSINADO. O original mandava o access_token da sessão cru no
 *     `state` da URL (`?action=authorize&state=<jwt>`) — credencial em URL e
 *     CSRF. Agora o front chama `{action:'authorize'}` com o JWT no header,
 *     recebe `{url}` e abre o popup; o `state` é {user_id, tenant_id, nonce,
 *     exp} assinado com HMAC-SHA256 (cripto.ts).
 *  3. CIFRA. encrypt_token/decrypt_token (pgcrypto, com chave literal no SQL)
 *     viraram AES-256-GCM em WebCrypto. Não existe mais o caminho "texto plano".
 *  4. ESCOPOS MÍNIMOS: calendar.events + calendar.readonly.
 *
 * AÇÃO MANUAL NO GOOGLE CLOUD CONSOLE
 *   redirect_uri = `${PUBLIC_FUNCTIONS_URL}/google-calendar-auth?action=callback`
 *   precisa estar em "Authorized redirect URIs" do OAuth client.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { admin, getTenantRole, requireTenantMember, requireUser, tenantPadraoDe } from '../_shared/supabase.ts';
import { assinarState, cifrar, decifrar, verificarState } from '../_shared/cripto.ts';
import { base64UrlDecode, utf8Decode } from '../_shared/bytes.ts';
import { ESCOPOS, acessoValido, auditar, buscarConexao, chamarGoogle, credenciais, redirectUri, type ConexaoGoogle } from '../_shared/google.ts';
import { corsHeaders, erro, json, lerCorpo, lerQuery, preflight, respostaErro } from '../_shared/http.ts';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/** Página de retorno do popup — avisa a janela-mãe e se fecha (igual ao original). */
function pagina(titulo: string, subtitulo: string, sucesso: boolean, avisarOpener = false): Response {
  const icone = sucesso
    ? '<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
    : '<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
  const script = avisarOpener
    ? "<script>if(window.opener){window.opener.postMessage({type:'google-calendar-connected'},'*')}setTimeout(function(){window.close()},2000);</script>"
    : '<script>setTimeout(function(){window.close()},3000);</script>';
  const esc = (s: string) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;">
<div style="text-align:center;padding:2rem;">${icone}
<h1 style="margin:1.5rem 0 .5rem;font-size:1.5rem;color:#1e293b;">${esc(titulo)}</h1>
<p style="color:#64748b;font-size:1rem;">${esc(subtitulo)}</p>
</div>${script}</body></html>`;
  return new Response(html, { status: 200, headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' } });
}

/** Metadados não sensíveis — é tudo que o navegador pode saber. */
const metadados = (doc: ConexaoGoogle | null) => ({
  connected: !!doc && !doc.is_revoked,
  google_email: doc?.google_email ?? null,
  calendar_id: doc?.calendar_id ?? 'primary',
  sync_enabled: doc?.sync_enabled ?? null,
  last_synced_at: doc?.last_synced_at ?? null,
  is_revoked: doc?.is_revoked ?? false,
  revoked_reason: doc?.revoked_reason ?? null,
});

/** E-mail do id_token (JWT não verificado: veio direto do Google por HTTPS, só rotula a tela). */
function emailDoIdToken(idToken: unknown): string | null {
  try {
    const claim = JSON.parse(utf8Decode(base64UrlDecode(String(idToken).split('.')[1])));
    return claim.email ?? null;
  } catch { return null; }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  try {
    const q = lerQuery(req);
    const input = req.method === 'POST' ? await lerCorpo(req) : {};
    const action = input.action || q.action;

    // ────────────────────────────────────────────────── CALLBACK (público)
    // O Google redireciona o NAVEGADOR para cá: não há JWT no request. Quem
    // prova a identidade é o `state` assinado.
    if (action === 'callback') {
      if (q.error) {
        console.log(`google-calendar-auth: consentimento negado (${q.error})`);
        return pagina('Autorização cancelada', 'Pode fechar esta aba.', false);
      }
      if (!q.code || !q.state) return pagina('Erro ao conectar', 'Faltou code ou state.', false);

      let payload;
      try { payload = await verificarState(q.state); }
      catch (e) {
        console.error(`google-calendar-auth: state rejeitado — ${(e as Error).message}`);
        return pagina('Erro ao conectar', (e as Error).message, false);
      }
      const { user_id: userId, tenant_id: tenantId } = payload;

      // Revalida a associação: entre o authorize e o callback o usuário pode
      // ter sido removido do tenant.
      if (!(await getTenantRole(tenantId, userId))) {
        return pagina('Erro ao conectar', 'Você não é mais membro desta organização.', false);
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
        console.error(`google-calendar-auth: troca de code falhou — ${JSON.stringify(tokenData).slice(0, 300)}`);
        return pagina('Erro ao conectar', 'O Google recusou a autorização. Tente novamente.', false);
      }

      const existente = await buscarConexao(tenantId, userId);
      // deno-lint-ignore no-explicit-any
      const dados: Record<string, any> = {
        user_id: userId,
        tenant_id: tenantId,
        access_token: await cifrar(tokenData.access_token),
        token_expires_at: new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000).toISOString(),
        google_email: emailDoIdToken(tokenData.id_token),
        is_revoked: false,
        revoked_at: null,
        revoked_reason: null,
      };
      // access_type=offline + prompt=consent garantem refresh_token; se mesmo
      // assim não vier (reautorização silenciosa), preservamos o que já havia —
      // a coluna é NOT NULL.
      if (tokenData.refresh_token) dados.refresh_token = await cifrar(tokenData.refresh_token);
      else if (!existente) {
        return pagina('Erro ao conectar', 'O Google não devolveu refresh_token. Remova o acesso do EisenFlow na sua Conta Google e tente de novo.', false);
      }

      const db = admin();
      const { error } = existente
        ? await db.from('google_calendar_tokens').update(dados).eq('id', existente.id)
        : await db.from('google_calendar_tokens').insert({ ...dados, calendar_id: 'primary', sync_enabled: true });
      if (error) {
        console.error(`google-calendar-auth: gravação falhou — ${error.message}`);
        return pagina('Erro ao conectar', 'Não foi possível salvar a conexão. Tente novamente.', false);
      }

      await auditar({ userId, tenantId, acao: 'connect', req });
      console.log(`google-calendar-auth: tenant ${tenantId} conectado a ${dados.google_email || '(e-mail desconhecido)'}`);
      return pagina('Google Calendar conectado!', 'Esta janela será fechada automaticamente...', true, true);
    }

    // ──────────────────────────────────── daqui para baixo exige usuário
    const user = await requireUser(req);
    const userId = user.id;
    const tenantId: string | null = input.tenant_id || q.tenant_id || (await tenantPadraoDe(userId));
    await requireTenantMember(tenantId, userId);
    const tid = tenantId as string;

    // ── AUTHORIZE: devolve a URL de consentimento (o front abre o popup) ──
    if (action === 'authorize') {
      const { client_id } = credenciais();
      const url = new URL(AUTH_ENDPOINT);
      url.searchParams.set('client_id', client_id);
      url.searchParams.set('redirect_uri', redirectUri());
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', `openid email ${ESCOPOS}`);
      url.searchParams.set('access_type', 'offline'); // sem isto não há refresh_token
      url.searchParams.set('prompt', 'consent');      // sem isto o refresh_token só vem na 1ª autorização
      url.searchParams.set('include_granted_scopes', 'true');
      url.searchParams.set('state', await assinarState({ user_id: userId, tenant_id: tid }));
      return json({ url: url.toString() });
    }

    // ── STATUS ──
    if (action === 'status') {
      return json(metadados(await buscarConexao(tid, userId)));
    }

    // ── LIST-CALENDARS (a tela de escolha de calendário é parte do fluxo de conexão) ──
    if (action === 'list-calendars') {
      const doc = await buscarConexao(tid, userId);
      const { accessToken } = await acessoValido(doc);
      const data = await chamarGoogle(accessToken, '/users/me/calendarList?maxResults=250', {}, doc);
      // deno-lint-ignore no-explicit-any
      const calendars = (data.items || []).map((c: any) => ({
        id: c.id, summary: c.summary, primary: !!c.primary,
        backgroundColor: c.backgroundColor, accessRole: c.accessRole,
      }));
      return json({ calendars });
    }

    // ── UPDATE-SETTINGS: escolha de calendário e liga/desliga sync ──
    if (action === 'update-settings') {
      const doc = await buscarConexao(tid, userId);
      if (!doc) throw erro('nenhuma conta Google conectada neste workspace', 404);

      // deno-lint-ignore no-explicit-any
      const patch: Record<string, any> = {};
      if (typeof input.sync_enabled === 'boolean') patch.sync_enabled = input.sync_enabled;
      if (typeof input.calendar_id === 'string' && input.calendar_id.trim()) patch.calendar_id = input.calendar_id.trim();
      if (!Object.keys(patch).length) throw erro('nada para atualizar', 400);

      const { data, error } = await admin().from('google_calendar_tokens').update(patch).eq('id', doc.id).select('*').maybeSingle();
      if (error) throw error;
      return json(metadados(data as ConexaoGoogle));
    }

    // ── DISCONNECT ──
    if (action === 'disconnect') {
      const doc = await buscarConexao(tid, userId);
      if (!doc) return json({ success: true });

      // Revoga no Google antes de apagar aqui: senão o app fica listado como
      // autorizado na conta do usuário para sempre.
      try {
        const alvo = (await decifrar(doc.refresh_token)) || (await decifrar(doc.access_token));
        if (alvo) {
          await fetch(REVOKE_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: alvo }),
          });
        }
      } catch (e) { console.log(`google-calendar-auth: revoke no Google falhou (segue mesmo assim): ${(e as Error).message}`); }

      // Desvincula as tarefas do usuário NESTE tenant — a conexão é dele dentro do tenant.
      const db = admin();
      const { data: desvinculadas } = await db
        .from('tasks')
        .update({ google_event_id: null })
        .eq('tenant_id', tid)
        .eq('created_by', userId)
        .not('google_event_id', 'is', null)
        .select('id');

      const { error } = await db.from('google_calendar_tokens').delete().eq('id', doc.id);
      if (error) throw error;
      await auditar({ userId, tenantId: tid, acao: 'revoke', req });
      console.log(`google-calendar-auth: tenant ${tid} desconectado (${desvinculadas?.length ?? 0} tarefas desvinculadas)`);
      return json({ success: true, unlinked_tasks: desvinculadas?.length ?? 0 });
    }

    throw erro(`action desconhecida: ${action ?? '(vazia)'}`, 400);
  } catch (e) {
    console.error('google-calendar-auth:', e);
    return respostaErro(e);
  }
});
