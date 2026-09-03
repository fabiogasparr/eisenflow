/**
 * hermes-mcp
 * ──────────────────────────────────────────────────────────────────────
 * Servidor MCP HTTP que expõe 15 tools de tarefas/projetos/membros/lembretes por tenant.
 *
 * Origem: supabase/functions/hermes-mcp/index.ts (Deno)
 * Destino: Appwrite Function, runtime node-20
 * Status: PORTADA (lógica completa)
 *
 * Gatilho .......... http-webhook-externo
 * Autenticação ..... api-key-tenant (header `x-api-key`, hash SHA-256 em tenant_api_keys)
 * Entrada .......... GET  /mcp/health                       (sem auth)
 *                    POST /mcp/tools/list { tools?: string[] }
 *                    POST /mcp/tools/call { name, arguments }
 * Saída ............ { ok:true, service, version }
 *                  | { tools: [{ name, description, inputSchema, scope }] }
 *                  | { ok:true, name, result } | { ok:false, error, ... }
 * Lê ............... tenant_api_keys, tenant_mcp_settings, tenants, tasks, subtasks,
 *                    task_reminders, projects, tenant_members, profiles,
 *                    ip_whitelist, suspicious_ips, rate_limit_buckets
 * Escreve .......... tenant_api_keys (last_used), tenant_api_audit_log, tasks,
 *                    task_reminders, subtasks/task_shares/task_attachments/
 *                    delegations/task_focus_sessions (só em delete_task),
 *                    rate_limit_buckets, rate_limit_events, ip_access_log, suspicious_ips
 * APIs externas .... nenhuma
 * Variáveis ........ nenhuma além das do Appwrite
 * Complexidade ..... alta
 *
 * CONTRATO PRESERVADO: clientes externos (Hermes) já dependem das rotas, dos nomes
 * das tools, do inputSchema e do envelope de resposta — nada disso mudou. As rotas
 * também atendem sem o prefixo `/mcp` e com o prefixo `/hermes-mcp`, porque a URL da
 * function no Appwrite pode chegar de qualquer uma das formas.
 *
 * O QUE MUDOU NO PORTE
 *  - Sem RLS: toda leitura/escrita filtra tenant_id, e toda tool que recebe um id
 *    resolve o documento COM o filtro de tenant antes de tocar nele.
 *  - Permissões de documento calculadas na criação (espelham
 *    src/integrations/appwrite/permissions.ts) e recalculadas quando assigned_to muda.
 *  - delete_task apaga a cascata na mão (o Appwrite não tem ON DELETE CASCADE).
 *  - Passaram a valer a whitelist de IP por tenant, o bloqueio por suspicious_ips e o
 *    token bucket por chave de API — é aqui que essas collections são aplicadas
 *    (os src/middleware/*.ts do front são só cortesia de UI, como eles mesmos dizem).
 */
import { db, Query, rawCall, DATABASE_ID } from '../_shared/appwrite.js';
import { authenticateTenantApiKey } from '../_shared/auth.js';
import { body } from '../_shared/http.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
};

// ────────────────────────────────────────────────────────── escrita sem carimbo
// db.create/db.update carimbam updated_at. Estas collections não têm esse atributo
// e o Appwrite rejeita atributo desconhecido — por isso vão pela API crua.
const rawCreate = (collection, data, permissions) =>
  rawCall('POST', `/databases/${DATABASE_ID}/collections/${collection}/documents`, {
    documentId: 'unique()',
    data: { created_at: new Date().toISOString(), ...data },
    ...(permissions ? { permissions } : {}),
  });

const rawUpdate = (collection, id, data) =>
  rawCall('PATCH', `/databases/${DATABASE_ID}/collections/${collection}/documents/${id}`, { data });

// ─────────────────────────────────────────────────────────────────── permissões
const P = {
  read: (r) => `read("${r}")`,
  update: (r) => `update("${r}")`,
  delete: (r) => `delete("${r}")`,
};
const roleUser = (id) => `user:${id}`;
const roleTeam = (id) => `team:${id}`;

/** Espelha taskPermissions() de src/integrations/appwrite/permissions.ts. */
function taskPermissions({ createdBy, assignedTo, tenantTeamId }) {
  const perms = [P.read(roleUser(createdBy)), P.update(roleUser(createdBy)), P.delete(roleUser(createdBy))];
  if (assignedTo && assignedTo !== createdBy) {
    perms.push(P.read(roleUser(assignedTo)), P.update(roleUser(assignedTo)));
  }
  if (tenantTeamId) perms.push(P.read(roleTeam(tenantTeamId)));
  return [...new Set(perms)];
}

/** appwrite_team_id do tenant — cacheado por execução, é sempre o mesmo tenant. */
async function tenantTeamId(tenantId, cache) {
  if (cache.teamId !== undefined) return cache.teamId;
  try {
    const tenant = await db.get('tenants', tenantId);
    cache.teamId = tenant?.appwrite_team_id || null;
  } catch {
    // Tenant sem Team nativo: a tarefa nasce só com as permissões de usuário.
    cache.teamId = null;
  }
  return cache.teamId;
}

// ────────────────────────────────────────────────────────────────────── helpers
const json = (res, out, status = 200) => res.json(out, status, CORS);
const fail = (res, status, code, extra = {}) => json(res, { ok: false, error: code, ...extra }, status);

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'] || '';
  return fwd.split(',')[0].trim() || req.headers['x-real-ip'] || null;
}

/** Erro de tool: vira { ok:false, name, error } com 500, como no original. */
const toolError = (msg) => new Error(msg);

/** Validador de JSON-Schema mínimo — as mesmas mensagens que o Hermes espera. */
function invalidInput(obj, schema) {
  if (!schema || typeof schema !== 'object') return null;
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const k of required) {
    if (!(k in obj) || obj[k] === undefined || obj[k] === null) return `required ${k}`;
  }
  for (const [key, rule] of Object.entries(schema.properties || {})) {
    if (!(key in obj) || obj[key] === undefined || obj[key] === null) continue;
    const v = obj[key];
    if (rule.type === 'array') {
      if (!Array.isArray(v)) return `type ${key}`;
    } else if (rule.type && typeof v !== rule.type) {
      return `type ${key}`;
    }
    if (rule.enum && !rule.enum.includes(v)) return `enum ${key}`;
    if (typeof v === 'string') {
      if (typeof rule.minLength === 'number' && v.length < rule.minLength) return `minLength ${key}`;
      if (typeof rule.maxLength === 'number' && v.length > rule.maxLength) return `maxLength ${key}`;
    }
    if (typeof v === 'number') {
      if (typeof rule.minimum === 'number' && v < rule.minimum) return `minimum ${key}`;
      if (typeof rule.maximum === 'number' && v > rule.maximum) return `maximum ${key}`;
    }
  }
  return null;
}

function computeQuadrant(urg, imp) {
  const u = urg >= 3;
  const i = imp >= 3;
  if (u && i) return 'do';
  if (!u && i) return 'schedule';
  if (u && !i) return 'delegate';
  return 'eliminate';
}

/** tasks.due_date é datetime no Appwrite; o cliente pode mandar só 'YYYY-MM-DD'. */
function toIso(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00.000Z`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw toolError('invalid_date');
  return d.toISOString();
}

/** Tarefa do tenant, ou erro. Todo acesso por id passa por aqui. */
async function taskOfTenant(id, tenantId) {
  const task = await db.findOne('tasks', [Query.equal('$id', id), Query.equal('tenant_id', tenantId)]);
  if (!task) throw toolError('task_not_found');
  return task;
}

// ─────────────────────────────────────────────────────── IP: whitelist/bloqueio
/** IP exato ou CIDR IPv4 — mesma regra de src/middleware/ipValidation.ts. */
function ipCombina(entrada, ip) {
  if (!entrada || !ip) return false;
  if (entrada === ip) return true;
  if (!entrada.includes('/')) return false;
  const [rede, prefixoStr] = entrada.split('/');
  const prefixo = Number(prefixoStr);
  const paraInt = (v) => {
    const o = v.split('.').map(Number);
    if (o.length !== 4 || o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
    return ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
  };
  const a = paraInt(rede);
  const b = paraInt(ip);
  if (a === null || b === null || Number.isNaN(prefixo) || prefixo < 0 || prefixo > 32) return false;
  const mascara = prefixo === 0 ? 0 : (0xffffffff << (32 - prefixo)) >>> 0;
  return (a & mascara) === (b & mascara);
}

/** Só a negativa vira documento: um registro por request bem-sucedido não se paga. */
async function logIpDenial(tenantId, ip, endpoint, method, reason, userAgent) {
  try {
    await rawCreate('ip_access_log', {
      tenant_id: tenantId || null,
      ip_address: ip || 'unknown',
      endpoint,
      method,
      allowed: false,
      reason,
      user_agent: (userAgent || '').slice(0, 500) || null,
    });
  } catch {
    /* log não pode derrubar a request */
  }
}

/** IP marcado como bloqueado em suspicious_ips (bloqueio global, não por tenant). */
async function ipBloqueado(ip) {
  if (!ip) return false;
  try {
    const doc = await db.findOne('suspicious_ips', [
      Query.equal('ip_address', ip),
      Query.equal('is_blocked', true),
    ]);
    if (!doc) return false;
    if (doc.block_until && new Date(doc.block_until) < new Date()) {
      await db.update('suspicious_ips', doc.$id, { is_blocked: false, block_until: null });
      return false; // bloqueio temporário venceu
    }
    return true;
  } catch {
    // Fail open: a collection extras pode nem existir no ambiente.
    return false;
  }
}

/** Chave inválida conta ponto contra o IP; a partir de 20 falhas, bloqueia por 1h. */
async function registrarFalhaDeAuth(ip) {
  if (!ip) return;
  try {
    const doc = await db.findOne('suspicious_ips', [Query.equal('ip_address', ip)]);
    if (!doc) {
      await db.create('suspicious_ips', {
        ip_address: ip,
        threat_level: 'low',
        reason: 'API key inválida no hermes-mcp',
        failed_attempts: 1,
        is_blocked: false,
      });
      return;
    }
    const tentativas = (doc.failed_attempts || 0) + 1;
    await db.update('suspicious_ips', doc.$id, {
      failed_attempts: tentativas,
      threat_level: tentativas >= 20 ? 'high' : tentativas >= 5 ? 'medium' : 'low',
      ...(tentativas >= 20
        ? { is_blocked: true, block_until: new Date(Date.now() + 3600_000).toISOString() }
        : {}),
    });
  } catch {
    /* nunca impede a resposta 401 */
  }
}

/** Tenant sem entrada ativa = tudo liberado; com entradas, só o que casar. */
async function ipPermitidoNoTenant(tenantId, ip) {
  try {
    const r = await db.list('ip_whitelist', [
      Query.equal('tenant_id', tenantId),
      Query.equal('is_active', true),
      Query.limit(100),
    ]);
    const docs = r.documents || [];
    if (docs.length === 0) return true;
    return docs.some((e) => ipCombina(e.ip_address, ip));
  } catch {
    // Fail open, igual ao original: sem whitelist legível, não se inventa bloqueio.
    return true;
  }
}

// ─────────────────────────────────────────────────────────────────── rate limit
const BUCKET_PADRAO = { capacity: 120, refill: 2, interval: 60 };

/**
 * Token bucket por chave de API, persistido em rate_limit_buckets.
 * O Appwrite tem abuse limit nativo por IP/endpoint, mas ele não enxerga a chave de
 * tenant — que é a unidade de abuso aqui (um cliente MCP, muitos IPs). Por isso o
 * balde continua sendo regra de negócio desta function.
 */
async function consumirToken(keyHash, tenantId) {
  const agora = Date.now();
  const bucket = await db.findOne('rate_limit_buckets', [Query.equal('api_key', keyHash)]);

  if (!bucket) {
    const novo = await db.create('rate_limit_buckets', {
      api_key: keyHash,
      tenant_id: tenantId,
      tokens_remaining: BUCKET_PADRAO.capacity - 1,
      tokens_capacity: BUCKET_PADRAO.capacity,
      refill_rate: BUCKET_PADRAO.refill,
      refill_interval_seconds: BUCKET_PADRAO.interval,
      last_refill_at: new Date(agora).toISOString(),
      last_request_at: new Date(agora).toISOString(),
      total_requests: 1,
      blocked_requests: 0,
      is_unlimited: false,
      is_blocked: false,
    });
    return { allowed: true, remaining: novo.tokens_remaining };
  }

  if (bucket.is_unlimited) return { allowed: true, remaining: bucket.tokens_capacity ?? BUCKET_PADRAO.capacity };

  if (bucket.is_blocked) {
    await db.update('rate_limit_buckets', bucket.$id, {
      blocked_requests: (bucket.blocked_requests || 0) + 1,
      last_request_at: new Date(agora).toISOString(),
    });
    return { allowed: false, remaining: 0, reason: bucket.block_reason || 'chave bloqueada' };
  }

  const capacidade = bucket.tokens_capacity ?? BUCKET_PADRAO.capacity;
  const intervalo = (bucket.refill_interval_seconds || BUCKET_PADRAO.interval) * 1000;
  const taxa = bucket.refill_rate ?? BUCKET_PADRAO.refill;
  const ultimo = bucket.last_refill_at ? new Date(bucket.last_refill_at).getTime() : agora;

  const ciclos = Math.floor((agora - ultimo) / intervalo);
  let tokens = Math.min(capacidade, (bucket.tokens_remaining ?? capacidade) + ciclos * taxa);
  const refillAt = ciclos > 0 ? new Date(ultimo + ciclos * intervalo).toISOString() : bucket.last_refill_at;

  if (tokens < 1) {
    await db.update('rate_limit_buckets', bucket.$id, {
      tokens_remaining: 0,
      last_refill_at: refillAt,
      last_request_at: new Date(agora).toISOString(),
      total_requests: (bucket.total_requests || 0) + 1,
      blocked_requests: (bucket.blocked_requests || 0) + 1,
    });
    const espera = Math.ceil((ultimo + (ciclos + 1) * intervalo - agora) / 1000);
    return { allowed: false, remaining: 0, retryAfter: Math.max(1, espera) };
  }

  tokens -= 1;
  await db.update('rate_limit_buckets', bucket.$id, {
    tokens_remaining: tokens,
    last_refill_at: refillAt,
    last_request_at: new Date(agora).toISOString(),
    total_requests: (bucket.total_requests || 0) + 1,
  });
  return { allowed: true, remaining: tokens };
}

/** Evento de rate limit: grava só o que interessa auditar (bloqueio e aviso). */
async function registrarEventoRl(keyHash, tenantId, endpoint, method, ip, status, remaining, userAgent) {
  try {
    await rawCreate('rate_limit_events', {
      api_key: keyHash,
      tenant_id: tenantId,
      endpoint,
      method,
      ip_address: ip || null,
      user_agent: (userAgent || '').slice(0, 500) || null,
      status,
      tokens_remaining: remaining,
      tokens_used: 1,
    });
  } catch {
    /* auditoria não derruba a request */
  }
}

// ────────────────────────────────────────────────────────────────── audit trail
async function audit(ctx, tool, status, errorMsg, inputPreview) {
  if (!ctx) return;
  try {
    await rawCreate('tenant_api_audit_log', {
      tenant_id: ctx.tenantId,
      api_key_id: ctx.apiKeyId,
      tool: tool ?? null,
      status,
      error: errorMsg ? String(errorMsg).slice(0, 5000) : null,
      // jsonb virou string(65535): guarda o JSON serializado, cortado como no original.
      input_preview: inputPreview === undefined ? null : JSON.stringify(inputPreview).slice(0, 2000),
    });
  } catch {
    /* ignora erro de auditoria */
  }
}

// ──────────────────────────────────────────────────────────────────────── tools
const TOOLS = [
  // ---------- tasks: read ----------
  {
    name: 'list_tasks',
    description: 'Lista as tarefas do workspace, com filtros opcionais.',
    scope: 'tasks:read',
    inputSchema: {
      type: 'object',
      properties: {
        quadrant: { type: 'string', enum: ['do', 'schedule', 'delegate', 'eliminate'] },
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'eliminated'] },
        project_id: { type: 'string' },
        assigned_to: { type: 'string' },
        search: { type: 'string', maxLength: 200 },
        limit: { type: 'number', minimum: 1, maximum: 100 },
      },
    },
    handler: async (args, ctx) => {
      const q = [Query.equal('tenant_id', ctx.tenantId), Query.orderAsc('position')];
      if (args.quadrant) q.push(Query.equal('quadrant', args.quadrant));
      if (args.status) q.push(Query.equal('status', args.status));
      if (args.project_id) q.push(Query.equal('project_id', args.project_id));
      if (args.assigned_to) q.push(Query.equal('assigned_to', args.assigned_to));
      // ilike('%termo%') não existe no Appwrite: usa o índice fulltext ft_tasks_title.
      if (args.search) q.push(Query.search('title', args.search));
      q.push(Query.limit(Math.min(args.limit ?? 50, 100)));
      const r = await db.list('tasks', q);
      return { tasks: r.documents || [] };
    },
  },
  {
    name: 'get_task',
    description: 'Detalhes de uma tarefa, incluindo subtarefas e lembretes.',
    scope: 'tasks:read',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    handler: async (args, ctx) => {
      const task = await taskOfTenant(args.id, ctx.tenantId);
      const [subs, reminders] = await Promise.all([
        db.list('subtasks', [Query.equal('task_id', task.$id), Query.orderAsc('position'), Query.limit(100)]),
        db.list('task_reminders', [Query.equal('task_id', task.$id), Query.limit(100)]),
      ]);
      return { task, subtasks: subs.documents || [], reminders: reminders.documents || [] };
    },
  },

  // ---------- tasks: write ----------
  {
    name: 'create_task',
    description:
      'Cria uma nova tarefa no workspace. O quadrante é calculado automaticamente a partir de urgência/importância se não for informado.',
    scope: 'tasks:write',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 500 },
        description: { type: 'string', maxLength: 5000 },
        urgency: { type: 'number', minimum: 1, maximum: 5 },
        importance: { type: 'number', minimum: 1, maximum: 5 },
        quadrant: { type: 'string', enum: ['do', 'schedule', 'delegate', 'eliminate'] },
        due_date: { type: 'string' },
        estimated_time: { type: 'number', minimum: 0 },
        project_id: { type: 'string' },
        assigned_to: { type: 'string' },
        recurrence_rule: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
      },
    },
    handler: async (args, ctx) => {
      const urgency = args.urgency ?? 3;
      const importance = args.importance ?? 3;
      const quadrant = args.quadrant ?? computeQuadrant(urgency, importance);

      if (args.assigned_to) {
        const m = await db.findOne('tenant_members', [
          Query.equal('tenant_id', ctx.tenantId),
          Query.equal('user_id', args.assigned_to),
        ]);
        if (!m) throw toolError('assigned_to not a tenant member');
      }
      // Sem RLS: o projeto informado precisa ser do mesmo tenant, senão a tarefa do
      // tenant A ficaria pendurada num projeto do tenant B.
      if (args.project_id) {
        const p = await db.findOne('projects', [
          Query.equal('$id', args.project_id),
          Query.equal('tenant_id', ctx.tenantId),
        ]);
        if (!p) throw toolError('project_not_found');
      }

      const teamId = await tenantTeamId(ctx.tenantId, ctx.cache);
      const task = await db.create(
        'tasks',
        {
          title: args.title,
          description: args.description ?? null,
          urgency,
          importance,
          quadrant,
          due_date: toIso(args.due_date),
          estimated_time: args.estimated_time ?? null,
          project_id: args.project_id ?? null,
          assigned_to: args.assigned_to ?? null,
          recurrence_rule: args.recurrence_rule ?? null,
          status: 'pending',
          created_by: ctx.createdBy,
          tenant_id: ctx.tenantId,
          tags: [], // array não aceita default no Appwrite
        },
        taskPermissions({ createdBy: ctx.createdBy, assignedTo: args.assigned_to, tenantTeamId: teamId }),
      );
      return { task };
    },
  },
  {
    name: 'update_task',
    description: 'Atualiza campos de uma tarefa. Recalcula quadrante quando urgência/importância mudam.',
    scope: 'tasks:write',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
        title: { type: 'string', minLength: 1, maxLength: 500 },
        description: { type: 'string', maxLength: 5000 },
        urgency: { type: 'number', minimum: 1, maximum: 5 },
        importance: { type: 'number', minimum: 1, maximum: 5 },
        quadrant: { type: 'string', enum: ['do', 'schedule', 'delegate', 'eliminate'] },
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'eliminated'] },
        due_date: { type: 'string' },
        estimated_time: { type: 'number', minimum: 0 },
        project_id: { type: 'string' },
        assigned_to: { type: 'string' },
      },
    },
    handler: async (args, ctx) => {
      const { id, ...u } = args;
      const current = await taskOfTenant(id, ctx.tenantId);

      if ((u.urgency !== undefined || u.importance !== undefined) && !u.quadrant) {
        u.quadrant = computeQuadrant(u.urgency ?? current.urgency, u.importance ?? current.importance);
      }
      if (u.status === 'in_progress' && !current.started_at) {
        u.started_at = new Date().toISOString();
        if (!u.quadrant) u.quadrant = 'do';
      }
      if ((u.status === 'completed' || u.status === 'eliminated') && !current.completed_at) {
        u.completed_at = new Date().toISOString();
      }
      if (u.due_date !== undefined) u.due_date = toIso(u.due_date);

      if (u.assigned_to) {
        const m = await db.findOne('tenant_members', [
          Query.equal('tenant_id', ctx.tenantId),
          Query.equal('user_id', u.assigned_to),
        ]);
        if (!m) throw toolError('assigned_to not a tenant member');
      }
      if (u.project_id) {
        const p = await db.findOne('projects', [
          Query.equal('$id', u.project_id),
          Query.equal('tenant_id', ctx.tenantId),
        ]);
        if (!p) throw toolError('project_not_found');
      }

      // A titularidade mudou -> as permissões do documento têm que acompanhar.
      let permissions;
      if (u.assigned_to !== undefined && u.assigned_to !== current.assigned_to) {
        permissions = taskPermissions({
          createdBy: current.created_by,
          assignedTo: u.assigned_to,
          tenantTeamId: await tenantTeamId(ctx.tenantId, ctx.cache),
        });
      }

      const task = await db.update('tasks', current.$id, u, permissions);
      return { task };
    },
  },
  {
    name: 'complete_task',
    description: 'Marca uma tarefa como concluída.',
    scope: 'tasks:write',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    handler: async (args, ctx) => {
      const current = await taskOfTenant(args.id, ctx.tenantId);
      const task = await db.update('tasks', current.$id, {
        status: 'completed',
        completed_at: new Date().toISOString(),
      });
      return { task };
    },
  },
  {
    name: 'start_task',
    description: 'Inicia uma tarefa (move para "Fazer Agora" e marca started_at).',
    scope: 'tasks:write',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    handler: async (args, ctx) => {
      const current = await taskOfTenant(args.id, ctx.tenantId);
      const task = await db.update('tasks', current.$id, {
        status: 'in_progress',
        started_at: new Date().toISOString(),
        quadrant: 'do',
      });
      return { task };
    },
  },
  {
    name: 'delete_task',
    description: 'Remove uma tarefa do workspace.',
    scope: 'tasks:write',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    handler: async (args, ctx) => {
      const task = await taskOfTenant(args.id, ctx.tenantId);
      // Sem ON DELETE CASCADE: a limpeza dos filhos é na mão.
      const filhos = [
        'subtasks',
        'task_shares',
        'task_attachments',
        'task_reminders',
        'delegations',
        'task_focus_sessions',
      ];
      for (const col of filhos) {
        const docs = await db.listAll(col, [Query.equal('task_id', task.$id)]);
        for (const d of docs) {
          try {
            await db.delete(col, d.$id);
          } catch {
            /* filho já removido não impede o resto */
          }
        }
      }
      await db.delete('tasks', task.$id);
      return { deleted: true, id: args.id };
    },
  },
  {
    name: 'move_to_quadrant',
    description: 'Move uma tarefa para um quadrante específico da matriz.',
    scope: 'tasks:write',
    inputSchema: {
      type: 'object',
      required: ['id', 'quadrant'],
      properties: {
        id: { type: 'string' },
        quadrant: { type: 'string', enum: ['do', 'schedule', 'delegate', 'eliminate'] },
      },
    },
    handler: async (args, ctx) => {
      const current = await taskOfTenant(args.id, ctx.tenantId);
      const task = await db.update('tasks', current.$id, { quadrant: args.quadrant });
      return { task };
    },
  },

  // ---------- prioritization ----------
  {
    name: 'suggest_prioritization',
    description:
      'Sugere prioridade para tarefas pendentes/em andamento do workspace usando heurística (prazo + urgência + importância + esforço). Não grava nada.',
    scope: 'prioritize',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', minimum: 1, maximum: 100 },
        project_id: { type: 'string' },
      },
    },
    handler: async (args, ctx) => {
      const q = [Query.equal('tenant_id', ctx.tenantId), Query.equal('status', ['pending', 'in_progress'])];
      if (args.project_id) q.push(Query.equal('project_id', args.project_id));
      const tasks = await db.listAll('tasks', q);

      const now = Date.now();
      const scored = tasks.map((t) => {
        const due = t.due_date ? new Date(t.due_date).getTime() : null;
        const hoursUntilDue = due ? (due - now) / 3.6e6 : 9999;
        let urgencyBoost = 0;
        if (hoursUntilDue < 0) urgencyBoost = 5;
        else if (hoursUntilDue < 24) urgencyBoost = 4;
        else if (hoursUntilDue < 72) urgencyBoost = 2;
        else if (hoursUntilDue < 168) urgencyBoost = 1;
        const effort = t.estimated_time ? Math.min(t.estimated_time / 60, 5) : 1;
        const score = (t.importance ?? 3) * 2 + (t.urgency ?? 3) * 1.5 + urgencyBoost * 2 - effort * 0.3;
        const quadrant = computeQuadrant(
          Math.min(5, (t.urgency ?? 3) + (urgencyBoost > 2 ? 1 : 0)),
          t.importance ?? 3,
        );
        return {
          // $id do Appwrite ocupa o lugar do id do Postgres — o cliente devolve
          // este valor em apply_prioritization, então tem que ser o id real.
          task_id: t.$id,
          title: t.title,
          current_quadrant: t.quadrant,
          suggested_quadrant: quadrant,
          score: Number(score.toFixed(2)),
          reason: `imp=${t.importance} urg=${t.urgency} prazo=${due ? `${Math.round(hoursUntilDue)}h` : 'sem prazo'}`,
        };
      });
      scored.sort((a, b) => b.score - a.score);
      return { plan: scored.slice(0, Math.min(args.limit ?? 20, 100)) };
    },
  },
  {
    name: 'apply_prioritization',
    description: 'Aplica um plano de priorização (lista de { task_id, suggested_quadrant }).',
    scope: 'tasks:write',
    inputSchema: { type: 'object', required: ['plan'], properties: { plan: { type: 'array' } } },
    handler: async (args, ctx) => {
      const items = Array.isArray(args.plan) ? args.plan : [];
      let updated = 0;
      for (const it of items) {
        if (!it?.task_id || !it?.suggested_quadrant) continue;
        try {
          const t = await taskOfTenant(it.task_id, ctx.tenantId);
          await db.update('tasks', t.$id, { quadrant: it.suggested_quadrant });
          updated++;
        } catch {
          // Item inválido ou de outro tenant é ignorado, como no original.
        }
      }
      return { updated };
    },
  },

  // ---------- projects / members ----------
  {
    name: 'list_projects',
    description: 'Lista projetos do workspace.',
    scope: 'projects:read',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, ctx) => {
      const projects = await db.listAll('projects', [Query.equal('tenant_id', ctx.tenantId)]);
      return { projects };
    },
  },
  {
    name: 'list_team_members',
    description: 'Lista membros do workspace (id, nome, role).',
    scope: 'members:read',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, ctx) => {
      const members = await db.listAll('tenant_members', [Query.equal('tenant_id', ctx.tenantId)]);
      const ids = members.map((m) => m.user_id).filter(Boolean);

      // Sem join: uma query por lote de ids e junção em memória. profiles é indexada
      // por user_id (não pelo $id), então db.loadRelated() não serve aqui.
      const byId = new Map();
      for (let i = 0; i < ids.length; i += 100) {
        const page = await db.list('profiles', [
          Query.equal('user_id', ids.slice(i, i + 100)),
          Query.limit(100),
        ]);
        (page.documents || []).forEach((p) => byId.set(p.user_id, p));
      }

      return {
        members: members.map((m) => ({
          user_id: m.user_id,
          role: m.role,
          display_name: byId.get(m.user_id)?.display_name ?? null,
          avatar_url: byId.get(m.user_id)?.avatar_url ?? null,
        })),
      };
    },
  },

  // ---------- reminders ----------
  {
    name: 'add_task_reminder',
    description: 'Adiciona um lembrete personalizado a uma tarefa, em data/hora ISO 8601.',
    scope: 'reminders:write',
    inputSchema: {
      type: 'object',
      required: ['task_id', 'scheduled_at'],
      properties: {
        task_id: { type: 'string' },
        scheduled_at: { type: 'string' },
        channels: { type: 'array' },
        recipients: { type: 'array' },
      },
    },
    handler: async (args, ctx) => {
      const task = await taskOfTenant(args.task_id, ctx.tenantId);
      // Arrays não têm default no Appwrite: o default vai no código.
      const channels = Array.isArray(args.channels) && args.channels.length ? args.channels : ['in_app', 'browser'];
      const recipients =
        Array.isArray(args.recipients) && args.recipients.length ? args.recipients : ['creator', 'assignee'];

      const reminder = await db.create(
        'task_reminders',
        {
          task_id: task.$id,
          created_by: ctx.createdBy,
          kind: 'custom',
          scheduled_at: toIso(args.scheduled_at),
          channels,
          recipients,
          enabled: true,
          auto_generated: false,
        },
        // Filho herda as permissões do pai (inheritFrom em permissions.ts).
        task.$permissions,
      );
      return { reminder };
    },
  },
  {
    name: 'list_task_reminders',
    description: 'Lista lembretes de uma tarefa.',
    scope: 'tasks:read',
    inputSchema: { type: 'object', required: ['task_id'], properties: { task_id: { type: 'string' } } },
    handler: async (args, ctx) => {
      const task = await taskOfTenant(args.task_id, ctx.tenantId);
      const r = await db.list('task_reminders', [Query.equal('task_id', task.$id), Query.limit(100)]);
      return { reminders: r.documents || [] };
    },
  },
  {
    name: 'remove_task_reminder',
    description: 'Remove um lembrete pelo id.',
    scope: 'reminders:write',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    handler: async (args, ctx) => {
      const rem = await db.findOne('task_reminders', [Query.equal('$id', args.id)]);
      if (!rem) throw toolError('reminder_not_found');
      // task_reminders não tem tenant_id: o escopo vem da tarefa dona.
      const task = await db.findOne('tasks', [
        Query.equal('$id', rem.task_id),
        Query.equal('tenant_id', ctx.tenantId),
      ]);
      if (!task) throw toolError('reminder_not_found');
      await db.delete('task_reminders', rem.$id);
      return { deleted: true, id: args.id };
    },
  },
];

const toolMeta = (t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, scope: t.scope });

// ────────────────────────────────────────────────────────────────── autenticação
/**
 * Chave de tenant + MCP habilitado + carimbo de uso.
 * Devolve { ctx } ou { reason } com os mesmos códigos do original ('unauthorized',
 * 'mcp_disabled'), para não quebrar quem já trata a resposta.
 */
async function authenticate(req, ip) {
  let key;
  try {
    // Faz o sha256, confere revogação e expiração.
    key = await authenticateTenantApiKey(db, req.headers['x-api-key']);
  } catch {
    // O motivo real não vaza para o cliente — é sempre 'unauthorized', como antes.
    return { reason: 'unauthorized' };
  }

  const settings = await db.findOne('tenant_mcp_settings', [Query.equal('tenant_id', key.tenant_id)]);
  if (!settings?.enabled) return { reason: 'mcp_disabled' };

  try {
    await rawUpdate('tenant_api_keys', key.$id, {
      last_used_at: new Date().toISOString(),
      last_used_ip: ip,
    });
  } catch {
    /* carimbo de uso não pode negar o acesso */
  }

  return {
    ctx: {
      apiKeyId: key.$id,
      keyHash: key.key_hash,
      tenantId: key.tenant_id,
      scopes: key.scopes ?? [],
      createdBy: key.created_by,
      cache: {},
    },
  };
}

/** Portões que valem para /tools/list e /tools/call. Devolve a resposta ou null. */
async function guard(req, res, ctx, endpoint, ip) {
  const ua = req.headers['user-agent'];

  if (!(await ipPermitidoNoTenant(ctx.tenantId, ip))) {
    await logIpDenial(ctx.tenantId, ip, endpoint, req.method, 'fora da whitelist do tenant', ua);
    await audit(ctx, null, 'error', 'ip_not_allowed');
    return fail(res, 403, 'ip_not_allowed');
  }

  const rl = await consumirToken(ctx.keyHash, ctx.tenantId);
  if (!rl.allowed) {
    await registrarEventoRl(ctx.keyHash, ctx.tenantId, endpoint, req.method, ip, 'blocked', 0, ua);
    await audit(ctx, null, 'error', 'rate_limited');
    return fail(res, 429, 'rate_limited', {
      ...(rl.retryAfter ? { retry_after_seconds: rl.retryAfter } : {}),
      ...(rl.reason ? { reason: rl.reason } : {}),
    });
  }
  // Aviso a partir de 20% restantes — mesmo limiar do middleware do front.
  if (rl.remaining <= Math.ceil(BUCKET_PADRAO.capacity * 0.2)) {
    await registrarEventoRl(ctx.keyHash, ctx.tenantId, endpoint, req.method, ip, 'warning', rl.remaining, ua);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────── handler
export default async ({ req, res, log, error }) => {
  try {
    if (req.method === 'OPTIONS') return res.text('ok', 200, CORS);

    // A URL pode chegar com ou sem o prefixo do nome da function e com ou sem /mcp.
    const path =
      (req.path || '/')
        .replace(/^\/hermes-mcp/, '')
        .replace(/\/+$/, '')
        .replace(/^\/mcp(?=\/|$)/, '') || '/';
    const ip = clientIp(req);

    if (path === '/health' && req.method === 'GET') {
      return json(res, { ok: true, service: 'hermes-mcp', version: 1 });
    }
    if ((path !== '/tools/list' && path !== '/tools/call') || req.method !== 'POST') {
      return fail(res, 404, 'not_found', { path: req.path });
    }

    if (await ipBloqueado(ip)) {
      await logIpDenial(null, ip, path, req.method, 'IP bloqueado em suspicious_ips', req.headers['user-agent']);
      return fail(res, 403, 'ip_blocked');
    }

    const auth = await authenticate(req, ip);
    if (!auth.ctx) {
      if (auth.reason === 'unauthorized') await registrarFalhaDeAuth(ip);
      return fail(res, 401, auth.reason || 'unauthorized');
    }
    const ctx = auth.ctx;

    const barrado = await guard(req, res, ctx, path, ip);
    if (barrado) return barrado;

    const input = body(req);

    // ---------- tools/list ----------
    if (path === '/tools/list') {
      const names = Array.isArray(input?.tools) ? input.tools.map(String) : [];
      const items = names.length ? TOOLS.filter((t) => names.includes(t.name)).map(toolMeta) : TOOLS.map(toolMeta);
      await audit(ctx, null, 'ok', null, { op: 'tools/list', filter: names });
      return json(res, { tools: items });
    }

    // ---------- tools/call ----------
    const name = input?.name;
    const args = input?.arguments ?? {};
    if (!name) {
      await audit(ctx, null, 'error', 'missing_tool_name');
      return fail(res, 400, 'missing_tool_name');
    }
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) {
      await audit(ctx, name, 'error', 'tool_not_found');
      return fail(res, 404, 'tool_not_found', { name });
    }
    if (!ctx.scopes.includes(tool.scope)) {
      await audit(ctx, name, 'error', 'forbidden_scope');
      return fail(res, 403, 'forbidden_scope', { name, scope: tool.scope });
    }
    const v = invalidInput(args || {}, tool.inputSchema);
    if (v) {
      await audit(ctx, name, 'error', `invalid_input:${v}`);
      return fail(res, 422, 'invalid_input', { path: String(v) });
    }

    try {
      const result = await tool.handler(args || {}, ctx);
      await audit(ctx, name, 'ok', null, { args });
      log(`hermes-mcp: ${name} ok (tenant ${ctx.tenantId})`);
      return json(res, { ok: true, name, result });
    } catch (e) {
      const msg = e?.message || 'server_error';
      await audit(ctx, name, 'error', msg, { args });
      error(`hermes-mcp: ${name} falhou: ${msg}`);
      return json(res, { ok: false, name, error: msg }, 500);
    }
  } catch (e) {
    error(`hermes-mcp: ${e.message}`);
    return json(res, { ok: false, error: e?.message || 'erro interno' }, e?.status || 500);
  }
};
