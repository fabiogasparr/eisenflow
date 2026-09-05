/**
 * tenant-whatsapp-connect
 * ──────────────────────────────────────────────────────────────────────
 * Cria (ou reaproveita) a instância do WhatsApp corporativo do tenant no
 * Evolution GO, declara o webhook e devolve o QR code.
 *
 * Chamada ........... front (JWT) + papel owner/admin no tenant
 * Entrada ........... { tenant_id }
 * Saída ............. { ok, instance_name, qr_code, status }
 * Lê ................ tenant_members
 * Lê/Escreve ........ tenant_whatsapp_connections
 * Env ............... EVOLUTION_API_URL, EVOLUTION_API_KEY,
 *                     EVOLUTION_WEBHOOK_SECRET, PUBLIC_FUNCTIONS_URL
 *
 * É o gêmeo de `whatsapp-connect` no nível do tenant; valem as mesmas três
 * mudanças do Evolution GO (webhook declarado no connect, instância identificada
 * pelo token, QR rotativo). O painel do workspace repola a LINHA a cada 4s —
 * quem mantém `qr_code` fresco é o evento `QRCode` do `whatsapp-webhook`; a
 * resposta desta chamada é só o primeiro código.
 *
 * SEGURANÇA: o original chamava a RPC `get_tenant_role`; aqui é
 * `requireTenantAdmin()`, que barra membro comum antes de tocar na Evolution.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { admin, requireTenantAdmin, requireUser } from '../_shared/supabase.ts';
import { evolution, garantirInstancia, webhookUrl } from '../_shared/evolution.ts';
import { erro, json, lerCorpo, preflight, respostaErro } from '../_shared/http.ts';

/** Mesmo formato do original — 16 chars do uuid bastam para não colidir. */
const nomeDaInstancia = (tenantId: string) => `tenant_${tenantId.replace(/-/g, '').slice(0, 16)}`;

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  try {
    const user = await requireUser(req);
    const { tenant_id: tenantId } = await lerCorpo(req);
    if (!tenantId) throw erro('tenant_id é obrigatório', 400);

    await requireTenantAdmin(tenantId, user.id);
    const db = admin();

    const { data: conn } = await db.from('tenant_whatsapp_connections').select('*').eq('tenant_id', tenantId).maybeSingle();
    const nome: string = conn?.instance_name || nomeDaInstancia(tenantId);
    const { token, id } = await garantirInstancia(nome, conn, 'tenant-whatsapp-connect');

    await evolution.connect(token, { webhookUrl: webhookUrl(), immediate: true });

    const estado = await evolution.status(token).catch(() => null);
    let qrCode: string | null = null;
    if (!estado?.LoggedIn) {
      try {
        const qr = await evolution.qr(token);
        qrCode = qr?.Qrcode || null;
      } catch (e) {
        console.log(`tenant-whatsapp-connect: QR indisponível no momento (${(e as Error).message})`);
      }
    }

    const status = estado?.LoggedIn && estado?.Connected ? 'connected' : (qrCode ? 'qr_pending' : 'disconnected');
    const { error } = await db.from('tenant_whatsapp_connections').upsert({
      tenant_id: tenantId,
      created_by: conn?.created_by || user.id,
      instance_name: nome,
      instance_token: token,
      instance_id: id,
      status,
      qr_code: qrCode,
    }, { onConflict: 'tenant_id' });
    if (error) throw error;

    console.log(`tenant-whatsapp-connect: ${nome} -> ${status}`);
    return json({ ok: true, instance_name: nome, qr_code: qrCode, status });
  } catch (e) {
    console.error('tenant-whatsapp-connect:', e);
    return respostaErro(e);
  }
});
