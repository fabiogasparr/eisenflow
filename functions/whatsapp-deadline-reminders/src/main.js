/**
 * whatsapp-deadline-reminders
 * ──────────────────────────────────────────────────────────────────────
 * Envia mensagem agregada de tarefas vencendo agora/1h/24h respeitando horário e fuso de cada usuário
 *
 * Origem: supabase/functions/whatsapp-deadline-reminders/index.ts (Deno)
 * Destino: Appwrite Function, runtime node-22
 *
 * Gatilho .......... cron  (cron: *\/15 * * * *)
 * Autenticação ..... servidor
 * Entrada .......... nenhum
 * Saída ............ { ok, sent }
 * Lê ............... whatsapp_connections, tasks, whatsapp_sent_reminders
 * Escreve .......... whatsapp_connections, whatsapp_sent_reminders
 * APIs externas .... Evolution API
 * Variáveis ........ EVOLUTION_API_URL, EVOLUTION_API_KEY
 * Complexidade ..... media
 *
 * ATENÇÃO NO PORTE:
 *   A unique (user_id, task_id, reminder_type) é o que impede reenvio — respeite ao gravar.
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
    // PORTAR: a lógica de negócio vive em supabase/functions/whatsapp-deadline-reminders/index.ts.
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

    log(`whatsapp-deadline-reminders: recebido ${JSON.stringify(input).slice(0, 200)}`);

    return res.json({ ok: true, ported: false, message: 'esqueleto — portar a lógica de whatsapp-deadline-reminders' });
  } catch (e) {
    error(`whatsapp-deadline-reminders: ${e.message}`);
    return err(res, e);
  }
};
