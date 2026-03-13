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
    const userId = user.id

    const EVOLUTION_API_URL = Deno.env.get('EVOLUTION_API_URL')
    const EVOLUTION_API_KEY = Deno.env.get('EVOLUTION_API_KEY')
    if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
      return new Response(JSON.stringify({ error: 'Evolution API not configured' }), { status: 500, headers: corsHeaders })
    }

    const instanceName = `eisenflow_${userId.replace(/-/g, '')}`

    // Create instance on Evolution API
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
      }),
    })

    if (!createRes.ok) {
      const errBody = await createRes.text()
      // If instance already exists, try to connect it
      if (createRes.status === 403 || errBody.includes('already')) {
        // Try to get QR code from existing instance
        const connectRes = await fetch(`${EVOLUTION_API_URL}/instance/connect/${instanceName}`, {
          method: 'GET',
          headers: { apikey: EVOLUTION_API_KEY },
        })
        if (!connectRes.ok) {
          throw new Error(`Failed to reconnect instance: ${await connectRes.text()}`)
        }
        const connectData = await connectRes.json()
        const qrBase64 = connectData?.base64 || connectData?.qrcode?.base64 || null

        // Upsert connection record
        const { error: dbError } = await supabase
          .from('whatsapp_connections')
          .upsert({
            user_id: userId,
            instance_name: instanceName,
            status: qrBase64 ? 'qr_pending' : 'disconnected',
            qr_code: qrBase64,
          }, { onConflict: 'user_id' })

        if (dbError) throw dbError

        return new Response(JSON.stringify({ status: 'qr_pending', qr_code: qrBase64 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Evolution API error [${createRes.status}]: ${errBody}`)
    }

    const createData = await createRes.json()
    const qrBase64 = createData?.qrcode?.base64 || createData?.base64 || null

    // Set webhook for this instance
    await fetch(`${EVOLUTION_API_URL}/webhook/set/${instanceName}`, {
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

    // Upsert connection in DB
    const { error: dbError } = await supabase
      .from('whatsapp_connections')
      .upsert({
        user_id: userId,
        instance_name: instanceName,
        status: qrBase64 ? 'qr_pending' : 'disconnected',
        qr_code: qrBase64,
      }, { onConflict: 'user_id' })

    if (dbError) throw dbError

    return new Response(JSON.stringify({ status: 'qr_pending', qr_code: qrBase64 }), {
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
