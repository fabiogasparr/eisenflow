/**
 * tenant-whatsapp-verify-phone
 * ──────────────────────────────────────────────────────────────────────
 * Envia e confere o código de verificação que vincula o telefone de um membro
 * ao tenant. O código vai por WhatsApp, pela instância do próprio tenant.
 *
 * Origem: supabase/functions/tenant-whatsapp-verify-phone/index.ts (Deno)
 * Destino: Appwrite Function, runtime node-20
 *
 * Gatilho .......... http-frontend
 * Autenticação ..... jwt-usuario + ser membro do tenant
 * Entrada .......... { action:'send'|'verify', tenant_id, phone_number?, code? }
 * Saída ............ { ok:true } | { ok:true, verified:true }
 * Lê ............... tenant_members, tenant_whatsapp_connections, tenant_member_phones
 * Escreve .......... tenant_member_phones  (server-doc)
 * APIs externas .... Evolution GO
 * Variáveis ........ EVOLUTION_API_URL, EVOLUTION_API_KEY
 *
 * DECISÕES DO PORTE
 *   - Envio direto por `evolution.sendText(token, ...)` em vez de invocar a
 *     function `whatsapp-send` via `_shared/invoke.js`. Motivo: esta function já
 *     precisa ler `tenant_whatsapp_connections` para saber se o WhatsApp do
 *     tenant está conectado, e nessa leitura o token já vem junto — passar pelo
 *     `whatsapp-send` custaria uma execução extra, exigiria
 *     INTERNAL_FUNCTION_SECRET e faria o OTP transitar pelo log de execução de
 *     outra function, sem ganhar nada. `invoke.js` se justifica quando quem
 *     chama NÃO tem a conexão em mãos (é o caso de `dispatch-reminders`).
 *   - OTP com `crypto.randomInt` (CSPRNG). O original usava `Math.random`, que é
 *     previsível e não serve para código de verificação.
 *   - Passa a exigir que o usuário seja membro do tenant. No original, qualquer
 *     usuário autenticado podia registrar um telefone em qualquer tenant.
 *   - `instance_name` não serve mais para enviar: o Evolution GO autentica pelo
 *     token da instância. Conexão antiga sem `instance_token` gravado devolve
 *     erro pedindo reconectar.
 */
import { db, Query } from '../_shared/appwrite.js';
import { requireUser, getTenantRole } from '../_shared/auth.js';
import { evolution, normalize } from '../_shared/evolution.js';
import { body, err } from '../_shared/http.js';
import { randomInt } from 'node:crypto';

const VALIDADE_MS = 10 * 60 * 1000;
const erro = (msg, status) => Object.assign(new Error(msg), { status });

export default async ({ req, res, log, error }) => {
  try {
    const user = await requireUser(req);
    const { action, tenant_id: tenantId, phone_number: telefone, code } = body(req);
    if (!tenantId || !action) throw erro('tenant_id e action são obrigatórios', 400);

    const papel = await getTenantRole(db, tenantId, user.$id);
    if (!papel) throw erro('Você não é membro deste workspace', 403);

    const existente = await db.findOne('tenant_member_phones', [
      Query.equal('tenant_id', tenantId),
      Query.equal('user_id', user.$id),
    ]);

    // ------------------------------------------------------------------ send
    if (action === 'send') {
      if (!telefone) throw erro('phone_number é obrigatório', 400);

      const conn = await db.findOne('tenant_whatsapp_connections', [Query.equal('tenant_id', tenantId)]);
      if (!conn || conn.status !== 'connected') throw erro('O WhatsApp do workspace não está conectado', 400);
      if (!conn.instance_token) {
        throw erro('Conexão do workspace sem token de instância (criada antes da migração). Um admin precisa reconectar o WhatsApp.', 409);
      }

      const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const numero = normalize(telefone);
      const dados = {
        phone_number: numero,
        verified: false,
        verification_code: otp,
        verification_expires_at: new Date(Date.now() + VALIDADE_MS).toISOString(),
      };

      if (existente) {
        await db.update('tenant_member_phones', existente.$id, dados);
      } else {
        // server-doc, e o documento carrega o OTP em claro enquanto pendente:
        // a leitura fica restrita ao próprio membro, não ao Team do tenant.
        await db.create(
          'tenant_member_phones',
          { tenant_id: tenantId, user_id: user.$id, ...dados },
          [`read("user:${user.$id}")`],
        );
      }

      // Enviado só depois de gravado: se o WhatsApp falhar, o usuário reenvia;
      // se a gravação falhasse depois do envio, o código não validaria nunca.
      await evolution.sendText(conn.instance_token, numero, `Seu código EisenFlow: *${otp}*\nVálido por 10 minutos.`);
      log(`tenant-whatsapp-verify-phone: código enviado para ${numero.slice(0, 4)}****`);
      return res.json({ ok: true });
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

      await db.update('tenant_member_phones', existente.$id, {
        verified: true,
        verification_code: null,
        verification_expires_at: null,
      });
      log(`tenant-whatsapp-verify-phone: telefone verificado (tenant ${tenantId})`);
      return res.json({ ok: true, verified: true });
    }

    throw erro(`Ação desconhecida: ${action}`, 400);
  } catch (e) {
    error(`tenant-whatsapp-verify-phone: ${e.message}`);
    return err(res, e);
  }
};
