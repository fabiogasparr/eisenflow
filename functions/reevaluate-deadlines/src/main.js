/**
 * reevaluate-deadlines
 * ──────────────────────────────────────────────────────────────────────
 * Reavalia prazos: sobe urgência e usa IA para sugerir nova importância, criando sugestões de reclassificação
 *
 * Origem: supabase/functions/reevaluate-deadlines/index.ts (Deno)
 * Destino: Appwrite Function, runtime node-22
 *
 * Gatilho .......... cron  (cron: 0 6 * * *)
 * Autenticação ..... servidor
 * Entrada .......... vazio (cron) ou { user_id? }
 * Saída ............ { processed, urgencyApplied, suggestionsCreated, errors }
 * Lê ............... tasks, projects, subtasks, task_attachments
 * Escreve .......... tasks, task_reclassification_suggestions, notifications
 * APIs externas .... IA
 * Variáveis ........ AI_API_KEY
 * Complexidade ..... alta
 *
 * ATENÇÃO NO PORTE:
 *   Usava join do PostgREST (tasks -> projects(...)). Troque por db.loadRelated("projects", ids).
 */
import { db, storage, Query } from '../_shared/appwrite.js';
import { chat, imagePart } from '../_shared/ai.js';
import { body, query, err, isScheduled } from '../_shared/http.js';

export default async ({ req, res, log, error }) => {
  try {
    // Só agendamento ou chamada manual autenticada.
    if (!isScheduled(req) && req.headers['x-internal-secret'] !== process.env.INTERNAL_FUNCTION_SECRET) {
      return res.json({ ok: false, error: 'somente execução agendada' }, 403);
    }

    const input = body(req);

    // ──────────────────────────────────────────────────────────────────
    // PORTAR: a lógica de negócio vive em supabase/functions/reevaluate-deadlines/index.ts.
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

    log(`reevaluate-deadlines: recebido ${JSON.stringify(input).slice(0, 200)}`);

    return res.json({ ok: true, ported: false, message: 'esqueleto — portar a lógica de reevaluate-deadlines' });
  } catch (e) {
    error(`reevaluate-deadlines: ${e.message}`);
    return err(res, e);
  }
};
