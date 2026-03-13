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
      } else if (cmd === '/delegar' || cmd === '/delegate') {
        // Format: /delegar [task_number] [member_name_or_partial]
        const delegateParts = args.split(' ')
        const idx = parseInt(delegateParts[0]) - 1
        const memberSearch = delegateParts.slice(1).join(' ').trim()

        if (isNaN(idx) || idx < 0 || !memberSearch) {
          replyText = '⚠️ Use: /delegar [número] [nome do membro]\nEx: /delegar 1 João'
        } else {
          // Get user's tasks
          const { data: tasks } = await supabaseAdmin
            .from('tasks')
            .select('id, title, project_id')
            .eq('created_by', userId)
            .in('status', ['pending', 'in_progress'])
            .order('created_at', { ascending: false })
            .limit(15)

          if (!tasks || !tasks[idx]) {
            replyText = '❌ Tarefa não encontrada'
          } else {
            const task = tasks[idx]

            // Find team members the user shares a team with
            const { data: userTeams } = await supabaseAdmin
              .from('team_members')
              .select('team_id')
              .eq('user_id', userId)

            if (!userTeams || userTeams.length === 0) {
              replyText = '❌ Você não pertence a nenhum time. Crie ou entre em um time primeiro.'
            } else {
              const teamIds = userTeams.map((t: any) => t.team_id)

              // Get all members from user's teams
              const { data: teammates } = await supabaseAdmin
                .from('team_members')
                .select('user_id, team_id')
                .in('team_id', teamIds)
                .neq('user_id', userId)

              if (!teammates || teammates.length === 0) {
                replyText = '❌ Nenhum membro encontrado nos seus times.'
              } else {
                // Get profiles for matching
                const teammateIds = [...new Set(teammates.map((t: any) => t.user_id))]
                const { data: profiles } = await supabaseAdmin
                  .from('profiles')
                  .select('user_id, display_name')
                  .in('user_id', teammateIds)

                // Search by name (case-insensitive partial match)
                const searchLower = memberSearch.toLowerCase()
                const matchedProfile = (profiles ?? []).find((p: any) =>
                  p.display_name && p.display_name.toLowerCase().includes(searchLower)
                )

                if (!matchedProfile) {
                  const availableNames = (profiles ?? [])
                    .filter((p: any) => p.display_name)
                    .map((p: any) => p.display_name)
                    .join(', ')
                  replyText = `❌ Membro "${memberSearch}" não encontrado.\n\n👥 *Membros disponíveis:* ${availableNames || 'nenhum'}`
                } else {
                  // Delegate: update task assigned_to and create delegation record
                  await supabaseAdmin
                    .from('tasks')
                    .update({
                      assigned_to: matchedProfile.user_id,
                      quadrant: 'delegate',
                    })
                    .eq('id', task.id)

                  await supabaseAdmin
                    .from('delegations')
                    .insert({
                      task_id: task.id,
                      delegated_by: userId,
                      delegated_to: matchedProfile.user_id,
                      status: 'pending',
                    })

                  replyText = `🟦 Tarefa delegada para *${matchedProfile.display_name}*: *${task.title}*`

                  // Notify delegated member via WhatsApp if they have a connection
                  try {
                    const { data: delegateConn } = await supabaseAdmin
                      .from('whatsapp_connections')
                      .select('instance_name, phone_number, status')
                      .eq('user_id', matchedProfile.user_id)
                      .eq('status', 'connected')
                      .maybeSingle()

                    if (delegateConn?.phone_number && delegateConn?.instance_name) {
                      // Get delegator name
                      const { data: delegatorProfile } = await supabaseAdmin
                        .from('profiles')
                        .select('display_name')
                        .eq('user_id', userId)
                        .single()

                      const delegatorName = delegatorProfile?.display_name || 'Alguém'
                      const notifText = `📥 *Nova tarefa delegada para você!*\n\n` +
                        `📝 *${task.title}*\n` +
                        `👤 Delegada por: ${delegatorName}\n\n` +
                        `Use /listar para ver suas tarefas.`

                      await fetch(`${EVOLUTION_API_URL}/message/sendText/${delegateConn.instance_name}`, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          apikey: EVOLUTION_API_KEY,
                        },
                        body: JSON.stringify({
                          number: delegateConn.phone_number,
                          text: notifText,
                        }),
                      })
                    }
                  } catch (notifErr) {
                    console.error('Failed to notify delegated member via WhatsApp:', notifErr)
                  }
                }
              }
            }
          }
        }
      } else if (cmd === '/membros' || cmd === '/members') {
        // List all teammates across user's teams
        const { data: userTeams } = await supabaseAdmin
          .from('team_members')
          .select('team_id')
          .eq('user_id', userId)

        if (!userTeams || userTeams.length === 0) {
          replyText = '❌ Você não pertence a nenhum time.'
        } else {
          const teamIds = userTeams.map((t: any) => t.team_id)

          // Get team names
          const { data: teams } = await supabaseAdmin
            .from('teams')
            .select('id, name')
            .in('id', teamIds)

          // Get all members per team
          const { data: allMembers } = await supabaseAdmin
            .from('team_members')
            .select('user_id, team_id, role')
            .in('team_id', teamIds)

          // Get profiles
          const memberIds = [...new Set((allMembers ?? []).map((m: any) => m.user_id))]
          const { data: profiles } = await supabaseAdmin
            .from('profiles')
            .select('user_id, display_name')
            .in('user_id', memberIds)

          const profileMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p.display_name || 'Sem nome']))
          const teamMap = new Map((teams ?? []).map((t: any) => [t.id, t.name]))

          const roleEmoji: Record<string, string> = { admin: '👑', manager: '⭐', member: '👤' }

          // Group members by team
          const teamGroups: Record<string, string[]> = {}
          for (const m of (allMembers ?? [])) {
            const teamName = teamMap.get(m.team_id) || 'Time'
            if (!teamGroups[teamName]) teamGroups[teamName] = []
            const name = profileMap.get(m.user_id) || 'Sem nome'
            const emoji = roleEmoji[m.role] || '👤'
            const isYou = m.user_id === userId ? ' (você)' : ''
            teamGroups[teamName].push(`${emoji} ${name}${isYou}`)
          }

          replyText = '👥 *Seus times e membros:*\n'
          for (const [teamName, members] of Object.entries(teamGroups)) {
            replyText += `\n📌 *${teamName}*\n` + members.join('\n') + '\n'
          }
        }
      } else if (cmd === '/ajuda' || cmd === '/help') {
        replyText = `📖 *Comandos disponíveis:*\n\n` +
          `/nova [título] - Criar tarefa\n` +
          `/listar - Listar tarefas\n` +
          `/concluir [nº] - Concluir tarefa\n` +
          `/andamento [nº] - Marcar em andamento\n` +
          `/urgente [nº] - Mover para "Fazer Agora"\n` +
          `/delegar [nº] [nome] - Delegar tarefa\n` +
          `/membros - Listar membros dos times\n` +
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
