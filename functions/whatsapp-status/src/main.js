/**
 * whatsapp-status
 * ──────────────────────────────────────────────────────────────────────
 * Consulta e sincroniza o estado da conexão WhatsApp pessoal com a Evolution
 *
 * Origem: supabase/functions/whatsapp-status/index.ts (Deno)
 * Destino: Appwrite Function, runtime node-22
 *
 * Gatilho .......... http-frontend
 * Autenticação ..... jwt-usuario
 * Entrada .......... nenhum
 * Saída ............ { status, phone_number?, webhook_registered? }
 * Lê ............... whatsapp_connections
 * Escreve .......... whatsapp_connections
 * APIs externas .... Evolution API
 * Variáveis ........ EVOLUTION_API_URL, EVOLUTION_API_KEY
 * Complexidade ..... media
 *
 * ATENÇÃO NO PORTE:
 *   Compartilha o padrão de webhook/set com whatsapp-connect.
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
    // PORTAR: a lógica de negócio vive em supabase/functions/whatsapp-status/index.ts.
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

    log(`whatsapp-status: recebido ${JSON.stringify(input).slice(0, 200)}`);

    return res.json({ ok: true, ported: false, message: 'esqueleto — portar a lógica de whatsapp-status' });
  } catch (e) {
    error(`whatsapp-status: ${e.message}`);
    return err(res, e);
  }
};
