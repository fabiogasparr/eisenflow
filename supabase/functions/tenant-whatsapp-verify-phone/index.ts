/**
 * tenant-whatsapp-verify-phone
 * ──────────────────────────────────────────────────────────────────────
 * Envia e confere o código de verificação que vincula o telefone de um membro
 * ao tenant. O código vai por WhatsApp, pela instância do próprio tenant.
 *
 * Chamada ........... front (JWT) + ser MEMBRO do tenant
 * Entrada ........... { action:'send'|'verify', tenant_id, phone_number?, code? }
 * Saída ............. { ok:true } | { ok:true, verified:true }
 * Lê ................ tenant_members, tenant_whatsapp_connections
 * Lê/Escreve ........ tenant_member_phones
 * Env ............... EVOLUTION_API_URL
 *
 * CORREÇÕES EM RELAÇÃO À VERSÃO LOVABLE
 *   - AUTORIZAÇÃO: passa a exigir que o usuário seja membro do tenant. No
 *     original, qualquer usuário autenticado registrava um telefone em qualquer
 *     tenant (e recebia o OTP pela instância dele).
 *   - OTP com `crypto.getRandomValues` (CSPRNG). O original usava `Math.random`,
 *     que é previsível e não serve para código de verificação.
 *   - Grava ANTES de enviar: se o WhatsApp falhar, o usuário reenvia; se a
 *     gravação falhasse depois do envio, o código não validaria nunca.
 *   - `instance_name` não serve mais para enviar: o Evolution GO autentica pelo
 *     token da instância. Conexão sem `instance_token` gravado devolve 409.
 *   - Envio direto por `evolution.sendText` em vez de passar por
 *     `whatsapp-send`: a conexão (com token) já foi lida aqui, e o OTP não
 *     precisa transitar por outra function.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { admin, requireTenantMember, requireUser } from '../_shared/supabase.ts';
import { evolution, normalize } from '../_shared/evolution.ts';
import { erro, json, lerCorpo, preflight, respostaErro } from '../_shared/http.ts';

const VALIDADE_MS = 10 * 60 * 1000;

/** 6 dígitos de fonte criptográfica, com zeros à esquerda. */
function gerarOtp(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, '0');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  try {
    const user = await requireUser(req);
    const { action, tenant_id: tenantId, phone_number: telefone, code } = await lerCorpo(req);
    if (!tenantId || !action) throw erro('tenant_id e action são obrigatórios', 400);

    await requireTenantMember(tenantId, user.id);
    const db = admin();

    const { data: existente } = await db
      .from('tenant_member_phones')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .maybeSingle();

    // ------------------------------------------------------------------ send
    if (action === 'send') {
      if (!telefone) throw erro('phone_number é obrigatório', 400);

      const { data: conn } = await db
        .from('tenant_whatsapp_connections')
        .select('instance_token, status')
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (!conn || conn.status !== 'connected') throw erro('O WhatsApp do workspace não está conectado', 400);
      if (!conn.instance_token) {
        throw erro('Conexão do workspace sem token de instância (criada antes da migração). Um admin precisa reconectar o WhatsApp.', 409);
      }

      const otp = gerarOtp();
      const numero = normalize(telefone);
      const { error } = await db.from('tenant_member_phones').upsert({
        tenant_id: tenantId,
        user_id: user.id,
        phone_number: numero,
        verified: false,
        verification_code: otp,
        verification_expires_at: new Date(Date.now() + VALIDADE_MS).toISOString(),
      }, { onConflict: 'tenant_id,user_id' });
      if (error) throw error;

      await evolution.sendText(conn.instance_token, numero, `Seu código EisenFlow: *${otp}*\nVálido por 10 minutos.`);
      console.log(`tenant-whatsapp-verify-phone: código enviado para ${numero.slice(0, 4)}****`);
      return json({ ok: true });
    }

    // ---------------------------------------------------------------- verify
    if (action === 'verify') {
      if (!existente) throw erro('Nenhum telefone pendente de verificação', 404);
      if (!existente.verification_code || existente.verification_code !== String(code || '')) {
        throw erro('Código inválido', 400);
      }
      if (!existente.verification_expires_at || new Date(existente.verification_expires_at).getTime() < Date.now()) {
        throw erro('Código expirado', 400);
      }

      const { error } = await db.from('tenant_member_phones').update({
        verified: true,
        verification_code: null,
        verification_expires_at: null,
      }).eq('id', existente.id);
      if (error) throw error;

      console.log(`tenant-whatsapp-verify-phone: telefone verificado (tenant ${tenantId})`);
      return json({ ok: true, verified: true });
    }

    throw erro(`Ação desconhecida: ${action}`, 400);
  } catch (e) {
    console.error('tenant-whatsapp-verify-phone:', e);
    return respostaErro(e);
  }
});
