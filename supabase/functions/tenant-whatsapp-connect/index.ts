// tenant-whatsapp-connect: creates Evolution API instance for a tenant and returns QR
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

    const { tenant_id } = await req.json()
    if (!tenant_id) return new Response(JSON.stringify({ error: 'tenant_id required' }), { status: 400, headers: corsHeaders })

    // Permission check
    const { data: role } = await admin.rpc('get_tenant_role', { _user_id: user.id, _tenant_id: tenant_id })
    if (!['owner', 'admin'].includes(role as string)) {
      return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: corsHeaders })
    }

    const instance_name = `tenant_${tenant_id.replace(/-/g, '').slice(0, 16)}`

    // Create instance (idempotent: ignore "already exists")
    const createRes = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
      body: JSON.stringify({ instanceName: instance_name, integration: 'WHATSAPP-BAILEYS', qrcode: true }),
    })
    const createData = await createRes.json().catch(() => ({}))

    // Fetch QR
    const qrRes = await fetch(`${EVOLUTION_API_URL}/instance/connect/${instance_name}`, {
      headers: { apikey: EVOLUTION_API_KEY },
    })
    const qrData = await qrRes.json().catch(() => ({}))
    const qr_code = qrData.base64 || qrData.qrcode?.base64 || createData?.qrcode?.base64 || null

    // Upsert connection row
    await admin.from('tenant_whatsapp_connections').upsert({
      tenant_id,
      instance_name,
      status: 'qr_pending',
      qr_code,
      created_by: user.id,
    }, { onConflict: 'tenant_id' })

    return new Response(JSON.stringify({ ok: true, instance_name, qr_code }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
