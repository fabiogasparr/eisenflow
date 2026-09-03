/**
 * tenant-whatsapp-connect
 * ──────────────────────────────────────────────────────────────────────
 * Cria a instância Evolution do WhatsApp corporativo do tenant e devolve o QR code
 *
 * Origem: supabase/functions/tenant-whatsapp-connect/index.ts (Deno)
 * Destino: Appwrite Function, runtime node-22
 *
 * Gatilho .......... http-frontend
 * Autenticação ..... jwt-usuario
 * Entrada .......... { tenant_id }
 * Saída ............ { ok, instance_name, qr_code }
 * Lê ............... tenant_members
 * Escreve .......... tenant_whatsapp_connections
 * APIs externas .... Evolution API
 * Variáveis ........ EVOLUTION_API_URL, EVOLUTION_API_KEY
 * Complexidade ..... media
 *
 * ATENÇÃO NO PORTE:
 *   RPC get_tenant_role -> requireTenantAdmin() do _shared/auth.js.
 */
import { db, storage, Query } from '../_shared/appwrite.js';
import { requireUser, requireTenantAdmin, authenticateTenantApiKey } from '../_shared/auth.js';
import { evolution, normalize } from '../_shared/evolution.js';
import { body, query, err, isScheduled } from '../_shared/http.js';

export default async ({ req, res, log, error }) => {
  try {
    const user = await requireUser(req);

    const input = body(req);

    // ──────────────────────────────────────────────────────────────────
    // PORTAR: a lógica de negócio vive em supabase/functions/tenant-whatsapp-connect/index.ts.
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

    log(`tenant-whatsapp-connect: recebido ${JSON.stringify(input).slice(0, 200)}`);

    return res.json({ ok: true, ported: false, message: 'esqueleto — portar a lógica de tenant-whatsapp-connect' });
  } catch (e) {
    error(`tenant-whatsapp-connect: ${e.message}`);
    return err(res, e);
  }
};
