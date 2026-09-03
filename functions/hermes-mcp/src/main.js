/**
 * hermes-mcp
 * ──────────────────────────────────────────────────────────────────────
 * Servidor MCP HTTP que expõe 13 tools de tarefas/projetos/membros/lembretes por tenant
 *
 * Origem: supabase/functions/hermes-mcp/index.ts (Deno)
 * Destino: Appwrite Function, runtime node-22
 *
 * Gatilho .......... http-webhook-externo
 * Autenticação ..... api-key-tenant
 * Entrada .......... GET /health; POST /tools/list; POST /tools/call { name, arguments }
 * Saída ............ { tools[] } | { ok:true, name, result } | { ok:false, error }
 * Lê ............... tenant_api_keys, tenant_mcp_settings, tasks, subtasks, task_reminders, projects, tenant_members, profiles
 * Escreve .......... tenant_api_keys, tenant_api_audit_log, tasks, task_reminders
 * APIs externas .... nenhuma
 * Variáveis ........ nenhuma além das do Appwrite
 * Complexidade ..... alta
 *
 * ATENÇÃO NO PORTE:
 *   Roteamento por req.path. Mantenha o hash SHA-256 da API key e o audit log a cada chamada.
 */
import { db, storage, Query } from '../_shared/appwrite.js';
import { requireUser, requireTenantAdmin, authenticateTenantApiKey } from '../_shared/auth.js';
import { body, query, err, isScheduled } from '../_shared/http.js';

export default async ({ req, res, log, error }) => {
  try {
    const apiKey = await authenticateTenantApiKey(db, req.headers['x-api-key']);

    const input = body(req);

    // ──────────────────────────────────────────────────────────────────
    // PORTAR: a lógica de negócio vive em supabase/functions/hermes-mcp/index.ts.
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

    log(`hermes-mcp: recebido ${JSON.stringify(input).slice(0, 200)}`);

    return res.json({ ok: true, ported: false, message: 'esqueleto — portar a lógica de hermes-mcp' });
  } catch (e) {
    error(`hermes-mcp: ${e.message}`);
    return err(res, e);
  }
};
