/**
 * whatsapp-connect
 * ──────────────────────────────────────────────────────────────────────
 * Cria (ou reaproveita) a instância pessoal no Evolution GO, declara o webhook
 * e devolve o QR code para o pareamento.
 *
 * Origem: supabase/functions/whatsapp-connect/index.ts (Deno)
 * Destino: Appwrite Function, runtime node-20
 *
 * Gatilho .......... http-frontend
 * Autenticação ..... jwt-usuario
 * Entrada .......... { timezone? }  — o fuso do navegador, gravado na criação
 * Saída ............ { status, qr_code, instance_name, webhook_registered }
 * Lê ............... whatsapp_connections
 * Escreve .......... whatsapp_connections  (server-doc: leitura concedida ao dono)
 * APIs externas .... Evolution GO
 * Variáveis ........ EVOLUTION_API_URL, EVOLUTION_API_KEY,
 *                    EVOLUTION_WEBHOOK_SECRET, PUBLIC_WEBHOOK_BASE_URL
 *
 * O QUE MUDOU EM RELAÇÃO AO ORIGINAL
 *   1. Não existe mais `POST /webhook/set/{instance}` (o original tentava cinco
 *      formatos de payload em sequência, todos de v2). No Evolution GO o webhook
 *      é declarado dentro de `POST /instance/connect` — uma chamada só.
 *   2. A instância NÃO é identificada pelo nome no path: cada uma tem um TOKEN
 *      próprio, devolvido por `/instance/create`, e é ele que autentica QR,
 *      status e envio. Por isso `instance_token` (credencial) e `instance_id`
 *      (UUID, só para deletar) são gravados aqui — sem isso, nenhuma das outras
 *      functions consegue falar com a instância.
 *   3. A URL do webhook vinha de SUPABASE_URL; agora é `webhookUrl()`, que monta
 *      PUBLIC_WEBHOOK_BASE_URL + /whatsapp-webhook + o segredo na query (única
 *      autenticação possível — o Evolution GO não assina o payload).
 *
 * O QR EXPIRA E ROTACIONA: o primeiro código vale ~60s, os seguintes ~20s. O QR
 * devolvido aqui é só o primeiro. O front PRECISA continuar buscando um novo —
 * ou repolando `whatsapp-status` (que refaz o `GET /instance/qr` e regrava
 * `qr_code`), ou ouvindo o realtime do documento, que `whatsapp-webhook` atualiza
 * a cada evento `QRCode`. Mostrar o QR estático desta resposta por mais de um
 * minuto garante falha no pareamento.
 */
import { db, Query } from '../_shared/appwrite.js';
import { requireUser } from '../_shared/auth.js';
import { evolution, webhookUrl } from '../_shared/evolution.js';
import { body, err } from '../_shared/http.js';

/** Nome estável e determinístico: permite reencontrar a instância no servidor. */
const nomeDaInstancia = (userId) => `eisenflow_${String(userId).replace(/-/g, '')}`;

/**
 * Garante que temos o par (token, id) da instância.
 * Ordem: o que já está gravado -> criar -> recuperar pela listagem administrativa.
 * O terceiro caso cobre a instância que existe no servidor mas cujo token se
 * perdeu no banco (registro apagado, migração antiga): `/instance/create` recusa
 * o nome duplicado e `/instance/all` é o único jeito de reaver o token.
 */
async function garantirInstancia(nome, conn, log) {
  if (conn?.instance_token) return { token: conn.instance_token, id: conn.instance_id || null };

  try {
    const nova = await evolution.createInstance(nome);
    log(`whatsapp-connect: instância ${nome} criada (${nova.id})`);
    return { token: nova.token, id: nova.id };
  } catch (e) {
    const existentes = await evolution.listInstances().catch(() => []);
    const achada = (Array.isArray(existentes) ? existentes : []).find((i) => i?.name === nome);
    if (!achada?.token) throw e;
    log(`whatsapp-connect: instância ${nome} já existia, token recuperado da listagem`);
    return { token: achada.token, id: achada.id || null };
  }
}

export default async ({ req, res, log, error }) => {
  try {
    const user = await requireUser(req);
    const { timezone } = body(req);

    const conn = await db.findOne('whatsapp_connections', [Query.equal('user_id', user.$id)]);
    const nome = conn?.instance_name || nomeDaInstancia(user.$id);
    const { token, id } = await garantirInstancia(nome, conn, log);

    // Conectar e registrar o webhook é a MESMA chamada aqui. `immediate: true`
    // devolve na hora em vez de bloquear esperando o pareamento.
    await evolution.connect(token, { webhookUrl: webhookUrl(), immediate: true });

    // Se a instância já estava pareada, não há QR a buscar — e `/instance/qr`
    // costuma falhar nesse estado.
    const estado = await evolution.status(token).catch(() => null);
    let qrCode = null;
    if (!estado?.LoggedIn) {
      try {
        const qr = await evolution.qr(token);
        qrCode = qr?.Qrcode || null; // data-URI PNG, pronto para <img src>
      } catch (e) {
        // Sem QR agora não é fatal: o evento QRCode do webhook grava o próximo.
        log(`whatsapp-connect: QR indisponível no momento (${e.message})`);
      }
    }

    const status = estado?.LoggedIn && estado?.Connected ? 'connected' : (qrCode ? 'qr_pending' : 'disconnected');
    const dados = {
      instance_name: nome,
      instance_token: token,
      instance_id: id,
      status,
      qr_code: qrCode,
    };

    if (conn) {
      await db.update('whatsapp_connections', conn.$id, dados);
    } else {
      // server-doc: a Function é a única que escreve; o dono só lê.
      await db.create(
        'whatsapp_connections',
        { user_id: user.$id, ...dados, ...(timezone ? { timezone } : {}) },
        [`read("user:${user.$id}")`],
      );
    }

    log(`whatsapp-connect: ${nome} -> ${status}`);
    return res.json({ status, qr_code: qrCode, instance_name: nome, webhook_registered: true });
  } catch (e) {
    error(`whatsapp-connect: ${e.message}`);
    return err(res, e);
  }
};
