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

    const token = authHeader.replace('Bearer ', '')
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token)
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }
    const userId = claimsData.claims.sub

    const EVOLUTION_API_URL = Deno.env.get('EVOLUTION_API_URL')
    const EVOLUTION_API_KEY = Deno.env.get('EVOLUTION_API_KEY')
    if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
      return new Response(JSON.stringify({ error: 'Evolution API not configured' }), { status: 500, headers: corsHeaders })
    }

    // Get connection info
    const { data: conn } = await supabase
      .from('whatsapp_connections')
      .select('instance_name')
      .eq('user_id', userId)
      .single()

    if (conn?.instance_name) {
      // Logout and delete instance
      await fetch(`${EVOLUTION_API_URL}/instance/logout/${conn.instance_name}`, {
        method: 'DELETE',
        headers: { apikey: EVOLUTION_API_KEY },
      })
      await fetch(`${EVOLUTION_API_URL}/instance/delete/${conn.instance_name}`, {
        method: 'DELETE',
        headers: { apikey: EVOLUTION_API_KEY },
      })
    }

    // Update DB
    const { error: dbError } = await supabase
      .from('whatsapp_connections')
      .update({ status: 'disconnected', qr_code: null, phone_number: null })
      .eq('user_id', userId)

    if (dbError) throw dbError

    return new Response(JSON.stringify({ status: 'disconnected' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('whatsapp-disconnect error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
