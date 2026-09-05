/**
 * whatsapp-status
 * ──────────────────────────────────────────────────────────────────────
 * Consulta o estado da conexão pessoal no Evolution GO e sincroniza a linha.
 *
 * Chamada ........... front, polling de 4s enquanto o QR está pendente (JWT)
 * Entrada ........... nenhuma
 * Saída ............. { status, connected, logged_in, phone_number, qr_code,
 *                       webhook_reregistered? }
 * Lê/Escreve ........ whatsapp_connections
 * Env ............... EVOLUTION_API_URL, EVOLUTION_API_KEY,
 *                     EVOLUTION_WEBHOOK_SECRET, PUBLIC_FUNCTIONS_URL
 *
 * O QUE MUDOU EM RELAÇÃO À VERSÃO LOVABLE
 *   1. `GET /instance/connectionState/{nome}` não existe. É `GET /instance/status`
 *      autenticado com o TOKEN da instância, e a resposta vem em PascalCase:
 *      { Connected, LoggedIn, Name }. A tradução para os três valores que o
 *      schema e o front conhecem está em `traduzirStatus()`.
 *   2. O bloco que tentava cinco formatos de `POST /webhook/set/{nome}` sumiu:
 *      re-registrar webhook aqui é chamar `connect()` de novo.
 *   3. O telefone não vem no status. Ele está no campo `jid` do modelo da
 *      instância, exposto só na listagem administrativa — por isso a busca por
 *      `/instance/all` acontece apenas na virada para 'connected'.
 *
 * REFRESCO DO QR: como o front repola esta function a cada 4s enquanto está em
 * 'qr_pending', é aqui que o QR é renovado e regravado — sem isso o usuário
 * ficaria olhando um código morto. O evento `QRCode` do webhook faz o mesmo
 * caminho por conta própria; os dois são redundantes de propósito.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { admin, requireUser } from '../_shared/supabase.ts';
import { evolution, soDigitos, webhookUrl, type StatusInstancia } from '../_shared/evolution.ts';
import { erro, json, preflight, respostaErro } from '../_shared/http.ts';

/** { Connected, LoggedIn } (Go) -> o `status` string que o schema e o front usam. */
function traduzirStatus(estado: StatusInstancia | null, statusAtual: string): string {
  if (estado?.Connected && estado?.LoggedIn) return 'connected';
  // Pareado mas com o socket caído: não é 'connected' e também não pede QR novo.
  if (estado?.LoggedIn) return 'disconnected';
  // Sem pareamento: continua no fluxo de QR se era isso que estava acontecendo.
  return statusAtual === 'qr_pending' ? 'qr_pending' : 'disconnected';
}

/** O telefone da conta pareada mora no `jid` da instância (rota administrativa). */
async function buscarTelefone(instanceId: string | null, nome: string): Promise<string | null> {
  const todas = await evolution.listInstances().catch(() => []);
  const inst = (Array.isArray(todas) ? todas : []).find((i) => (instanceId && i?.id === instanceId) || i?.name === nome);
  return inst?.jid ? soDigitos(inst.jid) : null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  try {
    const user = await requireUser(req);
    const db = admin();

    const { data: conn } = await db.from('whatsapp_connections').select('*').eq('user_id', user.id).maybeSingle();
    if (!conn) return json({ status: 'disconnected' });

    if (!conn.instance_token) {
      // Conexão criada antes do porte para o Evolution GO: sem o token não há
      // como falar com a instância. Reconectar recria/recupera o token.
      throw erro('Conexão sem token de instância (criada antes da migração). Clique em conectar para refazer o pareamento.', 409);
    }

    const estado = await evolution.status(conn.instance_token);
    const status = traduzirStatus(estado, conn.status);
    // deno-lint-ignore no-explicit-any
    const patch: Record<string, any> = {};
    let webhookReregistrado: boolean | undefined;

    if (status === 'connected') {
      // O original re-registrava o webhook sempre que encontrava a instância
      // conectada — é a proteção contra o webhook ter sido perdido no servidor.
      // Aqui isso é `connect()`. Falhar não invalida o status.
      try {
        await evolution.connect(conn.instance_token, { webhookUrl: webhookUrl(), immediate: true });
        webhookReregistrado = true;
      } catch (e) {
        webhookReregistrado = false;
        console.log(`whatsapp-status: falha ao re-registrar webhook (${(e as Error).message})`);
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
        console.log(`whatsapp-status: QR indisponível (${(e as Error).message})`);
      }
    }

    if (status !== conn.status) patch.status = status;
    if (Object.keys(patch).length) {
      const { error } = await db.from('whatsapp_connections').update(patch).eq('id', conn.id);
      if (error) throw error;
    }

    return json({
      status,
      connected: !!estado?.Connected,
      logged_in: !!estado?.LoggedIn,
      phone_number: patch.phone_number ?? conn.phone_number ?? null,
      qr_code: patch.qr_code ?? (status === 'qr_pending' ? conn.qr_code : null),
      ...(webhookReregistrado === undefined ? {} : { webhook_reregistered: webhookReregistrado }),
    });
  } catch (e) {
    console.error('whatsapp-status:', e);
    return respostaErro(e);
  }
});
