// dispatch-reminders: drains pending scheduled_reminders and delivers per channel
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EVOLUTION_API_URL = Deno.env.get('EVOLUTION_API_URL')!
const EVOLUTION_API_KEY = Deno.env.get('EVOLUTION_API_KEY')!

function labelFor(kind: string): string {
  switch (kind) {
    case 'due_d1': return '⏰ Prazo amanhã'
    case 'due_1h': return '⏰ Prazo em 1 hora'
    case 'due_now': return '🔴 Prazo agora'
    case 'start_now': return '▶️ Hora de iniciar'
    case 'start_5min': return '⏳ Inicia em 5 min'
    case 'custom': return '🔔 Lembrete'
    case 'daily_summary': return '🌅 Resumo do dia'
    case 'weekly_plan': return '📅 Plano da semana'
    default: return '🔔 Lembrete'
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  try {
    // Pull a batch of due pending reminders
    const { data: batch, error } = await sb
      .from('scheduled_reminders')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(200)
    if (error) throw error

    let sent = 0, failed = 0
    for (const item of batch ?? []) {
      try {
        const payload = (item.payload ?? {}) as Record<string, unknown>
        const title = labelFor(item.kind)
        const body = (payload.task_title as string) ?? (payload.body as string) ?? ''

        if (item.channel === 'in_app' || item.channel === 'browser') {
          // browser is delivered as in_app + realtime; client subscribes to notifications
          await sb.from('notifications').insert({
            user_id: item.user_id,
            type: `reminder_${item.kind}`,
            title,
            body,
            metadata: { task_id: item.task_id, scheduled_reminder_id: item.id, kind: item.kind },
          })
        } else if (item.channel === 'whatsapp_personal') {
          const { data: conn } = await sb
            .from('whatsapp_connections')
            .select('instance_name, phone_number, status, reminders_enabled')
            .eq('user_id', item.user_id)
            .maybeSingle()
          if (!conn || conn.status !== 'connected' || !conn.phone_number || !conn.reminders_enabled) {
            await sb.from('scheduled_reminders').update({ status: 'skipped', last_error: 'no_personal_whatsapp' }).eq('id', item.id)
            continue
          }
          const text = `*${title}*\n${body}`
          const res = await fetch(`${EVOLUTION_API_URL}/message/sendText/${conn.instance_name}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
            body: JSON.stringify({ number: conn.phone_number.replace(/\D/g, ''), text }),
          })
          if (!res.ok) throw new Error(`evo_${res.status}: ${await res.text()}`)
        } else if (item.channel === 'whatsapp_tenant') {
          if (!item.tenant_id) {
            await sb.from('scheduled_reminders').update({ status: 'skipped', last_error: 'no_tenant' }).eq('id', item.id)
            continue
          }
          const { data: tconn } = await sb
            .from('tenant_whatsapp_connections')
            .select('instance_name, status, reminders_enabled')
            .eq('tenant_id', item.tenant_id)
            .maybeSingle()
          if (!tconn || tconn.status !== 'connected' || !tconn.reminders_enabled) {
            await sb.from('scheduled_reminders').update({ status: 'skipped', last_error: 'tenant_wa_unavailable' }).eq('id', item.id)
            continue
          }
          const { data: phone } = await sb
            .from('tenant_member_phones')
            .select('phone_number, verified, receive_reminders')
            .eq('tenant_id', item.tenant_id)
            .eq('user_id', item.user_id)
            .maybeSingle()
          if (!phone || !phone.verified || !phone.receive_reminders) {
            await sb.from('scheduled_reminders').update({ status: 'skipped', last_error: 'phone_not_verified' }).eq('id', item.id)
            continue
          }
          const text = `*${title}*\n${body}`
          const res = await fetch(`${EVOLUTION_API_URL}/message/sendText/${tconn.instance_name}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
            body: JSON.stringify({ number: phone.phone_number.replace(/\D/g, ''), text }),
          })
          if (!res.ok) throw new Error(`evo_${res.status}: ${await res.text()}`)
        } else if (item.channel === 'email') {
          // Email is best-effort: skip if no email infra. Mark skipped.
          await sb.from('scheduled_reminders').update({ status: 'skipped', last_error: 'email_not_configured' }).eq('id', item.id)
          continue
        }

        await sb.from('scheduled_reminders').update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          attempts: (item.attempts ?? 0) + 1,
        }).eq('id', item.id)
        sent++
      } catch (err) {
        const attempts = (item.attempts ?? 0) + 1
        const newStatus = attempts >= 3 ? 'failed' : 'pending'
        await sb.from('scheduled_reminders').update({
          status: newStatus,
          attempts,
          last_error: String((err as Error).message ?? err).slice(0, 500),
        }).eq('id', item.id)
        failed++
      }
    }

    return new Response(JSON.stringify({ ok: true, processed: batch?.length ?? 0, sent, failed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('dispatch-reminders error', e)
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
