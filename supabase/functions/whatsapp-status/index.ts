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

    // Get user's whatsapp connection
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

    // For already-connected instances, ensure webhook is registered and return
    if (conn.status === 'connected') {
      console.log('Instance already connected, ensuring webhook is registered for:', conn.instance_name)
      try {
        const webhookRes = await fetch(`${EVOLUTION_API_URL}/webhook/set/${conn.instance_name}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
          body: JSON.stringify({
            url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/whatsapp-webhook`,
            webhook_by_events: true,
            webhook_base64: false,
            events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
          }),
        })
        if (!webhookRes.ok) {
          console.error('Failed to re-register webhook:', await webhookRes.text())
        } else {
          console.log('Webhook re-registered successfully')
        }
      } catch (e) {
        console.error('Error re-registering webhook:', e)
      }
      return new Response(JSON.stringify({ status: 'connected', webhook_reregistered: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (conn.status !== 'qr_pending') {
      return new Response(JSON.stringify({ status: conn.status }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const EVOLUTION_API_URL = Deno.env.get('EVOLUTION_API_URL')!
    const EVOLUTION_API_KEY = Deno.env.get('EVOLUTION_API_KEY')!

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
      // AUTO-REGISTER WEBHOOK on successful connection
      console.log('Connection detected, registering webhook for instance:', conn.instance_name)
      try {
        const webhookRes = await fetch(`${EVOLUTION_API_URL}/webhook/set/${conn.instance_name}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: EVOLUTION_API_KEY,
          },
          body: JSON.stringify({
            url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/whatsapp-webhook`,
            webhook_by_events: true,
            webhook_base64: false,
            events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
          }),
        })
        if (!webhookRes.ok) {
          console.error('Failed to register webhook:', await webhookRes.text())
        } else {
          console.log('Webhook registered successfully')
        }
      } catch (e) {
        console.error('Error registering webhook:', e)
      }

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

      // Update using service role to bypass RLS
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )

      await supabaseAdmin
        .from('whatsapp_connections')
        .update({ status: 'connected', qr_code: null, phone_number: phoneNumber })
        .eq('user_id', user.id)

      return new Response(JSON.stringify({ status: 'connected', phone_number: phoneNumber }), {
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
