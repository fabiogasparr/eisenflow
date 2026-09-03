/**
 * ai-task-chat
 * ──────────────────────────────────────────────────────────────────────
 * Chat de IA que cria tarefas estruturadas ou responde em linguagem natural, com texto e imagens
 *
 * Origem: supabase/functions/ai-task-chat/index.ts (Deno)
 * Destino: Appwrite Function, runtime node-22
 *
 * Gatilho .......... http-frontend
 * Autenticação ..... jwt-usuario
 * Entrada .......... { messages[], context?: {teamMembers[], projects[]}, images?: string[] }
 * Saída ............ { type:'tasks', tasks[], summary } | { type:'chat', message }
 * Lê ............... nenhuma
 * Escreve .......... nenhuma
 * APIs externas .... IA
 * Variáveis ........ AI_API_KEY
 * Complexidade ..... media
 *
 * ATENÇÃO NO PORTE:
 *   Era público no Supabase — aqui passa a exigir sessão. Lovable AI Gateway -> _shared/ai.js.
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
    // PORTAR: a lógica de negócio vive em supabase/functions/ai-task-chat/index.ts.
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

    log(`ai-task-chat: recebido ${JSON.stringify(input).slice(0, 200)}`);

    return res.json({ ok: true, ported: false, message: 'esqueleto — portar a lógica de ai-task-chat' });
  } catch (e) {
    error(`ai-task-chat: ${e.message}`);
    return err(res, e);
  }
};
