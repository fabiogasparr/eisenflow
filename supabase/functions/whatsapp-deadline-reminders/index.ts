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

    // Get all connected users with reminders enabled
    const { data: connections, error: connErr } = await supabaseAdmin
      .from('whatsapp_connections')
      .select('user_id, instance_name, phone_number')
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
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)

    let totalSent = 0

    for (const conn of connections) {
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
            console.log(`Evolution API fetchInstances response:`, JSON.stringify(infoData).substring(0, 1000))
            const instance = Array.isArray(infoData) ? infoData[0] : infoData
            const owner = instance?.instance?.owner || instance?.owner || instance?.instance?.wuid || null
            if (owner) {
              phoneNumber = owner.replace(/@.*$/, '')
              console.log(`Found phone number from Evolution API: ${phoneNumber}`)
              // Persist it so we don't need to fetch again
              await supabaseAdmin
                .from('whatsapp_connections')
                .update({ phone_number: phoneNumber })
                .eq('user_id', conn.user_id)
            }
          } else {
            console.error(`Evolution API fetchInstances failed: ${infoRes.status}`)
          }
        } catch (e) {
          console.error(`Failed to fetch phone from Evolution API:`, e)
        }
      }

      if (!phoneNumber) {
        console.log(`Skipping user ${conn.user_id}: no phone number even after API fetch`)
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

      console.log(`Found ${tasks?.length ?? 0} tasks with upcoming deadlines for user ${conn.user_id}`)

      if (!tasks || tasks.length === 0) continue

      // Group by urgency
      const dueNow: string[] = []
      const due1h: string[] = []
      const due24h: string[] = []

      for (const task of tasks) {
        const dueTime = new Date(task.due_date!).getTime()
        const diff = dueTime - now.getTime()

        if (diff <= 0) {
          dueNow.push(task.title)
        } else if (diff <= 60 * 60 * 1000) {
          due1h.push(task.title)
        } else {
          due24h.push(task.title)
        }
      }

      // Build message
      const lines: string[] = ['⏰ *Lembretes de Prazo*\n']

      if (dueNow.length > 0) {
        lines.push('🔴 *Vencendo agora:*')
        dueNow.forEach((t, i) => lines.push(`  ${i + 1}. ${t}`))
        lines.push('')
      }
      if (due1h.length > 0) {
        lines.push('🟡 *Próxima 1 hora:*')
        due1h.forEach((t, i) => lines.push(`  ${i + 1}. ${t}`))
        lines.push('')
      }
      if (due24h.length > 0) {
        lines.push('🔵 *Próximas 24 horas:*')
        due24h.forEach((t, i) => lines.push(`  ${i + 1}. ${t}`))
        lines.push('')
      }

      lines.push('Use /listar para ver detalhes.')

      const message = lines.join('\n')
      console.log(`Sending reminder to ${conn.phone_number}: ${tasks.length} tasks`)

      try {
        const sendRes = await fetch(`${EVOLUTION_API_URL}/message/sendText/${conn.instance_name}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: EVOLUTION_API_KEY,
          },
          body: JSON.stringify({
            number: conn.phone_number,
            text: message,
          }),
        })

        const sendBody = await sendRes.text()
        console.log(`Evolution API response [${sendRes.status}]: ${sendBody}`)

        if (!sendRes.ok) {
          console.error(`Failed to send to ${conn.user_id}: ${sendRes.status} ${sendBody}`)
        } else {
          totalSent++
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
