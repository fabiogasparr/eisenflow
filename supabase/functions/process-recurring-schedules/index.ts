// process-recurring-schedules: enqueues daily/weekly recurring reminders into scheduled_reminders
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function localTime(tz: string): { hour: number; minute: number; weekday: number; ymd: string } {
  const now = new Date()
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit', minute: '2-digit', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]))
  const wMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    hour: parseInt(parts.hour || '0'),
    minute: parseInt(parts.minute || '0'),
    weekday: wMap[parts.weekday as string] ?? 0,
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
  }
}

async function buildSummary(sb: any, userId: string, _kind: string): Promise<string> {
  const start = new Date(); start.setHours(0,0,0,0)
  const end = new Date(); end.setDate(end.getDate() + 7)
  const { data } = await sb.from('tasks')
    .select('title, due_date, status, quadrant')
    .or(`created_by.eq.${userId},assigned_to.eq.${userId}`)
    .in('status', ['pending', 'in_progress'])
    .gte('due_date', start.toISOString())
    .lte('due_date', end.toISOString())
    .order('due_date', { ascending: true })
    .limit(15)
  if (!data || data.length === 0) return 'Nenhuma tarefa pendente nos próximos dias. 🎉'
  return data.map((t: any, i: number) => `${i+1}. ${t.title}`).join('\n')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  try {
    const { data: schedules } = await sb.from('recurring_schedules').select('*').eq('enabled', true)
    let enqueued = 0
    for (const s of schedules ?? []) {
      const tz = s.timezone || 'America/Sao_Paulo'
      const lt = localTime(tz)
      const [hh, mm] = String(s.cron_local).split(':').map(Number)
      const sched = hh * 60 + (mm || 0)
      const cur = lt.hour * 60 + lt.minute
      // 5-min window match
      if (Math.abs(cur - sched) > 4) continue
      // weekday match for weekly_plan
      if (s.kind === 'weekly_plan' && s.weekday !== null && s.weekday !== lt.weekday) continue
      // Avoid double-run same day
      if (s.last_run_at) {
        const lastFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(s.last_run_at))
        const lastParts = Object.fromEntries(lastFmt.map(p => [p.type, p.value]))
        const lastYmd = `${lastParts.year}-${lastParts.month}-${lastParts.day}`
        if (lastYmd === lt.ymd) continue
      }

      const body = await buildSummary(sb, s.user_id, s.kind)
      for (const ch of s.channels as string[]) {
        await sb.from('scheduled_reminders').insert({
          recurring_schedule_id: s.id,
          user_id: s.user_id,
          tenant_id: s.tenant_id,
          kind: s.kind,
          channel: ch,
          scheduled_at: new Date().toISOString(),
          status: 'pending',
          payload: { task_title: s.kind === 'weekly_plan' ? 'Plano da semana' : 'Resumo do dia', body },
        })
        enqueued++
      }
      await sb.from('recurring_schedules').update({ last_run_at: new Date().toISOString() }).eq('id', s.id)
    }

    return new Response(JSON.stringify({ ok: true, enqueued }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('process-recurring-schedules error', e)
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
