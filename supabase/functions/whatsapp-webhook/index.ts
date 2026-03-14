import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

// ── AI Tool definitions for the Lovable AI Gateway ──
const AI_TOOLS = [
  {
    type: "function",
    function: {
      name: "create_task",
      description: "Criar uma nova tarefa para o usuário",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Título da tarefa" },
          description: { type: "string", description: "Descrição opcional" },
          quadrant: { type: "string", enum: ["do", "schedule", "delegate", "eliminate"], description: "Quadrante da matriz (do=urgente+importante, schedule=importante, delegate=urgente, eliminate=nem urgente nem importante)" },
          urgency: { type: "number", description: "1-5" },
          importance: { type: "number", description: "1-5" },
          due_date: { type: "string", description: "Data de prazo no formato ISO 8601, ex: 2026-03-20T00:00:00Z" },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_tasks",
      description: "Listar as tarefas pendentes/em andamento do usuário",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "complete_task",
      description: "Marcar uma tarefa como concluída pelo índice na lista",
      parameters: {
        type: "object",
        properties: { task_index: { type: "number", description: "Índice da tarefa (1-based)" } },
        required: ["task_index"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "start_task",
      description: "Marcar uma tarefa como em andamento pelo índice",
      parameters: {
        type: "object",
        properties: { task_index: { type: "number", description: "Índice da tarefa (1-based)" } },
        required: ["task_index"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "urgent_task",
      description: "Mover uma tarefa para o quadrante 'Fazer Agora' (urgente + importante)",
      parameters: {
        type: "object",
        properties: { task_index: { type: "number", description: "Índice da tarefa (1-based)" } },
        required: ["task_index"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_task",
      description: "Excluir/eliminar uma tarefa pelo índice",
      parameters: {
        type: "object",
        properties: { task_index: { type: "number", description: "Índice da tarefa (1-based)" } },
        required: ["task_index"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_task",
      description: "Atualizar campos de uma tarefa existente",
      parameters: {
        type: "object",
        properties: {
          task_index: { type: "number", description: "Índice da tarefa (1-based)" },
          title: { type: "string" },
          description: { type: "string" },
          quadrant: { type: "string", enum: ["do", "schedule", "delegate", "eliminate"] },
          urgency: { type: "number" },
          importance: { type: "number" },
          due_date: { type: "string" },
        },
        required: ["task_index"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delegate_task",
      description: "Delegar uma tarefa para um membro do time",
      parameters: {
        type: "object",
        properties: {
          task_index: { type: "number", description: "Índice da tarefa (1-based)" },
          member_name: { type: "string", description: "Nome (ou parte) do membro para quem delegar" },
        },
        required: ["task_index", "member_name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "schedule_task",
      description: "Agendar uma tarefa com prazo específico",
      parameters: {
        type: "object",
        properties: {
          task_index: { type: "number", description: "Índice da tarefa (1-based)" },
          due_date: { type: "string", description: "Data no formato ISO 8601" },
        },
        required: ["task_index", "due_date"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "chat_response",
      description: "Responder ao usuário com uma mensagem conversacional quando nenhuma ação de tarefa é necessária",
      parameters: {
        type: "object",
        properties: { message: { type: "string", description: "A mensagem de resposta" } },
        required: ["message"],
        additionalProperties: false,
      },
    },
  },
]

// ── Helper: fetch user tasks for context ──
async function getUserTasks(supabaseAdmin: any, userId: string) {
  const { data: tasks } = await supabaseAdmin
    .from('tasks')
    .select('id, title, status, quadrant, due_date, assigned_to, urgency, importance')
    .eq('created_by', userId)
    .in('status', ['pending', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(20)
  return tasks || []
}

// ── Helper: fetch team members for context ──
async function getTeamMembers(supabaseAdmin: any, userId: string) {
  const { data: userTeams } = await supabaseAdmin
    .from('team_members').select('team_id').eq('user_id', userId)
  if (!userTeams?.length) return []
  const teamIds = userTeams.map((t: any) => t.team_id)
  const { data: members } = await supabaseAdmin
    .from('team_members').select('user_id, team_id').in('team_id', teamIds).neq('user_id', userId)
  if (!members?.length) return []
  const memberIds = [...new Set(members.map((m: any) => m.user_id))]
  const { data: profiles } = await supabaseAdmin
    .from('profiles').select('user_id, display_name').in('user_id', memberIds)
  return (profiles || []).filter((p: any) => p.display_name)
}

// ── Helper: execute a tool call returned by the AI ──
async function executeToolCall(
  toolName: string,
  args: any,
  supabaseAdmin: any,
  userId: string,
  tasks: any[],
  teamMembers: any[],
  EVOLUTION_API_URL: string,
  EVOLUTION_API_KEY: string,
): Promise<string> {
  const quadrantEmoji: Record<string, string> = { do: '🔴', schedule: '🔵', delegate: '🟡', eliminate: '⚪' }
  const statusEmoji: Record<string, string> = { pending: '⏳', in_progress: '🔄' }

  switch (toolName) {
    case 'create_task': {
      const insertData: any = {
        title: args.title,
        created_by: userId,
        quadrant: args.quadrant || 'do',
        status: 'pending',
      }
      if (args.description) insertData.description = args.description
      if (args.urgency) insertData.urgency = args.urgency
      if (args.importance) insertData.importance = args.importance
      if (args.due_date) insertData.due_date = args.due_date
      const { error } = await supabaseAdmin.from('tasks').insert(insertData)
      return error ? `❌ Erro ao criar: ${error.message}` : `✅ Tarefa criada: *${args.title}*`
    }

    case 'list_tasks': {
      if (!tasks.length) return '📋 Nenhuma tarefa pendente!'
      return '📋 *Suas tarefas:*\n\n' +
        tasks.map((t: any, i: number) =>
          `${i + 1}. ${statusEmoji[t.status] || ''} ${quadrantEmoji[t.quadrant] || ''} ${t.title}${t.due_date ? ` (📅 ${new Date(t.due_date).toLocaleDateString('pt-BR')})` : ''}`
        ).join('\n')
    }

    case 'complete_task': {
      const idx = (args.task_index || 0) - 1
      if (idx < 0 || idx >= tasks.length) return '❌ Tarefa não encontrada'
      const task = tasks[idx]
      await supabaseAdmin.from('tasks')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', task.id)
      return `✅ Tarefa concluída: *${task.title}*`
    }

    case 'start_task': {
      const idx = (args.task_index || 0) - 1
      if (idx < 0 || idx >= tasks.length) return '❌ Tarefa não encontrada'
      const task = tasks[idx]
      await supabaseAdmin.from('tasks')
        .update({ status: 'in_progress', started_at: new Date().toISOString(), quadrant: 'do' })
        .eq('id', task.id)
      return `🔄 Em andamento: *${task.title}*`
    }

    case 'urgent_task': {
      const idx = (args.task_index || 0) - 1
      if (idx < 0 || idx >= tasks.length) return '❌ Tarefa não encontrada'
      const task = tasks[idx]
      await supabaseAdmin.from('tasks')
        .update({ quadrant: 'do', urgency: 5, importance: 5 })
        .eq('id', task.id)
      return `🔴 Movida para "Fazer Agora": *${task.title}*`
    }

    case 'delete_task': {
      const idx = (args.task_index || 0) - 1
      if (idx < 0 || idx >= tasks.length) return '❌ Tarefa não encontrada'
      const task = tasks[idx]
      await supabaseAdmin.from('tasks')
        .update({ status: 'eliminated' })
        .eq('id', task.id)
      return `🗑️ Tarefa eliminada: *${task.title}*`
    }

    case 'update_task': {
      const idx = (args.task_index || 0) - 1
      if (idx < 0 || idx >= tasks.length) return '❌ Tarefa não encontrada'
      const task = tasks[idx]
      const updateData: any = {}
      if (args.title) updateData.title = args.title
      if (args.description) updateData.description = args.description
      if (args.quadrant) updateData.quadrant = args.quadrant
      if (args.urgency) updateData.urgency = args.urgency
      if (args.importance) updateData.importance = args.importance
      if (args.due_date) updateData.due_date = args.due_date
      if (Object.keys(updateData).length === 0) return '⚠️ Nenhum campo para atualizar.'
      await supabaseAdmin.from('tasks').update(updateData).eq('id', task.id)
      return `✏️ Tarefa atualizada: *${task.title}*`
    }

    case 'delegate_task': {
      const idx = (args.task_index || 0) - 1
      if (idx < 0 || idx >= tasks.length) return '❌ Tarefa não encontrada'
      const task = tasks[idx]
      const searchLower = (args.member_name || '').toLowerCase()
      const matched = teamMembers.find((p: any) => p.display_name.toLowerCase().includes(searchLower))
      if (!matched) {
        const names = teamMembers.map((p: any) => p.display_name).join(', ')
        return `❌ Membro "${args.member_name}" não encontrado.\n\n👥 *Membros disponíveis:* ${names || 'nenhum'}`
      }
      await supabaseAdmin.from('tasks')
        .update({ assigned_to: matched.user_id, quadrant: 'delegate' })
        .eq('id', task.id)
      await supabaseAdmin.from('delegations').insert({
        task_id: task.id,
        delegated_by: userId,
        delegated_to: matched.user_id,
        status: 'pending',
      })

      // Notify delegated member via WhatsApp
      try {
        const { data: delegateConn } = await supabaseAdmin
          .from('whatsapp_connections')
          .select('instance_name, phone_number, status')
          .eq('user_id', matched.user_id)
          .eq('status', 'connected')
          .maybeSingle()
        if (delegateConn?.phone_number && delegateConn?.instance_name) {
          const { data: delegatorProfile } = await supabaseAdmin
            .from('profiles').select('display_name').eq('user_id', userId).single()
          const delegatorName = delegatorProfile?.display_name || 'Alguém'
          await fetch(`${EVOLUTION_API_URL}/message/sendText/${delegateConn.instance_name}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
            body: JSON.stringify({
              number: delegateConn.phone_number,
              text: `📥 *Nova tarefa delegada para você!*\n\n📝 *${task.title}*\n👤 Delegada por: ${delegatorName}\n\nUse /listar para ver suas tarefas.`,
            }),
          })
        }
      } catch (e) { console.error('Failed to notify delegate:', e) }

      return `🟦 Tarefa delegada para *${matched.display_name}*: *${task.title}*`
    }

    case 'schedule_task': {
      const idx = (args.task_index || 0) - 1
      if (idx < 0 || idx >= tasks.length) return '❌ Tarefa não encontrada'
      const task = tasks[idx]
      await supabaseAdmin.from('tasks')
        .update({ due_date: args.due_date, quadrant: 'schedule' })
        .eq('id', task.id)
      const dateStr = new Date(args.due_date).toLocaleDateString('pt-BR')
      return `📅 Tarefa agendada para ${dateStr}: *${task.title}*`
    }

    case 'chat_response': {
      return args.message || '🤔 Não entendi. Pode reformular?'
    }

    default:
      return '❓ Ação não reconhecida.'
  }
}

// ── Helper: get recent chat history ──
async function getChatHistory(supabaseAdmin: any, userId: string, limit = 10) {
  const { data } = await supabaseAdmin
    .from('whatsapp_chat_history')
    .select('role, content')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data || []).reverse()
}

// ── Helper: save chat message ──
async function saveChatMessage(supabaseAdmin: any, userId: string, role: string, content: string) {
  await supabaseAdmin.from('whatsapp_chat_history').insert({ user_id: userId, role, content })
}

// ── Helper: trim old history (keep last N messages per user) ──
async function trimChatHistory(supabaseAdmin: any, userId: string, keepLast = 30) {
  const { data } = await supabaseAdmin
    .from('whatsapp_chat_history')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(keepLast, keepLast + 100)
  if (data?.length) {
    const idsToDelete = data.map((r: any) => r.id)
    await supabaseAdmin.from('whatsapp_chat_history').delete().in('id', idsToDelete)
  }
}

// ── AI processing for natural language messages ──
async function processWithAI(
  messageText: string,
  supabaseAdmin: any,
  userId: string,
  EVOLUTION_API_URL: string,
  EVOLUTION_API_KEY: string,
): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')
  if (!LOVABLE_API_KEY) {
    return '⚠️ IA não configurada. Use comandos com / (ex: /ajuda)'
  }

  // Fetch context and history in parallel
  const [tasks, teamMembers, chatHistory] = await Promise.all([
    getUserTasks(supabaseAdmin, userId),
    getTeamMembers(supabaseAdmin, userId),
    getChatHistory(supabaseAdmin, userId),
  ])

  // Save user message to history
  await saveChatMessage(supabaseAdmin, userId, 'user', messageText)

  const quadrantLabels: Record<string, string> = {
    do: 'Fazer Agora', schedule: 'Agendar', delegate: 'Delegar', eliminate: 'Eliminar'
  }
  const statusLabels: Record<string, string> = {
    pending: 'Pendente', in_progress: 'Em andamento'
  }

  const taskListContext = tasks.length > 0
    ? tasks.map((t: any, i: number) =>
        `${i + 1}. "${t.title}" [${statusLabels[t.status] || t.status}] [${quadrantLabels[t.quadrant] || t.quadrant}]${t.due_date ? ` Prazo: ${new Date(t.due_date).toLocaleDateString('pt-BR')}` : ''}`
      ).join('\n')
    : 'Nenhuma tarefa pendente.'

  const membersContext = teamMembers.length > 0
    ? teamMembers.map((m: any) => m.display_name).join(', ')
    : 'Nenhum membro de time disponível.'

  const today = new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const systemPrompt = `Você é um assistente de produtividade via WhatsApp. Hoje é ${today}.
O usuário gerencia tarefas usando a Matriz de Eisenhower (quadrantes: do, schedule, delegate, eliminate).

TAREFAS ATUAIS DO USUÁRIO:
${taskListContext}

MEMBROS DO TIME (para delegação):
${membersContext}

REGRAS:
- Use as tools disponíveis para executar ações (criar, concluir, editar, delegar, agendar, listar tarefas).
- Se o usuário pedir algo que não envolve tarefas, responda usando chat_response.
- task_index é 1-based (1 = primeira tarefa da lista).
- Quando o usuário mencionar uma tarefa por nome, encontre o índice correto na lista acima.
- Para criar tarefas, escolha o quadrante adequado com base no contexto.
- Seja conciso e amigável nas respostas. Use emojis de forma moderada.
- Responda sempre em português brasileiro.
- Se a mensagem for ambígua, peça esclarecimento via chat_response.`

  try {
    // Build messages array with history
    const aiMessages: any[] = [
      { role: 'system', content: systemPrompt },
      ...chatHistory.map((m: any) => ({ role: m.role, content: m.content })),
      { role: 'user', content: messageText },
    ]

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: aiMessages,
        tools: AI_TOOLS,
        tool_choice: 'auto',
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('AI Gateway error:', response.status, errText)
      if (response.status === 429) return '⏳ Muitas mensagens. Tente novamente em alguns segundos.'
      if (response.status === 402) return '⚠️ Créditos de IA esgotados.'
      return '⚠️ Erro ao processar sua mensagem. Use /ajuda para ver comandos disponíveis.'
    }

    const data = await response.json()
    const choice = data.choices?.[0]

    // Handle tool calls
    if (choice?.message?.tool_calls?.length) {
      const results: string[] = []
      for (const toolCall of choice.message.tool_calls) {
        const fnName = toolCall.function?.name
        let fnArgs: any = {}
        try {
          fnArgs = JSON.parse(toolCall.function?.arguments || '{}')
        } catch { /* empty args */ }
        const result = await executeToolCall(
          fnName, fnArgs, supabaseAdmin, userId, tasks, teamMembers,
          EVOLUTION_API_URL, EVOLUTION_API_KEY,
        )
        results.push(result)
      }
      const reply = results.join('\n\n')
      // Save assistant response and trim old messages
      await saveChatMessage(supabaseAdmin, userId, 'assistant', reply)
      trimChatHistory(supabaseAdmin, userId).catch(() => {})
      return reply
    }

    // Fallback: plain text response from the AI
    const textContent = choice?.message?.content
    if (textContent) {
      await saveChatMessage(supabaseAdmin, userId, 'assistant', textContent)
      trimChatHistory(supabaseAdmin, userId).catch(() => {})
      return textContent
    }
  } catch (err) {
    console.error('AI processing error:', err)
    return '⚠️ Erro ao processar sua mensagem. Use /ajuda para ver comandos disponíveis.'
  }
}

// ── Main handler ──
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    const EVOLUTION_API_URL = Deno.env.get('EVOLUTION_API_URL')!
    const EVOLUTION_API_KEY = Deno.env.get('EVOLUTION_API_KEY')!

    const body = await req.json()
    console.log('whatsapp-webhook received:', JSON.stringify(body).substring(0, 500))

    const event = (body.event || '').toString()
    const instanceName = body.instance || body.instanceName || body.data?.instance

    if (!instanceName) {
      console.log('No instanceName found, skipping')
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
    }

    // ── Handle connection status updates ──
    const isConnectionUpdate = event === 'CONNECTION_UPDATE' || 
      event === 'connection.update' ||
      event.toLowerCase() === 'connection_update' ||
      body.data?.action === 'update'

    if (isConnectionUpdate) {
      const state = body.data?.state || body.data?.status || body.data?.instance?.state
      console.log('Connection update for', instanceName, '- state:', state)

      if (state === 'open' || state === 'connected') {
        let phoneNumber: string | null = null
        try {
          const infoRes = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances?instanceName=${instanceName}`, {
            headers: { apikey: EVOLUTION_API_KEY },
          })
          if (infoRes.ok) {
            const infoData = await infoRes.json()
            const instance = Array.isArray(infoData) ? infoData[0] : infoData
            phoneNumber = instance?.ownerJid || instance?.instance?.owner || instance?.owner || null
            if (phoneNumber) phoneNumber = phoneNumber.replace(/@.*$/, '')
          }
        } catch (e) { console.error('Failed to fetch instance info:', e) }

        await supabaseAdmin
          .from('whatsapp_connections')
          .update({ status: 'connected', qr_code: null, phone_number: phoneNumber })
          .eq('instance_name', instanceName)
      } else if (state === 'close' || state === 'disconnected') {
        await supabaseAdmin
          .from('whatsapp_connections')
          .update({ status: 'disconnected', qr_code: null })
          .eq('instance_name', instanceName)
      }
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
    }

    // ── Handle incoming messages ──
    if (event === 'MESSAGES_UPSERT' || body.data?.message) {
      const msgData = body.data
      if (!msgData) return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })

      const messageText = msgData.message?.conversation ||
        msgData.message?.extendedTextMessage?.text || ''
      const fromMe = msgData.key?.fromMe === true

      if (!messageText.trim()) {
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
      }

      const { data: conn } = await supabaseAdmin
        .from('whatsapp_connections')
        .select('user_id, phone_number, accept_messages_from')
        .eq('instance_name', instanceName)
        .single()

      if (!conn) return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })

      const acceptFrom = conn.accept_messages_from || 'self_only'
      if (acceptFrom === 'self_only' && !fromMe) {
        console.log('Ignored message: not from self')
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
      }

      const userId = conn.user_id
      let replyText = ''

      // ── Route: structured commands (/) or AI processing ──
      if (messageText.startsWith('/')) {
        replyText = await processCommand(messageText, supabaseAdmin, userId, EVOLUTION_API_URL, EVOLUTION_API_KEY)
      } else {
        replyText = await processWithAI(messageText, supabaseAdmin, userId, EVOLUTION_API_URL, EVOLUTION_API_KEY)
      }

      // Send reply
      if (replyText && conn.phone_number) {
        await fetch(`${EVOLUTION_API_URL}/message/sendText/${instanceName}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
          body: JSON.stringify({ number: conn.phone_number, text: replyText }),
        })
      }

      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
    }

    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
  } catch (error) {
    console.error('whatsapp-webhook error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

// ── Structured command processing (existing /commands) ──
async function processCommand(
  messageText: string,
  supabaseAdmin: any,
  userId: string,
  EVOLUTION_API_URL: string,
  EVOLUTION_API_KEY: string,
): Promise<string> {
  const command = messageText.trim().toLowerCase()
  const parts = command.split(' ')
  const cmd = parts[0]
  const args = parts.slice(1).join(' ')

  const quadrantEmoji: Record<string, string> = { do: '🔴', schedule: '🔵', delegate: '🟡', eliminate: '⚪' }
  const statusEmoji: Record<string, string> = { pending: '⏳', in_progress: '🔄' }

  if (cmd === '/nova' || cmd === '/new') {
    if (!args) return '⚠️ Use: /nova Título da tarefa'
    const { error } = await supabaseAdmin
      .from('tasks')
      .insert({ title: args, created_by: userId, quadrant: 'do', status: 'pending' })
    return error ? `❌ Erro: ${error.message}` : `✅ Tarefa criada: *${args}*`
  }

  if (cmd === '/listar' || cmd === '/list') {
    const { data: tasks } = await supabaseAdmin
      .from('tasks')
      .select('title, status, quadrant')
      .eq('created_by', userId)
      .in('status', ['pending', 'in_progress'])
      .order('created_at', { ascending: false })
      .limit(15)
    if (!tasks?.length) return '📋 Nenhuma tarefa pendente!'
    return '📋 *Suas tarefas:*\n\n' +
      tasks.map((t: any, i: number) => `${i + 1}. ${statusEmoji[t.status] || ''} ${quadrantEmoji[t.quadrant] || ''} ${t.title}`).join('\n')
  }

  if (cmd === '/concluir' || cmd === '/done') {
    const idx = parseInt(args) - 1
    if (isNaN(idx) || idx < 0) return '⚠️ Use: /concluir [número]'
    const { data: tasks } = await supabaseAdmin
      .from('tasks').select('id, title').eq('created_by', userId)
      .in('status', ['pending', 'in_progress']).order('created_at', { ascending: false }).limit(15)
    if (!tasks?.[idx]) return '❌ Tarefa não encontrada'
    await supabaseAdmin.from('tasks')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', tasks[idx].id)
    return `✅ Tarefa concluída: *${tasks[idx].title}*`
  }

  if (cmd === '/andamento' || cmd === '/progress') {
    const idx = parseInt(args) - 1
    if (isNaN(idx) || idx < 0) return '⚠️ Use: /andamento [número]'
    const { data: tasks } = await supabaseAdmin
      .from('tasks').select('id, title').eq('created_by', userId)
      .in('status', ['pending', 'in_progress']).order('created_at', { ascending: false }).limit(15)
    if (!tasks?.[idx]) return '❌ Tarefa não encontrada'
    await supabaseAdmin.from('tasks')
      .update({ status: 'in_progress', started_at: new Date().toISOString(), quadrant: 'do' })
      .eq('id', tasks[idx].id)
    return `🔄 Em andamento: *${tasks[idx].title}*`
  }

  if (cmd === '/urgente' || cmd === '/urgent') {
    const idx = parseInt(args) - 1
    if (isNaN(idx) || idx < 0) return '⚠️ Use: /urgente [número]'
    const { data: tasks } = await supabaseAdmin
      .from('tasks').select('id, title').eq('created_by', userId)
      .in('status', ['pending', 'in_progress']).order('created_at', { ascending: false }).limit(15)
    if (!tasks?.[idx]) return '❌ Tarefa não encontrada'
    await supabaseAdmin.from('tasks')
      .update({ quadrant: 'do', urgency: 5, importance: 5 })
      .eq('id', tasks[idx].id)
    return `🔴 Movida para "Fazer Agora": *${tasks[idx].title}*`
  }

  if (cmd === '/delegar' || cmd === '/delegate') {
    const delegateParts = args.split(' ')
    const idx = parseInt(delegateParts[0]) - 1
    const memberSearch = delegateParts.slice(1).join(' ').trim()
    if (isNaN(idx) || idx < 0 || !memberSearch) return '⚠️ Use: /delegar [número] [nome do membro]\nEx: /delegar 1 João'

    const { data: tasks } = await supabaseAdmin
      .from('tasks').select('id, title, project_id').eq('created_by', userId)
      .in('status', ['pending', 'in_progress']).order('created_at', { ascending: false }).limit(15)
    if (!tasks?.[idx]) return '❌ Tarefa não encontrada'

    const task = tasks[idx]
    const { data: userTeams } = await supabaseAdmin
      .from('team_members').select('team_id').eq('user_id', userId)
    if (!userTeams?.length) return '❌ Você não pertence a nenhum time.'

    const teamIds = userTeams.map((t: any) => t.team_id)
    const { data: teammates } = await supabaseAdmin
      .from('team_members').select('user_id, team_id').in('team_id', teamIds).neq('user_id', userId)
    if (!teammates?.length) return '❌ Nenhum membro encontrado nos seus times.'

    const teammateIds = [...new Set(teammates.map((t: any) => t.user_id))]
    const { data: profiles } = await supabaseAdmin
      .from('profiles').select('user_id, display_name').in('user_id', teammateIds)

    const searchLower = memberSearch.toLowerCase()
    const matchedProfile = (profiles ?? []).find((p: any) =>
      p.display_name?.toLowerCase().includes(searchLower)
    )
    if (!matchedProfile) {
      const names = (profiles ?? []).filter((p: any) => p.display_name).map((p: any) => p.display_name).join(', ')
      return `❌ Membro "${memberSearch}" não encontrado.\n\n👥 *Membros disponíveis:* ${names || 'nenhum'}`
    }

    await supabaseAdmin.from('tasks')
      .update({ assigned_to: matchedProfile.user_id, quadrant: 'delegate' })
      .eq('id', task.id)
    await supabaseAdmin.from('delegations').insert({
      task_id: task.id, delegated_by: userId,
      delegated_to: matchedProfile.user_id, status: 'pending',
    })

    try {
      const { data: delegateConn } = await supabaseAdmin
        .from('whatsapp_connections')
        .select('instance_name, phone_number, status')
        .eq('user_id', matchedProfile.user_id).eq('status', 'connected').maybeSingle()
      if (delegateConn?.phone_number && delegateConn?.instance_name) {
        const { data: delegatorProfile } = await supabaseAdmin
          .from('profiles').select('display_name').eq('user_id', userId).single()
        await fetch(`${EVOLUTION_API_URL}/message/sendText/${delegateConn.instance_name}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
          body: JSON.stringify({
            number: delegateConn.phone_number,
            text: `📥 *Nova tarefa delegada para você!*\n\n📝 *${task.title}*\n👤 Delegada por: ${delegatorProfile?.display_name || 'Alguém'}\n\nUse /listar para ver suas tarefas.`,
          }),
        })
      }
    } catch (e) { console.error('Failed to notify delegate:', e) }

    return `🟦 Tarefa delegada para *${matchedProfile.display_name}*: *${task.title}*`
  }

  if (cmd === '/membros' || cmd === '/members') {
    const { data: userTeams } = await supabaseAdmin
      .from('team_members').select('team_id').eq('user_id', userId)
    if (!userTeams?.length) return '❌ Você não pertence a nenhum time.'

    const teamIds = userTeams.map((t: any) => t.team_id)
    const { data: teams } = await supabaseAdmin.from('teams').select('id, name').in('id', teamIds)
    const { data: allMembers } = await supabaseAdmin
      .from('team_members').select('user_id, team_id, role').in('team_id', teamIds)

    const memberIds = [...new Set((allMembers ?? []).map((m: any) => m.user_id))]
    const { data: profiles } = await supabaseAdmin
      .from('profiles').select('user_id, display_name').in('user_id', memberIds)

    const profileMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p.display_name || 'Sem nome']))
    const teamMap = new Map((teams ?? []).map((t: any) => [t.id, t.name]))
    const roleEmoji: Record<string, string> = { admin: '👑', manager: '⭐', member: '👤' }

    const teamGroups: Record<string, string[]> = {}
    for (const m of (allMembers ?? [])) {
      const teamName = teamMap.get(m.team_id) || 'Time'
      if (!teamGroups[teamName]) teamGroups[teamName] = []
      teamGroups[teamName].push(`${roleEmoji[m.role] || '👤'} ${profileMap.get(m.user_id) || 'Sem nome'}${m.user_id === userId ? ' (você)' : ''}`)
    }

    let reply = '👥 *Seus times e membros:*\n'
    for (const [teamName, members] of Object.entries(teamGroups)) {
      reply += `\n📌 *${teamName}*\n` + members.join('\n') + '\n'
    }
    return reply
  }

  if (cmd === '/relatorio' || cmd === '/report') {
    const reportArg = args.trim().toLowerCase()
    const now = new Date()

    if (reportArg === 'diario' || reportArg === 'daily' || reportArg === 'dia' || reportArg === 'hoje') {
      // Daily report on demand
      const [tasksRes, gamifRes] = await Promise.all([
        supabaseAdmin.from('tasks').select('title, status, quadrant, due_date')
          .eq('created_by', userId),
        supabaseAdmin.from('gamification').select('*')
          .eq('user_id', userId).maybeSingle(),
      ])
      const allTasks = tasksRes.data || []
      const gamif = gamifRes.data
      const fmtDate = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
      const dateStr = fmtDate(now)
      const completed = allTasks.filter((t: any) => t.status === 'completed').length
      const inProgress = allTasks.filter((t: any) => t.status === 'in_progress').length
      const pending = allTasks.filter((t: any) => t.status === 'pending').length
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      const upcoming = allTasks
        .filter((t: any) => t.due_date && t.status !== 'completed' && t.status !== 'eliminated')
        .filter((t: any) => { const due = new Date(t.due_date!); return due >= now && due <= nextWeek })
        .sort((a: any, b: any) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())
        .slice(0, 5)
      let report = `📊 *Relatório Diário - ${dateStr}*\n\n`
      report += `✅ *Concluídas:* ${completed} tarefas\n`
      report += `🔄 *Em andamento:* ${inProgress} tarefas\n`
      report += `⏳ *Pendentes:* ${pending} tarefas\n`
      if (upcoming.length > 0) {
        report += `\n🔥 *Próximos prazos:*\n`
        for (const task of upcoming) {
          const due = new Date(task.due_date!)
          const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          const label = diffDays === 0 ? 'hoje' : diffDays === 1 ? 'amanhã' : `em ${diffDays} dias`
          report += `• ${task.title} - ${label}\n`
        }
      }
      if (gamif) {
        report += `\n🍅 *Pomodoros:* ${gamif.total_pomodoros} completados\n`
        report += `🏆 *Nível:* ${gamif.level} (${gamif.xp.toLocaleString()} XP)\n`
        if (gamif.current_streak > 0) report += `🔥 *Streak:* ${gamif.current_streak} dias\n`
      }
      return report
    }

    // Default: weekly report
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const weekAgoISO = weekAgo.toISOString()

    const [completedRes, createdRes, metricsRes, pendingRes, gamifRes] = await Promise.all([
      supabaseAdmin.from('tasks').select('id, title, quadrant, completed_at')
        .eq('created_by', userId).eq('status', 'completed')
        .gte('completed_at', weekAgoISO),
      supabaseAdmin.from('tasks').select('id')
        .eq('created_by', userId).gte('created_at', weekAgoISO),
      supabaseAdmin.from('productivity_metrics').select('*')
        .eq('user_id', userId).gte('date', weekAgo.toISOString().split('T')[0])
        .order('date', { ascending: true }),
      supabaseAdmin.from('tasks').select('id, title, quadrant, due_date')
        .eq('created_by', userId).in('status', ['pending', 'in_progress']),
      supabaseAdmin.from('gamification').select('*')
        .eq('user_id', userId).maybeSingle(),
    ])

    const completed = completedRes.data || []
    const created = createdRes.data || []
    const metrics = metricsRes.data || []
    const pending = pendingRes.data || []
    const gamif = gamifRes.data

    const totalPomodoros = metrics.reduce((s: number, m: any) => s + (m.pomodoros_completed || 0), 0)
    const totalFocusMin = metrics.reduce((s: number, m: any) => s + (m.time_in_important || 0), 0)
    const totalDelegated = metrics.reduce((s: number, m: any) => s + (m.tasks_delegated || 0), 0)
    const totalEliminated = metrics.reduce((s: number, m: any) => s + (m.tasks_eliminated || 0), 0)

    const quadrantCount: Record<string, number> = { do: 0, schedule: 0, delegate: 0, eliminate: 0 }
    for (const t of completed) quadrantCount[t.quadrant] = (quadrantCount[t.quadrant] || 0) + 1

    const overdue = pending.filter((t: any) => t.due_date && new Date(t.due_date) < now)
    const fmtDate = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })

    let reply = `📊 *Relatório Semanal de Produtividade*\n`
    reply += `📅 ${fmtDate(weekAgo)} a ${fmtDate(now)}\n\n`
    reply += `━━━━━━━━━━━━━━━━━━━━━\n`
    reply += `📈 *Resumo Geral*\n`
    reply += `✅ Tarefas concluídas: *${completed.length}*\n`
    reply += `📝 Tarefas criadas: *${created.length}*\n`
    reply += `⏳ Tarefas pendentes: *${pending.length}*\n`
    if (overdue.length > 0) reply += `🚨 Tarefas atrasadas: *${overdue.length}*\n`
    reply += `\n`
    reply += `━━━━━━━━━━━━━━━━━━━━━\n`
    reply += `🎯 *Por Quadrante (concluídas)*\n`
    reply += `🔴 Fazer Agora: ${quadrantCount.do}\n`
    reply += `🔵 Agendar: ${quadrantCount.schedule}\n`
    reply += `🟡 Delegar: ${quadrantCount.delegate}\n`
    reply += `⚪ Eliminar: ${quadrantCount.eliminate}\n\n`

    if (totalPomodoros > 0 || totalFocusMin > 0) {
      reply += `━━━━━━━━━━━━━━━━━━━━━\n`
      reply += `🍅 *Foco & Pomodoros*\n`
      reply += `🍅 Pomodoros: *${totalPomodoros}*\n`
      const hours = Math.floor(totalFocusMin / 60)
      const mins = totalFocusMin % 60
      reply += `⏱️ Tempo de foco: *${hours > 0 ? hours + 'h ' : ''}${mins}min*\n\n`
    }

    if (totalDelegated > 0 || totalEliminated > 0) {
      reply += `🤝 Delegadas: ${totalDelegated} | 🗑️ Eliminadas: ${totalEliminated}\n\n`
    }

    if (gamif) {
      reply += `━━━━━━━━━━━━━━━━━━━━━\n`
      reply += `🏆 *Gamificação*\n`
      reply += `⭐ Nível ${gamif.level} | ${gamif.xp} XP\n`
      reply += `🔥 Streak: ${gamif.current_streak} dias (recorde: ${gamif.longest_streak})\n\n`
    }

    if (overdue.length > 0) {
      reply += `━━━━━━━━━━━━━━━━━━━━━\n`
      reply += `🚨 *Tarefas Atrasadas*\n`
      for (const t of overdue.slice(0, 5)) {
        reply += `• ${t.title} (${fmtDate(new Date(t.due_date))})\n`
      }
      if (overdue.length > 5) reply += `... e mais ${overdue.length - 5}\n`
      reply += `\n`
    }

    const score = completed.length > 0
      ? Math.min(100, Math.round((completed.length / Math.max(created.length, 1)) * 100))
      : 0
    const scoreEmoji = score >= 80 ? '🌟' : score >= 50 ? '👍' : '💪'
    reply += `━━━━━━━━━━━━━━━━━━━━━\n`
    reply += `${scoreEmoji} *Taxa de conclusão: ${score}%*\n`

    if (score >= 80) reply += `Excelente semana! Continue assim! 🚀`
    else if (score >= 50) reply += `Boa semana! Foque nas tarefas importantes. 🎯`
    else reply += `Semana desafiadora. Que tal revisar suas prioridades? 📋`

    return reply
  }

  if (cmd === '/ajuda' || cmd === '/help') {
    return `📖 *Comandos disponíveis:*\n\n` +
      `/nova [título] - Criar tarefa\n` +
      `/listar - Listar tarefas\n` +
      `/concluir [nº] - Concluir tarefa\n` +
      `/andamento [nº] - Marcar em andamento\n` +
      `/urgente [nº] - Mover para "Fazer Agora"\n` +
      `/delegar [nº] [nome] - Delegar tarefa\n` +
      `/membros - Listar membros dos times\n` +
      `/relatorio - Relatório semanal\n` +
      `/ajuda - Este menu\n\n` +
      `💡 *Dica:* Você também pode enviar mensagens em linguagem natural! Ex: "cria uma tarefa para revisar o relatório amanhã"`
  }

  return '❓ Comando não reconhecido. Use /ajuda para ver os comandos disponíveis.'
}
