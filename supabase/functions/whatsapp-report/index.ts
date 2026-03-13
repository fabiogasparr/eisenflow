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

    // Find all users with daily report enabled and connected WhatsApp
    const { data: connections } = await supabaseAdmin
      .from('whatsapp_connections')
      .select('*')
      .eq('status', 'connected')
      .eq('daily_report_enabled', true)

    if (!connections || connections.length === 0) {
      return new Response(JSON.stringify({ message: 'No reports to send' }), { headers: corsHeaders })
    }

    const today = new Date()
    const dateStr = `${today.getDate().toString().padStart(2, '0')}/${(today.getMonth() + 1).toString().padStart(2, '0')}`

    let sentCount = 0

    for (const conn of connections) {
      try {
        // Get user tasks
        const { data: tasks } = await supabaseAdmin
          .from('tasks')
          .select('title, status, quadrant, due_date')
          .eq('created_by', conn.user_id)

        if (!tasks) continue

        const completed = tasks.filter(t => t.status === 'completed').length
        const inProgress = tasks.filter(t => t.status === 'in_progress').length
        const pending = tasks.filter(t => t.status === 'pending').length

        // Get gamification data
        const { data: gamification } = await supabaseAdmin
          .from('gamification')
          .select('level, xp, total_pomodoros, current_streak')
          .eq('user_id', conn.user_id)
          .single()

        // Get upcoming deadlines
        const tomorrow = new Date(today)
        tomorrow.setDate(tomorrow.getDate() + 1)
        const nextWeek = new Date(today)
        nextWeek.setDate(nextWeek.getDate() + 7)

        const upcoming = tasks
          .filter(t => t.due_date && t.status !== 'completed' && t.status !== 'eliminated')
          .filter(t => {
            const due = new Date(t.due_date!)
            return due >= today && due <= nextWeek
          })
          .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())
          .slice(0, 5)

        let report = `📊 *Relatório Diário - ${dateStr}*\n\n`
        report += `✅ *Concluídas:* ${completed} tarefas\n`
        report += `🔄 *Em andamento:* ${inProgress} tarefas\n`
        report += `⏳ *Pendentes:* ${pending} tarefas\n`

        if (upcoming.length > 0) {
          report += `\n🔥 *Próximos prazos:*\n`
          for (const task of upcoming) {
            const due = new Date(task.due_date!)
            const diffDays = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
            const label = diffDays === 0 ? 'hoje' : diffDays === 1 ? 'amanhã' : `em ${diffDays} dias`
            report += `• ${task.title} - ${label}\n`
          }
        }

        if (gamification) {
          report += `\n🍅 *Pomodoros:* ${gamification.total_pomodoros} completados\n`
          report += `🏆 *Nível:* ${gamification.level} (${gamification.xp.toLocaleString()} XP)\n`
          if (gamification.current_streak > 0) {
            report += `🔥 *Streak:* ${gamification.current_streak} dias\n`
          }
        }

        report += `\n💡 _Envie /listar para ver suas tarefas_`

        // Send report
        if (conn.phone_number) {
          await fetch(`${EVOLUTION_API_URL}/message/sendText/${conn.instance_name}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: EVOLUTION_API_KEY,
            },
            body: JSON.stringify({
              number: conn.phone_number,
              text: report,
            }),
          })
          sentCount++
        }
      } catch (e) {
        console.error(`Failed to send report for user ${conn.user_id}:`, e)
      }
    }

    return new Response(JSON.stringify({ sent: sentCount }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('whatsapp-report error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
