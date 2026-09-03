/**
 * whatsapp-report
 * ──────────────────────────────────────────────────────────────────────
 * Monta e envia relatório diário ou semanal de produtividade por WhatsApp
 *
 * Origem: supabase/functions/whatsapp-report/index.ts (Deno)
 * Destino: Appwrite Function, runtime node-22
 *
 * Gatilho .......... cron  (cron: 0 * * * *)
 * Autenticação ..... servidor
 * Entrada .......... { type?: 'weekly' } — sem o campo roda o diário
 * Saída ............ { type, sent }
 * Lê ............... whatsapp_connections, tasks, productivity_metrics, gamification
 * Escreve .......... nenhuma
 * APIs externas .... Evolution API
 * Variáveis ........ EVOLUTION_API_URL, EVOLUTION_API_KEY
 * Complexidade ..... media
 *
 * ATENÇÃO NO PORTE:
 *   O original tinha UTC-3 fixo no código. Use whatsapp_connections.timezone, como faz o deadline-reminders.
 */
import { db, storage, Query } from '../_shared/appwrite.js';
import { evolution, normalize } from '../_shared/evolution.js';
import { body, query, err, isScheduled } from '../_shared/http.js';

export default async ({ req, res, log, error }) => {
  try {
    // Só agendamento ou chamada manual autenticada.
    if (!isScheduled(req) && req.headers['x-internal-secret'] !== process.env.INTERNAL_FUNCTION_SECRET) {
      return res.json({ ok: false, error: 'somente execução agendada' }, 403);
    }

    const input = body(req);

    // ──────────────────────────────────────────────────────────────────
    // PORTAR: a lógica de negócio vive em supabase/functions/whatsapp-report/index.ts.
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

    log(`whatsapp-report: recebido ${JSON.stringify(input).slice(0, 200)}`);

    return res.json({ ok: true, ported: false, message: 'esqueleto — portar a lógica de whatsapp-report' });
  } catch (e) {
    error(`whatsapp-report: ${e.message}`);
    return err(res, e);
  }
};
