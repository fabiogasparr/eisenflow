/**
 * whatsapp-status
 * ──────────────────────────────────────────────────────────────────────
 * Consulta o estado da conexão pessoal no Evolution GO e sincroniza o documento.
 *
 * Origem: supabase/functions/whatsapp-status/index.ts (Deno)
 * Destino: Appwrite Function, runtime node-20
 *
 * Gatilho .......... http-frontend (polling de 4s enquanto o QR está pendente)
 * Autenticação ..... jwt-usuario
 * Entrada .......... nenhuma
 * Saída ............ { status, phone_number?, qr_code?, connected, logged_in,
 *                      webhook_reregistered? }
 * Lê ............... whatsapp_connections
 * Escreve .......... whatsapp_connections
 * APIs externas .... Evolution GO
 * Variáveis ........ EVOLUTION_API_URL, EVOLUTION_API_KEY,
 *                    EVOLUTION_WEBHOOK_SECRET, PUBLIC_WEBHOOK_BASE_URL
 *
 * O QUE MUDOU EM RELAÇÃO AO ORIGINAL
 *   1. `GET /instance/connectionState/{nome}` não existe. É `GET /instance/status`
 *      autenticado com o TOKEN da instância, e a resposta vem em PascalCase:
 *      { Connected, LoggedIn, Name }. A tradução para os três valores que o
 *      schema e o front conhecem ('connected' | 'qr_pending' | 'disconnected')
 *      está em `traduzirStatus()`.
 *   2. O bloco que tentava cinco formatos de `POST /webhook/set/{nome}` sumiu:
 *      re-registrar webhook aqui é chamar `connect()` de novo (mesma rota que
 *      declara o webhook no Evolution GO).
 *   3. O telefone não vem no status. Ele está no campo `jid` do modelo da
 *      instância, exposto só na listagem administrativa — por isso a busca por
 *      `/instance/all` acontece apenas na virada para 'connected'.
 *
 * REFRESCO DO QR: o QR do Evolution GO rotaciona (~60s o primeiro, ~20s os
 * demais). Como o front repola esta function a cada 4s enquanto está em
 * 'qr_pending', é aqui que o QR é renovado e regravado — sem isso o usuário
 * ficaria olhando um código morto. O evento `QRCode` do webhook faz o mesmo
 * caminho por conta própria; os dois são redundantes de propósito.
 */
import { db, Query } from '../_shared/appwrite.js';
import { requireUser } from '../_shared/auth.js';
import { evolution, webhookUrl, soDigitos } from '../_shared/evolution.js';
import { err } from '../_shared/http.js';

/** { Connected, LoggedIn } (Go) -> o `status` string que o schema e o front usam. */
function traduzirStatus(estado, statusAtual) {
  if (estado?.Connected && estado?.LoggedIn) return 'connected';
  // Pareado mas com o socket caído: não é 'connected' e também não pede QR novo.
  if (estado?.LoggedIn) return 'disconnected';
  // Sem pareamento: continua no fluxo de QR se era isso que estava acontecendo.
  return statusAtual === 'qr_pending' ? 'qr_pending' : 'disconnected';
}

/** O telefone da conta pareada mora no `jid` da instância (rota administrativa). */
async function buscarTelefone(instanceId, nome) {
  const todas = await evolution.listInstances().catch(() => []);
  const inst = (Array.isArray(todas) ? todas : []).find((i) => i?.id === instanceId || i?.name === nome);
  return inst?.jid ? soDigitos(inst.jid) : null;
}

export default async ({ req, res, log, error }) => {
  try {
    const user = await requireUser(req);

    const conn = await db.findOne('whatsapp_connections', [Query.equal('user_id', user.$id)]);
    if (!conn) return res.json({ status: 'disconnected' });

    if (!conn.instance_token) {
      // Conexão criada antes do porte para o Evolution GO: sem o token não há
      // como falar com a instância. Reconectar recria/recupera o token.
      const e = new Error('Conexão sem token de instância (criada antes da migração). Clique em conectar para refazer o pareamento.');
      e.status = 409;
      throw e;
    }

    const estado = await evolution.status(conn.instance_token);
    const status = traduzirStatus(estado, conn.status);
    const patch = {};
    let webhookReregistrado;

    if (status === 'connected') {
      // O original re-registrava o webhook sempre que encontrava a instância
      // conectada — é a proteção contra o webhook ter sido perdido no servidor.
      // Aqui isso é `connect()`. Falhar não invalida o status.
      try {
        await evolution.connect(conn.instance_token, { webhookUrl: webhookUrl(), immediate: true });
        webhookReregistrado = true;
      } catch (e) {
        webhookReregistrado = false;
        log(`whatsapp-status: falha ao re-registrar webhook (${e.message})`);
      }
      if (!conn.phone_number) {
        patch.phone_number = await buscarTelefone(conn.instance_id, conn.instance_name);
      }
      if (conn.qr_code) patch.qr_code = null; // pareado: o QR não serve mais
    } else if (status === 'qr_pending') {
      // Busca o QR corrente — o anterior provavelmente já expirou.
      try {
        const qr = await evolution.qr(conn.instance_token);
        if (qr?.Qrcode && qr.Qrcode !== conn.qr_code) patch.qr_code = qr.Qrcode;
      } catch (e) {
        log(`whatsapp-status: QR indisponível (${e.message})`);
      }
    }

    if (status !== conn.status) patch.status = status;
    if (Object.keys(patch).length) await db.update('whatsapp_connections', conn.$id, patch);

    return res.json({
      status,
      connected: !!estado?.Connected,
      logged_in: !!estado?.LoggedIn,
      phone_number: patch.phone_number ?? conn.phone_number ?? null,
      qr_code: patch.qr_code ?? (status === 'qr_pending' ? conn.qr_code : null),
      ...(webhookReregistrado === undefined ? {} : { webhook_reregistered: webhookReregistrado }),
    });
  } catch (e) {
    error(`whatsapp-status: ${e.message}`);
    return err(res, e);
  }
};
