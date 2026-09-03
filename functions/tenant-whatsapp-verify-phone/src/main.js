/**
 * tenant-whatsapp-verify-phone
 * ──────────────────────────────────────────────────────────────────────
 * Envia e valida código OTP por WhatsApp para vincular telefone de um membro
 *
 * Origem: supabase/functions/tenant-whatsapp-verify-phone/index.ts (Deno)
 * Destino: Appwrite Function, runtime node-22
 *
 * Gatilho .......... http-frontend
 * Autenticação ..... jwt-usuario
 * Entrada .......... { action:'send'|'verify', tenant_id, phone_number?, code? }
 * Saída ............ { ok:true } | { ok:true, verified:true }
 * Lê ............... tenant_member_phones, tenant_whatsapp_connections
 * Escreve .......... tenant_member_phones
 * APIs externas .... Evolution API
 * Variáveis ........ EVOLUTION_API_URL, EVOLUTION_API_KEY
 * Complexidade ..... media
 *
 * ATENÇÃO NO PORTE:
 *   O original gerava OTP com Math.random. Troque por crypto.randomInt — está no scaffold.
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
    // PORTAR: a lógica de negócio vive em supabase/functions/tenant-whatsapp-verify-phone/index.ts.
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

    log(`tenant-whatsapp-verify-phone: recebido ${JSON.stringify(input).slice(0, 200)}`);

    return res.json({ ok: true, ported: false, message: 'esqueleto — portar a lógica de tenant-whatsapp-verify-phone' });
  } catch (e) {
    error(`tenant-whatsapp-verify-phone: ${e.message}`);
    return err(res, e);
  }
};
