/**
 * google-calendar-auth
 * ──────────────────────────────────────────────────────────────────────
 * OAuth2 do Google Calendar: authorize, callback e disconnect
 *
 * Origem: supabase/functions/google-calendar-auth/index.ts (Deno)
 * Destino: Appwrite Function, runtime node-22
 *
 * Gatilho .......... http-frontend
 * Autenticação ..... jwt-usuario
 * Entrada .......... querystring action/code/state (GET); { action:'disconnect' } (POST)
 * Saída ............ HTML de sucesso/erro com postMessage, ou { success:true }
 * Lê ............... google_calendar_tokens
 * Escreve .......... google_calendar_tokens
 * APIs externas .... Google Calendar
 * Variáveis ........ GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_TOKENS_ENCRYPTION_KEY
 * Complexidade ..... alta
 *
 * ATENÇÃO NO PORTE:
 *   RPC encrypt_token (pgcrypto) não existe: cifre em Node com node:crypto. O REDIRECT_URI muda para a URL desta function e precisa ser recadastrado no Google Cloud Console.
 */
import { db, storage, Query } from '../_shared/appwrite.js';
import { requireUser, requireTenantAdmin, authenticateTenantApiKey } from '../_shared/auth.js';
import { body, query, err, isScheduled } from '../_shared/http.js';

export default async ({ req, res, log, error }) => {
  try {
    const user = await requireUser(req);

    const input = body(req);

    // ──────────────────────────────────────────────────────────────────
    // PORTAR: a lógica de negócio vive em supabase/functions/google-calendar-auth/index.ts.
    // Transponha para cá usando os helpers acima. Equivalências:
    //   supabase.from('x').select().eq('a', v)  ->  db.list('x', [Query.equal('a', v)])
    //   supabase.from('x').insert({...})        ->  db.create('x', {...}, permissions)
    //   supabase.from('x').update({...}).eq()   ->  db.update('x', id, {...})
    //   supabase.from('x').delete().eq()        ->  db.delete('x', id)
    //   select('*, rel(...)')                   ->  db.loadRelated('rel', ids)
    //   supabase.auth.getUser()                 ->  requireUser(req)
    //   supabase.rpc('get_tenant_role', ...)    ->  getTenantRole(db, tenantId, userId)
    //   supabase.storage.createSignedUrl()      ->  storage.asDataUrl(bucketId, fileId)
    //   fetch(LOVABLE_AI_GATEWAY)               ->  chat({ messages, tools })
    // ──────────────────────────────────────────────────────────────────

    log(`google-calendar-auth: recebido ${JSON.stringify(input).slice(0, 200)}`);

    return res.json({ ok: true, ported: false, message: 'esqueleto — portar a lógica de google-calendar-auth' });
  } catch (e) {
    error(`google-calendar-auth: ${e.message}`);
    return err(res, e);
  }
};
