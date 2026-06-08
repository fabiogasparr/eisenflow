// Hermes-compatible MCP HTTP endpoint
// Contract:
//   POST /mcp/tools/list  { tools?: string[] } -> { tools: [{name,description,inputSchema}] }
//   POST /mcp/tools/call  { name, arguments }  -> { ok:true, name, result } | { ok:false, error, ... }
//   GET  /mcp/health (no auth)
// Auth: header `x-api-key: efk_<prefix>_<secret>` issued per tenant.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
async function sha256Hex(input: string) {
  const bytes = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
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

// ---------- handler ----------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const url = new URL(req.url)
  // Strip function name prefix
  const path = url.pathname.replace(/^\/hermes-mcp/, '').replace(/\/$/, '') || '/'

  if (path === '/mcp/health' && req.method === 'GET') {
    return json({ ok: true, service: 'hermes-mcp', version: 1 })
  }

  if (path === '/mcp/tools/list' && req.method === 'POST') {
    const auth = await authenticate(req)
    if (!auth.ctx) return err(401, auth.reason || 'unauthorized')
    let body: any = {}
    try { body = await req.json() } catch (_) { body = {} }
    const names = Array.isArray(body?.tools) ? body.tools.map(String) : []
    const items = names.length
      ? TOOLS.filter((t) => names.includes(t.name)).map(toolMeta)
      : TOOLS.map(toolMeta)
    await audit(auth.ctx, null, 'ok', null, { op: 'tools/list', filter: names })
    return json({ tools: items })
  }

  if (path === '/mcp/tools/call' && req.method === 'POST') {
    const auth = await authenticate(req)
    if (!auth.ctx) return err(401, auth.reason || 'unauthorized')
    const ctx = auth.ctx
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
