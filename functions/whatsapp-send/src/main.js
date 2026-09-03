/**
 * whatsapp-send
 * ──────────────────────────────────────────────────────────────────────
 * Envia uma mensagem de texto via Evolution API. Chamada interna (server-to-server)
 * pelas outras functions — nunca pelo frontend.
 *
 * Origem: supabase/functions/whatsapp-send/index.ts
 * Status: PORTADA (lógica completa, não é esqueleto)
 *
 * Entrada .... { instance_name, phone_number, message }
 * Saída ...... { success:true, data } | { ok:false, error }
 * Variáveis .. EVOLUTION_API_URL, EVOLUTION_API_KEY, INTERNAL_FUNCTION_SECRET
 *
 * MUDANÇA EM RELAÇÃO AO ORIGINAL: a versão Supabase não tinha nenhuma
 * autenticação — qualquer pessoa com a URL disparava mensagens por qualquer
 * instância conectada. Aqui exige-se o header x-internal-secret.
 */
import { evolution } from '../_shared/evolution.js';
import { body, err } from '../_shared/http.js';

export default async ({ req, res, log, error }) => {
  try {
    if (!process.env.INTERNAL_FUNCTION_SECRET) {
      return res.json({ ok: false, error: 'INTERNAL_FUNCTION_SECRET não configurado' }, 500);
    }
    if (req.headers['x-internal-secret'] !== process.env.INTERNAL_FUNCTION_SECRET) {
      return res.json({ ok: false, error: 'não autorizado' }, 401);
    }

    const { instance_name, phone_number, message } = body(req);
    if (!instance_name || !phone_number || !message) {
      return res.json({ ok: false, error: 'instance_name, phone_number e message são obrigatórios' }, 400);
    }

    const data = await evolution.sendText(instance_name, phone_number, message);
    log(`whatsapp-send: enviado via ${instance_name}`);
    return res.json({ success: true, data });
  } catch (e) {
    error(`whatsapp-send: ${e.message}`);
    return err(res, e);
  }
};
