import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

async function registerWebhook(evolutionUrl: string, apiKey: string, instanceName: string, supabaseUrl: string) {
  const webhookUrl = `${supabaseUrl}/functions/v1/whatsapp-webhook`
  const events = ['MESSAGES_UPSERT', 'CONNECTION_UPDATE']

  const formats = [
    { webhook: { enabled: true, url: webhookUrl, webhook_by_events: true, webhook_base64: false, events } },
    { webhook: { enabled: true, url: webhookUrl, events } },
    { instance: { webhook: { enabled: true, url: webhookUrl, webhook_by_events: true, webhook_base64: false, events } } },
    { webhook: { url: webhookUrl, webhook_by_events: true, webhook_base64: false, events } },
    { url: webhookUrl, webhook_by_events: true, webhook_base64: false, events },
  ]

  const results: { format: number; status: number; body: string }[] = []

  for (const [i, payload] of formats.entries()) {
    console.log(`[webhook-register] Trying format ${i + 1}:`, JSON.stringify(payload).substring(0, 240))
    try {
      const res = await fetch(`${evolutionUrl}/webhook/set/${instanceName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: apiKey },
        body: JSON.stringify(payload),
      })
      const resText = await res.text()
      console.log(`[webhook-register] Format ${i + 1} response [${res.status}]:`, resText.substring(0, 320))
      results.push({ format: i + 1, status: res.status, body: resText.substring(0, 220) })
      if (res.ok) {
        console.log(`[webhook-register] SUCCESS with format ${i + 1}`)
        return { success: true, results }
      }
    } catch (e) {
      console.error(`[webhook-register] Format ${i + 1} error:`, e)
      results.push({ format: i + 1, status: 0, body: String(e) })
    }
  }

  console.error('[webhook-register] All formats failed')
  return { success: false, results }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }

    const { data: conn } = await (supabase as any)
      .from('whatsapp_connections')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!conn) {
      return new Response(JSON.stringify({ status: 'disconnected' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const EVOLUTION_API_URL = Deno.env.get('EVOLUTION_API_URL')!
    const EVOLUTION_API_KEY = Deno.env.get('EVOLUTION_API_KEY')!

    // For already-connected instances, re-register webhook with multi-format
    if (conn.status === 'connected') {
      console.log('[whatsapp-status] Instance connected, re-registering webhook for:', conn.instance_name)
      const { success, results } = await registerWebhook(EVOLUTION_API_URL, EVOLUTION_API_KEY, conn.instance_name, Deno.env.get('SUPABASE_URL')!)
      return new Response(JSON.stringify({ status: 'connected', webhook_reregistered: success, webhook_results: results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (conn.status !== 'qr_pending') {
      return new Response(JSON.stringify({ status: conn.status }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Check instance state on Evolution API
    const stateRes = await fetch(`${EVOLUTION_API_URL}/instance/connectionState/${conn.instance_name}`, {
      headers: { apikey: EVOLUTION_API_KEY },
    })

    if (!stateRes.ok) {
      console.error('Failed to check state:', await stateRes.text())
      return new Response(JSON.stringify({ status: 'qr_pending' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const stateData = await stateRes.json()
    console.log('Instance state:', JSON.stringify(stateData))
    const instanceState = stateData?.instance?.state || stateData?.state

    if (instanceState === 'open' || instanceState === 'connected') {
      // Register webhook with multi-format fallback
      const { success: webhookOk, results: webhookResults } = await registerWebhook(EVOLUTION_API_URL, EVOLUTION_API_KEY, conn.instance_name, Deno.env.get('SUPABASE_URL')!)

      // Get phone number
      let phoneNumber: string | null = null
      try {
        const infoRes = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances?instanceName=${conn.instance_name}`, {
          headers: { apikey: EVOLUTION_API_KEY },
        })
        if (infoRes.ok) {
          const infoData = await infoRes.json()
          const instance = Array.isArray(infoData) ? infoData[0] : infoData
          phoneNumber = instance?.instance?.ownerJid || instance?.ownerJid || instance?.instance?.owner || instance?.owner || null
          if (phoneNumber) phoneNumber = phoneNumber.replace(/@.*$/, '')
        }
      } catch (e) {
        console.error('Failed to fetch instance info:', e)
      }

      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )

      await supabaseAdmin
        .from('whatsapp_connections')
        .update({ status: 'connected', qr_code: null, phone_number: phoneNumber })
        .eq('user_id', user.id)

      return new Response(JSON.stringify({ status: 'connected', phone_number: phoneNumber, webhook_registered: webhookOk, webhook_results: webhookResults }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ status: 'qr_pending' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('whatsapp-status error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
