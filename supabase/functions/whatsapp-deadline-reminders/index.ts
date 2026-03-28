import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    console.log('Starting deadline reminders check...')

    // Cleanup: delete sent reminders older than 48h
    await supabaseAdmin
      .from('whatsapp_sent_reminders')
      .delete()
      .lt('sent_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())

    // Get all connected users with reminders enabled
    const { data: connections, error: connErr } = await supabaseAdmin
      .from('whatsapp_connections')
      .select('user_id, instance_name, phone_number, reminder_times')
      .eq('status', 'connected')
      .eq('reminders_enabled', true)

    if (connErr) {
      console.error('Error fetching connections:', connErr)
      throw connErr
    }

    console.log(`Found ${connections?.length ?? 0} connections with reminders enabled`)

    if (!connections || connections.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const now = new Date()
    const currentHour = now.getUTCHours()
    const currentMinute = now.getUTCMinutes()
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)

    let totalSent = 0

    for (const conn of connections) {
      // Check if current hour matches any of the user's reminder_times (±30 min tolerance)
      const reminderTimes = (conn.reminder_times || '08:00,12:00,18:00').split(',').map((t: string) => t.trim())
      const matchesTime = reminderTimes.some((time: string) => {
        const [h, m] = time.split(':').map(Number)
        const reminderMinutes = h * 60 + (m || 0)
        const currentMinutes = currentHour * 60 + currentMinute
        const diff = Math.abs(currentMinutes - reminderMinutes)
        return diff <= 30 || diff >= (24 * 60 - 30) // handle midnight wrap
      })

      if (!matchesTime) {
        console.log(`Skipping user ${conn.user_id}: current time ${currentHour}:${currentMinute} doesn't match reminder_times ${conn.reminder_times}`)
        continue
      }
      console.log(`Processing user ${conn.user_id}, phone: ${conn.phone_number}, instance: ${conn.instance_name}`)

      let phoneNumber = conn.phone_number

      // If phone_number is missing, try to fetch it from Evolution API and persist
      if (!phoneNumber) {
        console.log(`Phone number missing for user ${conn.user_id}, fetching from Evolution API...`)
        try {
          const infoRes = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances?instanceName=${conn.instance_name}`, {
            headers: { apikey: EVOLUTION_API_KEY },
          })
          if (infoRes.ok) {
            const infoData = await infoRes.json()
            const instance = Array.isArray(infoData) ? infoData[0] : infoData
            const owner = instance?.ownerJid || instance?.instance?.owner || instance?.owner || instance?.instance?.wuid || null
            if (owner) {
              phoneNumber = owner.replace(/@.*$/, '')
              console.log(`Found phone number from Evolution API: ${phoneNumber}`)
              await supabaseAdmin
                .from('whatsapp_connections')
                .update({ phone_number: phoneNumber })
                .eq('user_id', conn.user_id)
            }
          }
        } catch (e) {
          console.error(`Failed to fetch phone from Evolution API:`, e)
        }
      }

      if (!phoneNumber) {
        console.log(`Skipping user ${conn.user_id}: no phone number`)
        continue
      }

      // Get tasks with upcoming deadlines for this user
      const { data: tasks, error: tasksErr } = await supabaseAdmin
        .from('tasks')
        .select('id, title, due_date, status, quadrant')
        .or(`created_by.eq.${conn.user_id},assigned_to.eq.${conn.user_id}`)
        .in('status', ['pending', 'in_progress'])
        .not('due_date', 'is', null)
        .lte('due_date', in24h.toISOString())
        .gte('due_date', now.toISOString())
        .order('due_date', { ascending: true })

      if (tasksErr) {
        console.error(`Error fetching tasks for user ${conn.user_id}:`, tasksErr)
        continue
      }

      if (!tasks || tasks.length === 0) continue

      // Check which reminders were already sent
      const taskIds = tasks.map(t => t.id)
      const { data: alreadySent } = await supabaseAdmin
        .from('whatsapp_sent_reminders')
        .select('task_id, reminder_type')
        .eq('user_id', conn.user_id)
        .in('task_id', taskIds)

      const sentSet = new Set((alreadySent || []).map(r => `${r.task_id}:${r.reminder_type}`))

      // Classify and filter tasks
      const dueNow: { title: string; id: string }[] = []
      const due1h: { title: string; id: string }[] = []
      const due24h: { title: string; id: string }[] = []

      for (const task of tasks) {
        const dueTime = new Date(task.due_date!).getTime()
        const diff = dueTime - now.getTime()

        let type: string
        if (diff <= 0) {
          type = 'now'
        } else if (diff <= 60 * 60 * 1000) {
          type = '1h'
        } else {
          type = '24h'
        }

        // Skip if already sent
        if (sentSet.has(`${task.id}:${type}`)) continue

        if (type === 'now') dueNow.push({ title: task.title, id: task.id })
        else if (type === '1h') due1h.push({ title: task.title, id: task.id })
        else due24h.push({ title: task.title, id: task.id })
      }

      const allPending = [...dueNow, ...due1h, ...due24h]
      if (allPending.length === 0) {
        console.log(`All reminders already sent for user ${conn.user_id}`)
        continue
      }

      // Build message
      const lines: string[] = ['⏰ *Lembretes de Prazo*\n']

      if (dueNow.length > 0) {
        lines.push('🔴 *Vencendo agora:*')
        dueNow.forEach((t, i) => lines.push(`  ${i + 1}. ${t.title}`))
        lines.push('')
      }
      if (due1h.length > 0) {
        lines.push('🟡 *Próxima 1 hora:*')
        due1h.forEach((t, i) => lines.push(`  ${i + 1}. ${t.title}`))
        lines.push('')
      }
      if (due24h.length > 0) {
        lines.push('🔵 *Próximas 24 horas:*')
        due24h.forEach((t, i) => lines.push(`  ${i + 1}. ${t.title}`))
        lines.push('')
      }

      lines.push('Use /listar para ver detalhes.')
      const message = lines.join('\n')

      console.log(`Sending reminder to ${phoneNumber}: ${allPending.length} new tasks`)

      try {
        const sendRes = await fetch(`${EVOLUTION_API_URL}/message/sendText/${conn.instance_name}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: EVOLUTION_API_KEY,
          },
          body: JSON.stringify({
            number: phoneNumber,
            text: message,
          }),
        })

        if (!sendRes.ok) {
          const errBody = await sendRes.text()
          console.error(`Failed to send to ${conn.user_id}: ${sendRes.status} ${errBody}`)
        } else {
          totalSent++

          // Record sent reminders to prevent duplicates
          const records = [
            ...dueNow.map(t => ({ user_id: conn.user_id, task_id: t.id, reminder_type: 'now' })),
            ...due1h.map(t => ({ user_id: conn.user_id, task_id: t.id, reminder_type: '1h' })),
            ...due24h.map(t => ({ user_id: conn.user_id, task_id: t.id, reminder_type: '24h' })),
          ]

          if (records.length > 0) {
            await supabaseAdmin
              .from('whatsapp_sent_reminders')
              .upsert(records, { onConflict: 'user_id,task_id,reminder_type' })
          }
        }
      } catch (sendErr) {
        console.error(`Failed to send reminder to ${conn.user_id}:`, sendErr)
      }
    }

    console.log(`Deadline reminders sent: ${totalSent}`)
    return new Response(JSON.stringify({ ok: true, sent: totalSent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('whatsapp-deadline-reminders error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
