import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function buildWeeklyReport(
  tasks: any[],
  completed: any[],
  created: any[],
  pending: any[],
  metrics: any[],
  gamif: any,
  now: Date,
  weekAgo: Date,
) {
  const totalPomodoros = metrics.reduce((s: number, m: any) => s + (m.pomodoros_completed || 0), 0)
  const totalFocusMin = metrics.reduce((s: number, m: any) => s + (m.time_in_important || 0), 0)
  const totalDelegated = metrics.reduce((s: number, m: any) => s + (m.tasks_delegated || 0), 0)
  const totalEliminated = metrics.reduce((s: number, m: any) => s + (m.tasks_eliminated || 0), 0)

  const quadrantCount: Record<string, number> = { do: 0, schedule: 0, delegate: 0, eliminate: 0 }
  for (const t of completed) quadrantCount[t.quadrant] = (quadrantCount[t.quadrant] || 0) + 1

  const overdue = pending.filter((t: any) => t.due_date && new Date(t.due_date) < now)

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

function buildDailyReport(tasks: any[], gamif: any, now: Date) {
  const dateStr = fmtDate(now)
  const completed = tasks.filter((t: any) => t.status === 'completed').length
  const inProgress = tasks.filter((t: any) => t.status === 'in_progress').length
  const pending = tasks.filter((t: any) => t.status === 'pending').length

  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const nextWeek = new Date(now)
  nextWeek.setDate(nextWeek.getDate() + 7)

  const upcoming = tasks
    .filter((t: any) => t.due_date && t.status !== 'completed' && t.status !== 'eliminated')
    .filter((t: any) => {
      const due = new Date(t.due_date!)
      return due >= now && due <= nextWeek
    })
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
    if (gamif.current_streak > 0) {
      report += `🔥 *Streak:* ${gamif.current_streak} dias\n`
    }
  }

  report += `\n💡 _Envie /listar para ver suas tarefas_`
  return report
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

    // Determine report type from body
    let reportType = 'daily'
    try {
      const body = await req.json()
      if (body?.type === 'weekly') reportType = 'weekly'
    } catch { /* no body = daily */ }

    // Find all users with report enabled and connected WhatsApp
    const { data: connections } = await supabaseAdmin
      .from('whatsapp_connections')
      .select('*')
      .eq('status', 'connected')
      .eq('daily_report_enabled', true)

    if (!connections || connections.length === 0) {
      return new Response(JSON.stringify({ message: 'No reports to send' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    let sentCount = 0

    for (const conn of connections) {
      try {
        if (!conn.phone_number) continue

        let report: string

        if (reportType === 'weekly') {
          // Fetch weekly data in parallel
          const [completedRes, createdRes, metricsRes, pendingRes, gamifRes] = await Promise.all([
            supabaseAdmin.from('tasks').select('id, title, quadrant, completed_at')
              .eq('created_by', conn.user_id).eq('status', 'completed')
              .gte('completed_at', weekAgo.toISOString()),
            supabaseAdmin.from('tasks').select('id')
              .eq('created_by', conn.user_id).gte('created_at', weekAgo.toISOString()),
            supabaseAdmin.from('productivity_metrics').select('*')
              .eq('user_id', conn.user_id).gte('date', weekAgo.toISOString().split('T')[0])
              .order('date', { ascending: true }),
            supabaseAdmin.from('tasks').select('id, title, quadrant, due_date')
              .eq('created_by', conn.user_id).in('status', ['pending', 'in_progress']),
            supabaseAdmin.from('gamification').select('*')
              .eq('user_id', conn.user_id).maybeSingle(),
          ])

          report = buildWeeklyReport(
            [], completedRes.data || [], createdRes.data || [],
            pendingRes.data || [], metricsRes.data || [],
            gamifRes.data, now, weekAgo,
          )
        } else {
          // Daily report
          const [tasksRes, gamifRes] = await Promise.all([
            supabaseAdmin.from('tasks').select('title, status, quadrant, due_date')
              .eq('created_by', conn.user_id),
            supabaseAdmin.from('gamification').select('*')
              .eq('user_id', conn.user_id).maybeSingle(),
          ])
          report = buildDailyReport(tasksRes.data || [], gamifRes.data, now)
        }

        await fetch(`${EVOLUTION_API_URL}/message/sendText/${conn.instance_name}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
          body: JSON.stringify({ number: conn.phone_number, text: report }),
        })
        sentCount++
      } catch (e) {
        console.error(`Failed to send report for user ${conn.user_id}:`, e)
      }
    }

    return new Response(JSON.stringify({ type: reportType, sent: sentCount }), {
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
