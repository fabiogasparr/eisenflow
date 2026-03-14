import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

async function registerWebhook(evolutionUrl: string, apiKey: string, instanceName: string, supabaseUrl: string) {
  const webhookUrl = `${supabaseUrl}/functions/v1/whatsapp-webhook`
  const events = ['MESSAGES_UPSERT', 'CONNECTION_UPDATE']

  const formats = [
    { url: webhookUrl, webhook_by_events: true, webhook_base64: false, events },
    { webhook: { url: webhookUrl, webhook_by_events: true, webhook_base64: false, events } },
    { enabled: true, url: webhookUrl, webhook_by_events: true, webhook_base64: false, events },
  ]

  for (const [i, payload] of formats.entries()) {
    console.log(`[webhook-register] Trying format ${i + 1}:`, JSON.stringify(payload).substring(0, 200))
    try {
      const res = await fetch(`${evolutionUrl}/webhook/set/${instanceName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: apiKey },
        body: JSON.stringify(payload),
      })
      const resText = await res.text()
      console.log(`[webhook-register] Format ${i + 1} response [${res.status}]:`, resText.substring(0, 300))
      if (res.ok) {
        console.log(`[webhook-register] SUCCESS with format ${i + 1}`)
        return true
      }
    } catch (e) {
      console.error(`[webhook-register] Format ${i + 1} error:`, e)
    }
  }
  console.error('[webhook-register] All formats failed')
  return false
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
    const userId = user.id

    const EVOLUTION_API_URL = Deno.env.get('EVOLUTION_API_URL')
    const EVOLUTION_API_KEY = Deno.env.get('EVOLUTION_API_KEY')
    if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
      return new Response(JSON.stringify({ error: 'Evolution API not configured' }), { status: 500, headers: corsHeaders })
    }

    const instanceName = `eisenflow_${userId.replace(/-/g, '')}`
    const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/whatsapp-webhook`

    // Create instance on Evolution API - include webhook in creation payload
    const createRes = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: EVOLUTION_API_KEY,
      },
      body: JSON.stringify({
        instanceName,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
        webhook: {
          url: webhookUrl,
          webhook_by_events: true,
          webhook_base64: false,
          events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
        },
      }),
    })

    if (!createRes.ok) {
      const errBody = await createRes.text()
      console.log(`[whatsapp-connect] Create instance failed [${createRes.status}]:`, errBody.substring(0, 300))

      // If instance already exists, try to connect it
      if (createRes.status === 403 || errBody.includes('already')) {
        const connectRes = await fetch(`${EVOLUTION_API_URL}/instance/connect/${instanceName}`, {
          method: 'GET',
          headers: { apikey: EVOLUTION_API_KEY },
        })
        if (!connectRes.ok) {
          throw new Error(`Failed to reconnect instance: ${await connectRes.text()}`)
        }
        const connectData = await connectRes.json()
        const rawQr2 = connectData?.base64 || connectData?.qrcode?.base64 || null
        const qrBase64 = rawQr2?.replace(/^data:image\/[a-z]+;base64,/, '') || null

        // Register webhook with multi-format fallback
        const webhookOk = await registerWebhook(EVOLUTION_API_URL, EVOLUTION_API_KEY, instanceName, Deno.env.get('SUPABASE_URL')!)

        const { error: dbError } = await supabase
          .from('whatsapp_connections')
          .upsert({
            user_id: userId,
            instance_name: instanceName,
            status: qrBase64 ? 'qr_pending' : 'disconnected',
            qr_code: qrBase64,
          }, { onConflict: 'user_id' })

        if (dbError) throw dbError

        return new Response(JSON.stringify({ status: 'qr_pending', qr_code: qrBase64, webhook_registered: webhookOk }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Evolution API error [${createRes.status}]: ${errBody}`)
    }

    const createData = await createRes.json()
    console.log('[whatsapp-connect] Create response:', JSON.stringify(createData).substring(0, 500))
    const rawQr = createData?.qrcode?.base64 || createData?.base64 || null
    const qrBase64 = rawQr?.replace(/^data:image\/[a-z]+;base64,/, '') || null

    // Also try separate webhook/set as fallback
    const webhookOk = await registerWebhook(EVOLUTION_API_URL, EVOLUTION_API_KEY, instanceName, Deno.env.get('SUPABASE_URL')!)

    const { error: dbError } = await supabase
      .from('whatsapp_connections')
      .upsert({
        user_id: userId,
        instance_name: instanceName,
        status: qrBase64 ? 'qr_pending' : 'disconnected',
        qr_code: qrBase64,
      }, { onConflict: 'user_id' })

    if (dbError) throw dbError

    return new Response(JSON.stringify({ status: 'qr_pending', qr_code: qrBase64, webhook_registered: webhookOk }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('whatsapp-connect error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
