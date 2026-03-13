import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

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
    const event = body.event
    const instanceName = body.instance || body.instanceName

    if (!instanceName) {
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
    }

    // Handle connection status updates
    if (event === 'CONNECTION_UPDATE' || body.data?.action === 'update') {
      const state = body.data?.state || body.data?.status
      if (state === 'open' || state === 'connected') {
        // Get phone number from instance info
        let phoneNumber: string | null = null
        try {
          const infoRes = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances?instanceName=${instanceName}`, {
            headers: { apikey: EVOLUTION_API_KEY },
          })
          if (infoRes.ok) {
            const infoData = await infoRes.json()
            const instance = Array.isArray(infoData) ? infoData[0] : infoData
            phoneNumber = instance?.instance?.owner || instance?.owner || null
            if (phoneNumber) {
              phoneNumber = phoneNumber.replace(/@.*$/, '') // remove @s.whatsapp.net
            }
          }
        } catch (e) {
          console.error('Failed to fetch instance info:', e)
        }

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

    // Handle incoming messages
    if (event === 'MESSAGES_UPSERT' || body.data?.message) {
      const msgData = body.data
      if (!msgData) return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })

      const messageText = msgData.message?.conversation ||
        msgData.message?.extendedTextMessage?.text || ''
      const fromMe = msgData.key?.fromMe === true

      // Only process messages sent by the user themselves (commands)
      if (!fromMe || !messageText.startsWith('/')) {
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
      }

      // Find user by instance name
      const { data: conn } = await supabaseAdmin
        .from('whatsapp_connections')
        .select('user_id, phone_number')
        .eq('instance_name', instanceName)
        .single()

      if (!conn) {
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
      }

      const userId = conn.user_id
      const command = messageText.trim().toLowerCase()
      const parts = command.split(' ')
      const cmd = parts[0]
      const args = parts.slice(1).join(' ')

      let replyText = ''

      if (cmd === '/nova' || cmd === '/new') {
        if (!args) {
          replyText = '⚠️ Use: /nova Título da tarefa'
        } else {
          const { error } = await supabaseAdmin
            .from('tasks')
            .insert({ title: args, created_by: userId, quadrant: 'do', status: 'pending' })
          replyText = error ? `❌ Erro: ${error.message}` : `✅ Tarefa criada: *${args}*`
        }
      } else if (cmd === '/listar' || cmd === '/list') {
        const { data: tasks } = await supabaseAdmin
          .from('tasks')
          .select('title, status, quadrant')
          .eq('created_by', userId)
          .in('status', ['pending', 'in_progress'])
          .order('created_at', { ascending: false })
          .limit(15)

        if (!tasks || tasks.length === 0) {
          replyText = '📋 Nenhuma tarefa pendente!'
        } else {
          const quadrantEmoji: Record<string, string> = { do: '🔴', schedule: '🔵', delegate: '🟡', eliminate: '⚪' }
          const statusEmoji: Record<string, string> = { pending: '⏳', in_progress: '🔄' }
          replyText = '📋 *Suas tarefas:*\n\n' +
            tasks.map((t, i) => `${i + 1}. ${statusEmoji[t.status] || ''} ${quadrantEmoji[t.quadrant] || ''} ${t.title}`).join('\n')
        }
      } else if (cmd === '/concluir' || cmd === '/done') {
        const idx = parseInt(args) - 1
        if (isNaN(idx) || idx < 0) {
          replyText = '⚠️ Use: /concluir [número]'
        } else {
          const { data: tasks } = await supabaseAdmin
            .from('tasks')
            .select('id, title')
            .eq('created_by', userId)
            .in('status', ['pending', 'in_progress'])
            .order('created_at', { ascending: false })
            .limit(15)

          if (!tasks || !tasks[idx]) {
            replyText = '❌ Tarefa não encontrada'
          } else {
            await supabaseAdmin
              .from('tasks')
              .update({ status: 'completed', completed_at: new Date().toISOString() })
              .eq('id', tasks[idx].id)
            replyText = `✅ Tarefa concluída: *${tasks[idx].title}*`
          }
        }
      } else if (cmd === '/andamento' || cmd === '/progress') {
        const idx = parseInt(args) - 1
        if (isNaN(idx) || idx < 0) {
          replyText = '⚠️ Use: /andamento [número]'
        } else {
          const { data: tasks } = await supabaseAdmin
            .from('tasks')
            .select('id, title')
            .eq('created_by', userId)
            .in('status', ['pending', 'in_progress'])
            .order('created_at', { ascending: false })
            .limit(15)

          if (!tasks || !tasks[idx]) {
            replyText = '❌ Tarefa não encontrada'
          } else {
            await supabaseAdmin
              .from('tasks')
              .update({ status: 'in_progress', started_at: new Date().toISOString(), quadrant: 'do' })
              .eq('id', tasks[idx].id)
            replyText = `🔄 Em andamento: *${tasks[idx].title}*`
          }
        }
      } else if (cmd === '/urgente' || cmd === '/urgent') {
        const idx = parseInt(args) - 1
        if (isNaN(idx) || idx < 0) {
          replyText = '⚠️ Use: /urgente [número]'
        } else {
          const { data: tasks } = await supabaseAdmin
            .from('tasks')
            .select('id, title')
            .eq('created_by', userId)
            .in('status', ['pending', 'in_progress'])
            .order('created_at', { ascending: false })
            .limit(15)

          if (!tasks || !tasks[idx]) {
            replyText = '❌ Tarefa não encontrada'
          } else {
            await supabaseAdmin
              .from('tasks')
              .update({ quadrant: 'do', urgency: 5, importance: 5 })
              .eq('id', tasks[idx].id)
            replyText = `🔴 Movida para "Fazer Agora": *${tasks[idx].title}*`
          }
        }
      } else if (cmd === '/ajuda' || cmd === '/help') {
        replyText = `📖 *Comandos disponíveis:*\n\n` +
          `/nova [título] - Criar tarefa\n` +
          `/listar - Listar tarefas\n` +
          `/concluir [nº] - Concluir tarefa\n` +
          `/andamento [nº] - Marcar em andamento\n` +
          `/urgente [nº] - Mover para "Fazer Agora"\n` +
          `/ajuda - Este menu`
      } else {
        replyText = '❓ Comando não reconhecido. Use /ajuda para ver os comandos disponíveis.'
      }

      // Send reply
      if (replyText && conn.phone_number) {
        await fetch(`${EVOLUTION_API_URL}/message/sendText/${instanceName}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: EVOLUTION_API_KEY,
          },
          body: JSON.stringify({
            number: conn.phone_number,
            text: replyText,
          }),
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
