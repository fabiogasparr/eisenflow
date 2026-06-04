// tenant-whatsapp-verify-phone: send / verify OTP code to map a member phone to a tenant
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const EVOLUTION_API_URL = Deno.env.get('EVOLUTION_API_URL')!
const EVOLUTION_API_KEY = Deno.env.get('EVOLUTION_API_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: { user } } = await sb.auth.getUser()
    if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: corsHeaders })

    const body = await req.json()
    const { action, tenant_id, phone_number, code } = body
    if (!tenant_id || !action) return new Response(JSON.stringify({ error: 'missing params' }), { status: 400, headers: corsHeaders })

    if (action === 'send') {
      if (!phone_number) return new Response(JSON.stringify({ error: 'phone_number required' }), { status: 400, headers: corsHeaders })
      const otp = String(Math.floor(100000 + Math.random() * 900000))
      const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString()
      await admin.from('tenant_member_phones').upsert({
        tenant_id, user_id: user.id, phone_number,
        verified: false, verification_code: otp, verification_expires_at: expires,
      }, { onConflict: 'tenant_id,user_id' })

      // Send via tenant WA instance
      const { data: tconn } = await admin.from('tenant_whatsapp_connections')
        .select('instance_name, status').eq('tenant_id', tenant_id).maybeSingle()
      if (!tconn || tconn.status !== 'connected') {
        return new Response(JSON.stringify({ error: 'tenant_wa_not_connected' }), { status: 400, headers: corsHeaders })
      }
      const sendRes = await fetch(`${EVOLUTION_API_URL}/message/sendText/${tconn.instance_name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
        body: JSON.stringify({ number: phone_number.replace(/\D/g, ''), text: `Seu código EisenFlow: *${otp}*\nVálido por 10 minutos.` }),
      })
      if (!sendRes.ok) return new Response(JSON.stringify({ error: `send_failed_${sendRes.status}` }), { status: 500, headers: corsHeaders })

      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (action === 'verify') {
      const { data: row } = await admin.from('tenant_member_phones')
        .select('*').eq('tenant_id', tenant_id).eq('user_id', user.id).maybeSingle()
      if (!row) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: corsHeaders })
      if (!row.verification_code || row.verification_code !== code) {
        return new Response(JSON.stringify({ error: 'invalid_code' }), { status: 400, headers: corsHeaders })
      }
      if (new Date(row.verification_expires_at).getTime() < Date.now()) {
        return new Response(JSON.stringify({ error: 'expired' }), { status: 400, headers: corsHeaders })
      }
      await admin.from('tenant_member_phones').update({
        verified: true, verification_code: null, verification_expires_at: null,
      }).eq('id', row.id)
      return new Response(JSON.stringify({ ok: true, verified: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ error: 'unknown_action' }), { status: 400, headers: corsHeaders })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
