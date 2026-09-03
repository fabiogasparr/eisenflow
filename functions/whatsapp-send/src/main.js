/**
 * whatsapp-send
 * ──────────────────────────────────────────────────────────────────────
 * Envia uma mensagem de texto pelo Evolution GO. Chamada interna
 * (server-to-server) pelas outras functions — nunca pelo frontend.
 *
 * Origem: supabase/functions/whatsapp-send/index.ts
 * Status: PORTADA
 *
 * Entrada .... { instance_token | instance_name, phone_number, message }
 * Saída ...... { success:true, data } | { ok:false, error }
 * Lê ......... whatsapp_connections, tenant_whatsapp_connections (só no
 *              caminho de compatibilidade por instance_name)
 * Variáveis .. EVOLUTION_API_URL, INTERNAL_FUNCTION_SECRET
 *
 * MUDANÇA EM RELAÇÃO AO ORIGINAL: a versão Supabase não tinha nenhuma
 * autenticação — qualquer pessoa com a URL disparava mensagens por qualquer
 * instância conectada. Aqui exige-se o header x-internal-secret.
 *
 * MUDANÇA DA API v2 PARA O EVOLUTION GO: a assinatura virou
 * `sendText(instanceToken, number, text)`. Não existe mais `{instance}` no path
 * nem envio com a chave global — quem identifica e autoriza a instância é o
 * TOKEN dela. O caminho preferido é receber `instance_token` pronto de quem
 * chama (que já leu o documento da conexão). `instance_name` continua aceito
 * por compatibilidade com chamadores ainda não atualizados (ex.:
 * dispatch-reminders): o token é resolvido consultando as conexões pelo nome —
 * duas leituras a mais por mensagem, então prefira mandar o token.
 * EVOLUTION_API_KEY (chave global) não é mais usada aqui: ela não envia.
 */
import { db, Query } from '../_shared/appwrite.js';
import { evolution } from '../_shared/evolution.js';
import { body, err } from '../_shared/http.js';

/** Compatibilidade: acha o token da instância pelo nome, pessoal ou de tenant. */
async function tokenPeloNome(nome) {
  const pessoal = await db.findOne('whatsapp_connections', [Query.equal('instance_name', nome)]);
  if (pessoal?.instance_token) return pessoal.instance_token;

  const tenant = await db.findOne('tenant_whatsapp_connections', [Query.equal('instance_name', nome)]);
  if (tenant?.instance_token) return tenant.instance_token;

  const e = new Error(
    pessoal || tenant
      ? `A conexão "${nome}" não tem instance_token gravado (criada antes da migração para o Evolution GO). É preciso reconectar o WhatsApp.`
      : `Nenhuma conexão encontrada para a instância "${nome}"`,
  );
  e.status = pessoal || tenant ? 409 : 404;
  throw e;
}

export default async ({ req, res, log, error }) => {
  try {
    if (!process.env.INTERNAL_FUNCTION_SECRET) {
      return res.json({ ok: false, error: 'INTERNAL_FUNCTION_SECRET não configurado' }, 500);
    }
    if (req.headers['x-internal-secret'] !== process.env.INTERNAL_FUNCTION_SECRET) {
      return res.json({ ok: false, error: 'não autorizado' }, 401);
    }

    const { instance_token: instanceToken, instance_name: instanceName, phone_number: telefone, message } = body(req);
    if (!telefone || !message) {
      return res.json({ ok: false, error: 'phone_number e message são obrigatórios' }, 400);
    }
    if (!instanceToken && !instanceName) {
      return res.json({ ok: false, error: 'instance_token (ou instance_name) é obrigatório' }, 400);
    }

    const token = instanceToken || (await tokenPeloNome(instanceName));

    // Só dígitos: o Evolution GO monta o JID sozinho. Não aplicamos normalize()
    // (que força o DDI 55) para não quebrar número internacional já correto.
    const numero = String(telefone).replace(/\D/g, '');
    const data = await evolution.sendText(token, numero, message);

    log(`whatsapp-send: enviado para ${numero.slice(0, 4)}**** via ${instanceName || 'token'}`);
    return res.json({ success: true, data });
  } catch (e) {
    error(`whatsapp-send: ${e.message}`);
    return err(res, e);
  }
};
