/**
 * analyze-task-image
 * ──────────────────────────────────────────────────────────────────────
 * OCR, descrição visual e sugestão de subtarefas sobre imagem anexada a uma tarefa
 *
 * Origem: supabase/functions/analyze-task-image/index.ts (Deno)
 * Destino: Appwrite Function, runtime node-22
 *
 * Gatilho .......... http-frontend
 * Autenticação ..... jwt-usuario
 * Entrada .......... { attachment_id, task_title?, task_description? }
 * Saída ............ { ocr_text, description, suggested_subtasks[] }
 * Lê ............... task_attachments, tasks, tenant_members
 * Escreve .......... task_attachments
 * APIs externas .... IA
 * Variáveis ........ AI_API_KEY
 * Complexidade ..... alta
 *
 * ATENÇÃO NO PORTE:
 *   createSignedUrl do Supabase Storage -> storage.asDataUrl() do _shared/appwrite.js.
 */
import { db, storage, Query } from '../_shared/appwrite.js';
import { requireUser, requireTenantAdmin, authenticateTenantApiKey } from '../_shared/auth.js';
import { chat, imagePart } from '../_shared/ai.js';
import { body, query, err, isScheduled } from '../_shared/http.js';

export default async ({ req, res, log, error }) => {
  try {
    const user = await requireUser(req);

    const input = body(req);

    // ──────────────────────────────────────────────────────────────────
    // PORTAR: a lógica de negócio vive em supabase/functions/analyze-task-image/index.ts.
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

    log(`analyze-task-image: recebido ${JSON.stringify(input).slice(0, 200)}`);

    return res.json({ ok: true, ported: false, message: 'esqueleto — portar a lógica de analyze-task-image' });
  } catch (e) {
    error(`analyze-task-image: ${e.message}`);
    return err(res, e);
  }
};
