/**
 * whatsapp-webhook
 * ──────────────────────────────────────────────────────────────────────
 * Webhook da Evolution: processa comandos slash e linguagem natural com function-calling sobre tarefas
 *
 * Origem: supabase/functions/whatsapp-webhook/index.ts (Deno)
 * Destino: Appwrite Function, runtime node-22
 *
 * Gatilho .......... http-webhook-externo
 * Autenticação ..... publica
 * Entrada .......... payload bruto da Evolution (event, instance, data.message, data.key...)
 * Saída ............ { ok:true } sempre — a resposta real volta pelo WhatsApp
 * Lê ............... tasks, team_members, profiles, whatsapp_chat_history, task_reminders, whatsapp_connections, whatsapp_processed_messages, teams, gamification, productivity_metrics
 * Escreve .......... tasks, whatsapp_chat_history, task_reminders, delegations, whatsapp_connections, whatsapp_processed_messages
 * APIs externas .... Evolution API, IA
 * Variáveis ........ EVOLUTION_API_URL, EVOLUTION_API_KEY, AI_API_KEY, EVOLUTION_WEBHOOK_SECRET
 * Complexidade ..... alta
 *
 * ATENÇÃO NO PORTE:
 *   A maior e mais arriscada. FALHA DE SEGURANÇA no original: nenhuma verificação de assinatura do payload. O scaffold valida EVOLUTION_WEBHOOK_SECRET. Dedup por whatsapp_processed_messages.
 */
import { db, storage, Query } from '../_shared/appwrite.js';
import { evolution, normalize } from '../_shared/evolution.js';
import { chat, imagePart } from '../_shared/ai.js';
import { body, query, err, isScheduled } from '../_shared/http.js';

export default async ({ req, res, log, error }) => {
  try {
    // Correção de segurança: o original aceitava qualquer payload sem verificação.
    const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
    if (secret && req.headers['x-webhook-secret'] !== secret) {
      return res.json({ ok: false }, 401);
    }

    const input = body(req);

    // ──────────────────────────────────────────────────────────────────
    // PORTAR: a lógica de negócio vive em supabase/functions/whatsapp-webhook/index.ts.
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

    log(`whatsapp-webhook: recebido ${JSON.stringify(input).slice(0, 200)}`);

    return res.json({ ok: true, ported: false, message: 'esqueleto — portar a lógica de whatsapp-webhook' });
  } catch (e) {
    error(`whatsapp-webhook: ${e.message}`);
    return err(res, e);
  }
};
