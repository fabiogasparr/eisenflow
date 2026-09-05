/**
 * whatsapp-connect
 * ──────────────────────────────────────────────────────────────────────
 * Cria (ou reaproveita) a instância pessoal no Evolution GO, declara o webhook
 * e devolve o QR code para o pareamento.
 *
 * Chamada ........... front, `supabase.functions.invoke('whatsapp-connect')` (JWT)
 * Entrada ........... { timezone? } — opcional, gravado na criação
 * Saída ............. { status, qr_code, instance_name, webhook_registered }
 * Lê/Escreve ........ whatsapp_connections (service role; dono validado pelo JWT)
 * APIs externas ..... Evolution GO
 * Env ............... EVOLUTION_API_URL, EVOLUTION_API_KEY,
 *                     EVOLUTION_WEBHOOK_SECRET, PUBLIC_FUNCTIONS_URL
 *
 * O QUE MUDOU EM RELAÇÃO À VERSÃO LOVABLE
 *   1. Não existe mais `POST /webhook/set/{instance}` (o original tentava cinco
 *      formatos de payload em sequência, todos da API v2). No Evolution GO o
 *      webhook é declarado dentro de `POST /instance/connect` — uma chamada só.
 *   2. A instância NÃO é identificada pelo nome no path: cada uma tem um TOKEN
 *      próprio, devolvido por `/instance/create`, e é ele que autentica QR,
 *      status e envio. Por isso `instance_token` (credencial) e `instance_id`
 *      (UUID, só para deletar) são gravados aqui — sem isso, nenhuma das outras
 *      functions consegue falar com a instância.
 *   3. A URL do webhook vinha de SUPABASE_URL (interno ao docker); agora é
 *      `webhookUrl()`, que monta PUBLIC_FUNCTIONS_URL + /whatsapp-webhook + o
 *      segredo na query (única autenticação possível — o Evolution GO não assina).
 *
 * O QR EXPIRA E ROTACIONA: o primeiro código vale ~60s, os seguintes ~20s. O
 * front repola `whatsapp-status` (que refaz o `GET /instance/qr` e regrava
 * `qr_code`) e o `whatsapp-webhook` grava o QR novo a cada evento `QRCode`.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { admin, requireUser } from '../_shared/supabase.ts';
import { evolution, garantirInstancia, webhookUrl } from '../_shared/evolution.ts';
import { json, lerCorpo, preflight, respostaErro } from '../_shared/http.ts';

/** Nome estável e determinístico: permite reencontrar a instância no servidor. */
const nomeDaInstancia = (userId: string) => `eisenflow_${userId.replace(/-/g, '')}`;

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  try {
    const user = await requireUser(req);
    const { timezone } = await lerCorpo(req);
    const db = admin();

    const { data: conn } = await db.from('whatsapp_connections').select('*').eq('user_id', user.id).maybeSingle();
    const nome: string = conn?.instance_name || nomeDaInstancia(user.id);
    const { token, id } = await garantirInstancia(nome, conn, 'whatsapp-connect');

    // Conectar e registrar o webhook é a MESMA chamada aqui. `immediate: true`
    // devolve na hora em vez de bloquear esperando o pareamento.
    await evolution.connect(token, { webhookUrl: webhookUrl(), immediate: true });

    // Se a instância já estava pareada, não há QR a buscar — e `/instance/qr`
    // costuma falhar nesse estado.
    const estado = await evolution.status(token).catch(() => null);
    let qrCode: string | null = null;
    if (!estado?.LoggedIn) {
      try {
        const qr = await evolution.qr(token);
        qrCode = qr?.Qrcode || null; // data-URI PNG, pronto para <img src>
      } catch (e) {
        // Sem QR agora não é fatal: o evento QRCode do webhook grava o próximo.
        console.log(`whatsapp-connect: QR indisponível no momento (${(e as Error).message})`);
      }
    }

    const status = estado?.LoggedIn && estado?.Connected ? 'connected' : (qrCode ? 'qr_pending' : 'disconnected');
    const dados = {
      user_id: user.id,
      instance_name: nome,
      instance_token: token,
      instance_id: id,
      status,
      qr_code: qrCode,
      ...(timezone && !conn ? { timezone } : {}),
    };

    const { error } = await db.from('whatsapp_connections').upsert(dados, { onConflict: 'user_id' });
    if (error) throw error;

    console.log(`whatsapp-connect: ${nome} -> ${status}`);
    return json({ status, qr_code: qrCode, instance_name: nome, webhook_registered: true });
  } catch (e) {
    console.error('whatsapp-connect:', e);
    return respostaErro(e);
  }
});
