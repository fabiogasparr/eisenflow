/**
 * hermes-mcp
 * ──────────────────────────────────────────────────────────────────────
 * Servidor MCP HTTP que expõe 15 tools de tarefas/projetos/membros/lembretes
 * por tenant, para clientes externos (Hermes).
 *
 * Chamada ........... cliente MCP externo — verify_jwt = false
 * Autenticação ...... header `x-api-key: efk_<prefix>_<secret>` (SHA-256 em
 *                     tenant_api_keys.key_hash) + tenant_mcp_settings.enabled
 * Rotas ............. GET  /mcp/health                       (sem auth)
 *                     POST /mcp/tools/list { tools?: string[] }
 *                     POST /mcp/tools/call { name, arguments }
 * Saída ............. { tools: [...] } | { ok:true, name, result } | { ok:false, error, ... }
 * Lê ................ tenant_api_keys, tenant_mcp_settings, tasks, subtasks,
 *                     task_reminders, projects, tenant_members, profiles,
 *                     ip_whitelist, suspicious_ips, rate_limit_buckets
 * Escreve ........... tenant_api_keys (last_used), tenant_api_audit_log, tasks,
 *                     task_reminders, rate_limit_buckets/events, ip_access_log,
 *                     suspicious_ips
 * Env ............... nenhuma além das do Supabase
 *
 * CONTRATO PRESERVADO: rotas, nomes das tools, inputSchema e envelope de
 * resposta não mudaram. As rotas também atendem sem o prefixo `/mcp`.
 *
 * O QUE MUDOU EM RELAÇÃO À VERSÃO LOVABLE
 *  - A whitelist de IP por tenant (ip_whitelist), o bloqueio por suspicious_ips
 *    e o token bucket por chave de API (rate_limit_buckets) passaram a ser
 *    APLICADOS aqui — as tabelas e as funções SQL existiam (migrations de
 *    02/09) mas nenhuma function as consultava; os src/middleware/*.ts do
 *    front são só cortesia de UI. Tudo é FAIL-OPEN: se a migration de
 *    segurança não rodou (ARQUITETURA.md registra que talvez nunca tenha
 *    rodado), a ausência da tabela/função não derruba o MCP.
 *  - API key inválida conta ponto contra o IP (report_suspicious_ip); a partir
 *    de 20 falhas o IP é bloqueado por 1h.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sha256Hex } from '../_shared/cripto.ts'
import { clientIp } from '../_shared/http.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ---------- helpers ----------
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
function err(status: number, code: string, extra: Record<string, unknown> = {}) {
  return json({ ok: false, error: code, ...extra }, status)
}

// ---------- IP: whitelist / bloqueio ----------
/**
 * is_ip_allowed(tenant, ip) já cobre os dois casos: IP em suspicious_ips com
 * is_blocked e a whitelist do tenant (sem entradas = tudo liberado).
 * Fail open: função ausente ou IP não parseável como inet não bloqueia.
 */
async function ipPermitido(tenantId: string, ip: string | null): Promise<boolean> {
  if (!ip) return true
  try {
    const { data, error } = await sb.rpc('is_ip_allowed', { p_tenant_id: tenantId, p_ip_address: ip })
    if (error) return true
    return data !== false
  } catch {
    return true
  }
}

/** Bloqueio global por suspicious_ips, antes mesmo de autenticar. */
async function ipBloqueado(ip: string | null): Promise<boolean> {
  if (!ip) return false
  try {
    const { data } = await sb
      .from('suspicious_ips')
      .select('id, block_until, is_blocked')
      .eq('ip_address', ip)
      .eq('is_blocked', true)
      .maybeSingle()
    if (!data) return false
    if (data.block_until && new Date(data.block_until) < new Date()) {
      await sb.from('suspicious_ips').update({ is_blocked: false, block_until: null }).eq('id', data.id)
      return false // bloqueio temporário venceu
    }
    return true
  } catch {
    return false
  }
}

/** Só a negativa vira registro: um por request bem-sucedido não se paga. */
async function logIpDenial(tenantId: string | null, ip: string | null, endpoint: string, method: string, reason: string, userAgent: string | null) {
  try {
    await sb.from('ip_access_log').insert({
      tenant_id: tenantId,
      ip_address: ip || '0.0.0.0',
      endpoint, method, allowed: false, reason,
      user_agent: (userAgent || '').slice(0, 500) || null,
    })
  } catch { /* log não pode derrubar a request */ }
}

/** Chave inválida conta ponto contra o IP; a partir de 20 falhas, bloqueia por 1h. */
async function registrarFalhaDeAuth(ip: string | null) {
  if (!ip) return
  try {
    await sb.rpc('report_suspicious_ip', { p_ip_address: ip, p_threat_level: 'low', p_reason: 'API key inválida no hermes-mcp' })
    const { data } = await sb.from('suspicious_ips').select('id, failed_attempts').eq('ip_address', ip).maybeSingle()
    if (!data) return
    const tentativas = data.failed_attempts || 0
    await sb.from('suspicious_ips').update({
      threat_level: tentativas >= 20 ? 'high' : tentativas >= 5 ? 'medium' : 'low',
      ...(tentativas >= 20 ? { is_blocked: true, block_until: new Date(Date.now() + 3600_000).toISOString() } : {}),
    }).eq('id', data.id)
  } catch { /* nunca impede a resposta 401 */ }
}

// ---------- rate limit ----------
const BUCKET_CAPACIDADE = 120

/**
 * Token bucket por chave de API, via check_rate_limit() do Postgres (atômica,
 * com FOR UPDATE). O balde é criado na primeira chamada. Fail open se a
 * função/tabela não existir.
 */
async function consumirToken(keyHash: string, tenantId: string, ip: string | null): Promise<{ allowed: boolean; remaining: number; retryAfter?: number; status?: string }> {
  try {
    await sb.from('rate_limit_buckets').upsert({ api_key: keyHash, tenant_id: tenantId }, { onConflict: 'api_key', ignoreDuplicates: true })
    const { data, error } = await sb.rpc('check_rate_limit', { p_api_key: keyHash, p_tokens_needed: 1, p_ip_address: ip })
    if (error) return { allowed: true, remaining: BUCKET_CAPACIDADE }
    const r = Array.isArray(data) ? data[0] : data
    if (!r) return { allowed: true, remaining: BUCKET_CAPACIDADE }
    return {
      allowed: r.allowed !== false,
      remaining: r.tokens_remaining ?? 0,
      retryAfter: r.reset_after && r.reset_after > 0 ? r.reset_after : undefined,
      status: r.status,
    }
  } catch {
    return { allowed: true, remaining: BUCKET_CAPACIDADE }
  }
}

async function registrarEventoRl(keyHash: string, endpoint: string, method: string, ip: string | null, status: string, remaining: number, userAgent: string | null) {
  try {
    await sb.rpc('log_rate_limit_event', {
      p_api_key: keyHash, p_endpoint: endpoint, p_method: method, p_status: status,
      p_tokens_remaining: remaining, p_ip_address: ip, p_user_agent: (userAgent || '').slice(0, 500) || null,
    })
  } catch { /* auditoria não derruba a request */ }
}

// Minimal JSON-Schema validator matching Hermes' invalidInput.
function invalidInput(obj: Record<string, unknown>, schema: any): string | null {
  if (!schema || typeof schema !== 'object') return null
  const required: string[] = Array.isArray(schema.required) ? schema.required : []
  for (const k of required) {
    if (!(k in obj) || obj[k] === undefined || obj[k] === null) return `required ${k}`
  }
  const props = schema.properties || {}
  for (const [key, rule] of Object.entries<any>(props)) {
    if (!(key in obj) || obj[key] === undefined || obj[key] === null) continue
    const v = obj[key]
    if (rule.type === 'array') {
      if (!Array.isArray(v)) return `type ${key}`
    } else if (rule.type && typeof v !== rule.type) {
      return `type ${key}`
    }
    if (rule.enum && !rule.enum.includes(v)) return `enum ${key}`
    if (typeof v === 'string') {
      if (typeof rule.minLength === 'number' && v.length < rule.minLength) return `minLength ${key}`
      if (typeof rule.maxLength === 'number' && v.length > rule.maxLength) return `maxLength ${key}`
    }
    if (typeof v === 'number') {
      if (typeof rule.minimum === 'number' && v < rule.minimum) return `minimum ${key}`
      if (typeof rule.maximum === 'number' && v > rule.maximum) return `maximum ${key}`
    }
  }
  return null
}

function computeQuadrant(urg: number, imp: number): 'do' | 'schedule' | 'delegate' | 'eliminate' {
  const u = urg >= 3, i = imp >= 3
  if (u && i) return 'do'
  if (!u && i) return 'schedule'
  if (u && !i) return 'delegate'
  return 'eliminate'
}

// ---------- auth ----------
type AuthCtx = {
  apiKeyId: string
  keyHash: string
  tenantId: string
  scopes: string[]
  createdBy: string
}

async function authenticate(req: Request): Promise<{ ctx?: AuthCtx; reason?: string }> {
  const token = req.headers.get('x-api-key') || ''
  if (!token) return { reason: 'unauthorized' }
  const hash = await sha256Hex(token)
  const { data, error } = await sb
    .from('tenant_api_keys')
    .select('id, tenant_id, scopes, created_by, revoked_at, expires_at')
    .eq('key_hash', hash)
    .maybeSingle()
  if (error || !data) return { reason: 'unauthorized' }
  if (data.revoked_at) return { reason: 'unauthorized' }
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return { reason: 'unauthorized' }

  // Check MCP enabled
  const { data: settings } = await sb
    .from('tenant_mcp_settings')
    .select('enabled')
    .eq('tenant_id', data.tenant_id)
    .maybeSingle()
  if (!settings?.enabled) return { reason: 'mcp_disabled' }

  // Touch last_used (fire-and-forget; await but ignore errors)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  await sb
    .from('tenant_api_keys')
    .update({ last_used_at: new Date().toISOString(), last_used_ip: ip })
    .eq('id', data.id)

  return {
    ctx: {
      apiKeyId: data.id,
      keyHash: hash,
      tenantId: data.tenant_id,
      scopes: data.scopes ?? [],
      createdBy: data.created_by,
    },
  }
}

async function audit(
  ctx: AuthCtx | null,
  tool: string | null,
  status: string,
  errorMsg?: string | null,
  inputPreview?: unknown,
) {
  if (!ctx) return
  try {
    await sb.from('tenant_api_audit_log').insert({
      tenant_id: ctx.tenantId,
      api_key_id: ctx.apiKeyId,
      tool,
      status,
      error: errorMsg ?? null,
      input_preview: inputPreview ? JSON.parse(JSON.stringify(inputPreview).slice(0, 2000)) : null,
    })
  } catch (_) {
    // ignore audit errors
  }
}

// ---------- tools ----------
type Tool = {
  name: string
  description: string
  scope: string
  inputSchema: any
  handler: (args: any, ctx: AuthCtx) => Promise<unknown>
}

const TOOLS: Tool[] = [
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
      let q = sb.from('tasks').select('*').eq('tenant_id', ctx.tenantId).order('position', { ascending: true })
      if (args.quadrant) q = q.eq('quadrant', args.quadrant)
      if (args.status) q = q.eq('status', args.status)
      if (args.project_id) q = q.eq('project_id', args.project_id)
      if (args.assigned_to) q = q.eq('assigned_to', args.assigned_to)
      if (args.search) q = q.ilike('title', `%${args.search}%`)
      q = q.limit(Math.min(args.limit ?? 50, 100))
      const { data, error } = await q
      if (error) throw new Error(error.message)
      return { tasks: data ?? [] }
    },
  },
  {
    name: 'get_task',
    description: 'Detalhes de uma tarefa, incluindo subtarefas e lembretes.',
    scope: 'tasks:read',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    handler: async (args, ctx) => {
      const { data: task, error } = await sb
        .from('tasks').select('*').eq('id', args.id).eq('tenant_id', ctx.tenantId).maybeSingle()
      if (error) throw new Error(error.message)
      if (!task) throw new Error('task_not_found')
      const [{ data: subs }, { data: reminders }] = await Promise.all([
        sb.from('subtasks').select('*').eq('task_id', args.id).order('position'),
        sb.from('task_reminders').select('*').eq('task_id', args.id),
      ])
      return { task, subtasks: subs ?? [], reminders: reminders ?? [] }
    },
  },

  // ---------- tasks: write ----------
  {
    name: 'create_task',
    description: 'Cria uma nova tarefa no workspace. O quadrante é calculado automaticamente a partir de urgência/importância se não for informado.',
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
      const urgency = args.urgency ?? 3
      const importance = args.importance ?? 3
      const quadrant = args.quadrant ?? computeQuadrant(urgency, importance)
      // assigned_to must be tenant member if set
      if (args.assigned_to) {
        const { data: m } = await sb
          .from('tenant_members').select('user_id')
          .eq('tenant_id', ctx.tenantId).eq('user_id', args.assigned_to).maybeSingle()
        if (!m) throw new Error('assigned_to not a tenant member')
      }
      const { data, error } = await sb.from('tasks').insert({
        title: args.title,
        description: args.description ?? null,
        urgency,
        importance,
        quadrant,
        due_date: args.due_date ?? null,
        estimated_time: args.estimated_time ?? null,
        project_id: args.project_id ?? null,
        assigned_to: args.assigned_to ?? null,
        recurrence_rule: args.recurrence_rule ?? null,
        status: 'pending',
        created_by: ctx.createdBy,
        tenant_id: ctx.tenantId,
        tags: [],
      } as any).select().single()
      if (error) throw new Error(error.message)
      return { task: data }
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
      const { id, ...updates } = args
      const { data: current } = await sb.from('tasks').select('*').eq('id', id).eq('tenant_id', ctx.tenantId).maybeSingle()
      if (!current) throw new Error('task_not_found')
      const u = updates as Record<string, any>
      if ((u.urgency !== undefined || u.importance !== undefined) && !u.quadrant) {
        u.quadrant = computeQuadrant(u.urgency ?? current.urgency, u.importance ?? current.importance)
      }
      if (u.status === 'in_progress' && !current.started_at) {
        u.started_at = new Date().toISOString()
        if (!u.quadrant) u.quadrant = 'do'
      }
      if ((u.status === 'completed' || u.status === 'eliminated') && !current.completed_at) {
        u.completed_at = new Date().toISOString()
      }
      const { data, error } = await sb.from('tasks').update(u).eq('id', id).eq('tenant_id', ctx.tenantId).select().single()
      if (error) throw new Error(error.message)
      return { task: data }
    },
  },
  {
    name: 'complete_task',
    description: 'Marca uma tarefa como concluída.',
    scope: 'tasks:write',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    handler: async (args, ctx) => {
      const { data, error } = await sb.from('tasks').update({
        status: 'completed', completed_at: new Date().toISOString(),
      }).eq('id', args.id).eq('tenant_id', ctx.tenantId).select().single()
      if (error) throw new Error(error.message)
      return { task: data }
    },
  },
  {
    name: 'start_task',
    description: 'Inicia uma tarefa (move para "Fazer Agora" e marca started_at).',
    scope: 'tasks:write',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    handler: async (args, ctx) => {
      const { data, error } = await sb.from('tasks').update({
        status: 'in_progress', started_at: new Date().toISOString(), quadrant: 'do',
      }).eq('id', args.id).eq('tenant_id', ctx.tenantId).select().single()
      if (error) throw new Error(error.message)
      return { task: data }
    },
  },
  {
    name: 'delete_task',
    description: 'Remove uma tarefa do workspace.',
    scope: 'tasks:write',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    handler: async (args, ctx) => {
      const { error } = await sb.from('tasks').delete().eq('id', args.id).eq('tenant_id', ctx.tenantId)
      if (error) throw new Error(error.message)
      return { deleted: true, id: args.id }
    },
  },
  {
    name: 'move_to_quadrant',
    description: 'Move uma tarefa para um quadrante específico da matriz.',
    scope: 'tasks:write',
    inputSchema: {
      type: 'object', required: ['id', 'quadrant'],
      properties: {
        id: { type: 'string' },
        quadrant: { type: 'string', enum: ['do', 'schedule', 'delegate', 'eliminate'] },
      },
    },
    handler: async (args, ctx) => {
      const { data, error } = await sb.from('tasks').update({ quadrant: args.quadrant })
        .eq('id', args.id).eq('tenant_id', ctx.tenantId).select().single()
      if (error) throw new Error(error.message)
      return { task: data }
    },
  },

  // ---------- prioritization ----------
  {
    name: 'suggest_prioritization',
    description: 'Sugere prioridade para tarefas pendentes/em andamento do workspace usando heurística (prazo + urgência + importância + esforço). Não grava nada.',
    scope: 'prioritize',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', minimum: 1, maximum: 100 },
        project_id: { type: 'string' },
      },
    },
    handler: async (args, ctx) => {
      let q = sb.from('tasks').select('*').eq('tenant_id', ctx.tenantId).in('status', ['pending', 'in_progress'])
      if (args.project_id) q = q.eq('project_id', args.project_id)
      const { data, error } = await q
      if (error) throw new Error(error.message)
      const now = Date.now()
      const scored = (data ?? []).map((t: any) => {
        const due = t.due_date ? new Date(t.due_date).getTime() : null
        const hoursUntilDue = due ? (due - now) / 3.6e6 : 9999
        let urgencyBoost = 0
        if (hoursUntilDue < 0) urgencyBoost = 5
        else if (hoursUntilDue < 24) urgencyBoost = 4
        else if (hoursUntilDue < 72) urgencyBoost = 2
        else if (hoursUntilDue < 168) urgencyBoost = 1
        const effort = t.estimated_time ? Math.min(t.estimated_time / 60, 5) : 1
        const score =
          (t.importance ?? 3) * 2 +
          (t.urgency ?? 3) * 1.5 +
          urgencyBoost * 2 -
          effort * 0.3
        const quadrant = computeQuadrant(
          Math.min(5, (t.urgency ?? 3) + (urgencyBoost > 2 ? 1 : 0)),
          t.importance ?? 3,
        )
        return {
          task_id: t.id,
          title: t.title,
          current_quadrant: t.quadrant,
          suggested_quadrant: quadrant,
          score: Number(score.toFixed(2)),
          reason: `imp=${t.importance} urg=${t.urgency} prazo=${
            due ? `${Math.round(hoursUntilDue)}h` : 'sem prazo'
          }`,
        }
      })
      scored.sort((a, b) => b.score - a.score)
      const limit = Math.min(args.limit ?? 20, 100)
      return { plan: scored.slice(0, limit) }
    },
  },
  {
    name: 'apply_prioritization',
    description: 'Aplica um plano de priorização (lista de { task_id, suggested_quadrant }).',
    scope: 'tasks:write',
    inputSchema: {
      type: 'object', required: ['plan'],
      properties: { plan: { type: 'array' } },
    },
    handler: async (args, ctx) => {
      const items = Array.isArray(args.plan) ? args.plan : []
      let updated = 0
      for (const it of items) {
        if (!it?.task_id || !it?.suggested_quadrant) continue
        const { error } = await sb.from('tasks')
          .update({ quadrant: it.suggested_quadrant })
          .eq('id', it.task_id).eq('tenant_id', ctx.tenantId)
        if (!error) updated++
      }
      return { updated }
    },
  },

  // ---------- projects / members ----------
  {
    name: 'list_projects',
    description: 'Lista projetos do workspace.',
    scope: 'projects:read',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, ctx) => {
      const { data, error } = await sb.from('projects').select('*').eq('tenant_id', ctx.tenantId)
      if (error) throw new Error(error.message)
      return { projects: data ?? [] }
    },
  },
  {
    name: 'list_team_members',
    description: 'Lista membros do workspace (id, nome, role).',
    scope: 'members:read',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, ctx) => {
      const { data, error } = await sb.from('tenant_members')
        .select('user_id, role').eq('tenant_id', ctx.tenantId)
      if (error) throw new Error(error.message)
      const ids = (data ?? []).map((m: any) => m.user_id)
      const { data: profiles } = ids.length
        ? await sb.from('profiles').select('user_id, display_name, avatar_url').in('user_id', ids)
        : { data: [] as any[] }
      const byId = new Map((profiles ?? []).map((p: any) => [p.user_id, p]))
      return {
        members: (data ?? []).map((m: any) => ({
          user_id: m.user_id,
          role: m.role,
          display_name: byId.get(m.user_id)?.display_name ?? null,
          avatar_url: byId.get(m.user_id)?.avatar_url ?? null,
        })),
      }
    },
  },

  // ---------- reminders ----------
  {
    name: 'add_task_reminder',
    description: 'Adiciona um lembrete personalizado a uma tarefa, em data/hora ISO 8601.',
    scope: 'reminders:write',
    inputSchema: {
      type: 'object', required: ['task_id', 'scheduled_at'],
      properties: {
        task_id: { type: 'string' },
        scheduled_at: { type: 'string' },
        channels: { type: 'array' },
        recipients: { type: 'array' },
      },
    },
    handler: async (args, ctx) => {
      const { data: task } = await sb.from('tasks').select('id, created_by').eq('id', args.task_id).eq('tenant_id', ctx.tenantId).maybeSingle()
      if (!task) throw new Error('task_not_found')
      const channels = (Array.isArray(args.channels) && args.channels.length ? args.channels : ['in_app', 'browser']) as string[]
      const recipients = (Array.isArray(args.recipients) && args.recipients.length ? args.recipients : ['creator', 'assignee']) as string[]
      const { data, error } = await sb.from('task_reminders').insert({
        task_id: args.task_id,
        created_by: ctx.createdBy,
        kind: 'custom',
        scheduled_at: args.scheduled_at,
        channels,
        recipients,
        enabled: true,
        auto_generated: false,
      } as any).select().single()
      if (error) throw new Error(error.message)
      return { reminder: data }
    },
  },
  {
    name: 'list_task_reminders',
    description: 'Lista lembretes de uma tarefa.',
    scope: 'tasks:read',
    inputSchema: { type: 'object', required: ['task_id'], properties: { task_id: { type: 'string' } } },
    handler: async (args, ctx) => {
      const { data: task } = await sb.from('tasks').select('id').eq('id', args.task_id).eq('tenant_id', ctx.tenantId).maybeSingle()
      if (!task) throw new Error('task_not_found')
      const { data, error } = await sb.from('task_reminders').select('*').eq('task_id', args.task_id)
      if (error) throw new Error(error.message)
      return { reminders: data ?? [] }
    },
  },
  {
    name: 'remove_task_reminder',
    description: 'Remove um lembrete pelo id.',
    scope: 'reminders:write',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
    handler: async (args, ctx) => {
      const { data: rem } = await sb.from('task_reminders').select('id, task_id').eq('id', args.id).maybeSingle()
      if (!rem) throw new Error('reminder_not_found')
      const { data: task } = await sb.from('tasks').select('id').eq('id', rem.task_id).eq('tenant_id', ctx.tenantId).maybeSingle()
      if (!task) throw new Error('reminder_not_found')
      const { error } = await sb.from('task_reminders').delete().eq('id', args.id)
      if (error) throw new Error(error.message)
      return { deleted: true, id: args.id }
    },
  },
]

const toolMeta = (t: Tool) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, scope: t.scope })

/**
 * Portões que valem para /tools/list e /tools/call: whitelist de IP do tenant e
 * token bucket da chave. Devolve a resposta de recusa ou null para seguir.
 */
async function guard(req: Request, ctx: AuthCtx, endpoint: string, ip: string | null): Promise<Response | null> {
  const ua = req.headers.get('user-agent')

  if (!(await ipPermitido(ctx.tenantId, ip))) {
    await logIpDenial(ctx.tenantId, ip, endpoint, req.method, 'fora da whitelist do tenant', ua)
    await audit(ctx, null, 'error', 'ip_not_allowed')
    return err(403, 'ip_not_allowed')
  }

  const rl = await consumirToken(ctx.keyHash, ctx.tenantId, ip)
  if (!rl.allowed) {
    await registrarEventoRl(ctx.keyHash, endpoint, req.method, ip, 'blocked', 0, ua)
    await audit(ctx, null, 'error', 'rate_limited')
    return err(429, 'rate_limited', rl.retryAfter ? { retry_after_seconds: rl.retryAfter } : {})
  }
  // Aviso a partir de 20% restantes — mesmo limiar do middleware do front.
  if (rl.status === 'warning' || rl.remaining <= Math.ceil(BUCKET_CAPACIDADE * 0.2)) {
    await registrarEventoRl(ctx.keyHash, endpoint, req.method, ip, 'warning', rl.remaining, ua)
  }
  return null
}

// ---------- handler ----------
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const url = new URL(req.url)
  // A URL pode chegar com ou sem o prefixo do nome da function e com ou sem /mcp:
  // normaliza tudo para /mcp/<rota>.
  const semPrefixo = url.pathname.replace(/^\/hermes-mcp/, '').replace(/\/+$/, '').replace(/^\/mcp(?=\/|$)/, '')
  const path = semPrefixo ? `/mcp${semPrefixo}` : '/mcp'
  const ip = clientIp(req)

  if (path === '/mcp/health' && req.method === 'GET') {
    return json({ ok: true, service: 'hermes-mcp', version: 1 })
  }

  if ((path !== '/mcp/tools/list' && path !== '/mcp/tools/call') || req.method !== 'POST') {
    return err(404, 'not_found', { path: url.pathname })
  }

  if (await ipBloqueado(ip)) {
    await logIpDenial(null, ip, path, req.method, 'IP bloqueado em suspicious_ips', req.headers.get('user-agent'))
    return err(403, 'ip_blocked')
  }

  if (path === '/mcp/tools/list') {
    const auth = await authenticate(req)
    if (!auth.ctx) {
      if (auth.reason === 'unauthorized') await registrarFalhaDeAuth(ip)
      return err(401, auth.reason || 'unauthorized')
    }
    const barrado = await guard(req, auth.ctx, path, ip)
    if (barrado) return barrado
    let body: any = {}
    try { body = await req.json() } catch (_) { body = {} }
    const names = Array.isArray(body?.tools) ? body.tools.map(String) : []
    const items = names.length
      ? TOOLS.filter((t) => names.includes(t.name)).map(toolMeta)
      : TOOLS.map(toolMeta)
    await audit(auth.ctx, null, 'ok', null, { op: 'tools/list', filter: names })
    return json({ tools: items })
  }

  if (path === '/mcp/tools/call') {
    const auth = await authenticate(req)
    if (!auth.ctx) {
      if (auth.reason === 'unauthorized') await registrarFalhaDeAuth(ip)
      return err(401, auth.reason || 'unauthorized')
    }
    const ctx = auth.ctx
    const barrado = await guard(req, ctx, path, ip)
    if (barrado) return barrado
    let body: any = {}
    try { body = await req.json() } catch (_) { body = {} }
    const name = body?.name
    const args = body?.arguments ?? {}
    if (!name) { await audit(ctx, null, 'error', 'missing_tool_name'); return err(400, 'missing_tool_name') }
    const tool = TOOLS.find((t) => t.name === name)
    if (!tool) { await audit(ctx, name, 'error', 'tool_not_found'); return err(404, 'tool_not_found', { name }) }
    if (!ctx.scopes.includes(tool.scope)) {
      await audit(ctx, name, 'error', 'forbidden_scope')
      return err(403, 'forbidden_scope', { name, scope: tool.scope })
    }
    const v = invalidInput(args || {}, tool.inputSchema)
    if (v) { await audit(ctx, name, 'error', `invalid_input:${v}`); return err(422, 'invalid_input', { path: String(v) }) }
    try {
      const result = await tool.handler(args || {}, ctx)
      await audit(ctx, name, 'ok', null, { args })
      return json({ ok: true, name, result })
    } catch (e: any) {
      const msg = e?.message || 'server_error'
      await audit(ctx, name, 'error', msg, { args })
      return new Response(JSON.stringify({ ok: false, name, error: msg }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  }

  return err(404, 'not_found', { path })
})
