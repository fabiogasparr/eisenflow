/**
 * whatsapp-webhook
 * ──────────────────────────────────────────────────────────────────────
 * O cérebro do assistente por WhatsApp: recebe o evento do Evolution GO,
 * deduplica, identifica o usuário pela instância, transcreve áudio, lê imagem,
 * conversa com a IA por function calling e cria/edita tarefas.
 *
 * Chamada ........... Evolution GO (webhook externo) — verify_jwt = false
 * Autenticação ...... segredo na query (`?secret=EVOLUTION_WEBHOOK_SECRET`) +
 *                     conferência do `instanceToken` do corpo contra a conexão
 * Entrada ........... { event, data, instanceId, instanceToken, instanceName }
 * Saída ............. { ok:true, ... } sempre 200 — a resposta real volta pelo WhatsApp
 * Lê ................ whatsapp_connections, tenant_whatsapp_connections, tasks,
 *                     team_members, teams, profiles, whatsapp_chat_history,
 *                     task_reminders, gamification, productivity_metrics
 * Escreve ........... tasks, task_reminders, delegations, whatsapp_chat_history,
 *                     whatsapp_processed_messages, whatsapp_connections,
 *                     tenant_whatsapp_connections
 * APIs externas ..... Evolution GO, IA (_shared/ai.ts -> OmniRoute)
 * Env ............... EVOLUTION_API_URL, EVOLUTION_WEBHOOK_SECRET, AI_API_KEY
 *
 * MUDANÇAS EM RELAÇÃO À VERSÃO LOVABLE:
 *  1. SEGURANÇA. O original aceitava qualquer POST — quem tivesse a URL escrevia
 *     no banco em nome de qualquer usuário. Agora: segredo na query (única defesa
 *     possível, o Evolution GO não assina nada) E o instanceToken do corpo tem que
 *     bater com o instance_token gravado na conexão. Sem os dois, 401 antes de
 *     tocar no banco.
 *  2. ENVELOPE. Não existem mais MESSAGES_UPSERT nem CONNECTION_UPDATE. Os eventos
 *     são discretos (Message, QRCode, Connected, PairSuccess, Disconnected,
 *     LoggedOut, ConnectFailure, TemporaryBan) e chegam normalizados por
 *     parseWebhook().
 *  3. EVENTOS DE CONEXÃO passam a atualizar status e qr_code da conexão — é assim
 *     que o front descobre que o pareamento deu certo.
 *  4. ÁUDIO é novo: com WEBHOOK_FILES=true o binário vem no próprio evento, vai
 *     para transcrever() e segue pelo mesmo caminho de uma mensagem escrita.
 *  5. DEDUPLICAÇÃO por escrita-primeiro: insere em whatsapp_processed_messages e
 *     trata a violação da PK. O original consultava antes de gravar — duas
 *     entregas simultâneas do mesmo evento passavam pelas duas.
 *  6. A RESPOSTA vai para quem escreveu (o chat de origem), não para o número do
 *     dono da instância. Com accept_messages_from='all' o original respondia para
 *     si mesmo.
 *
 * LIMITE CONHECIDO: mensagens que chegam numa instância de TENANT
 * (tenant_whatsapp_connections) só atualizam status — não há um único user_id a
 * quem atribuir a tarefa. O original também só atendia a instância pessoal.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { admin, ehConflito } from '../_shared/supabase.ts';
import { bytesParaDataUrl, dataUrlParaBytes, evolution, numeroDaInstancia, parseWebhook, soDigitos, type EventoConexao, type EventoMensagem, type EventoQrCode, webhookAutorizado } from '../_shared/evolution.ts';
import { transcrever } from '../_shared/ai.ts';
import { json, lerCorpo, preflight, respostaErro } from '../_shared/http.ts';
import { type Row } from './dados.ts';
import { processarComando } from './comandos.ts';
import { processarComIA } from './ia.ts';

const PESSOAL = 'whatsapp_connections';
const TENANT = 'tenant_whatsapp_connections';

/** Vocabulário de status combinado com o front (useWhatsApp.ts). */
const STATUS_POR_EVENTO: Record<string, string> = {
  Connected: 'connected', PairSuccess: 'connected',
  Disconnected: 'disconnected', LoggedOut: 'disconnected',
  ConnectFailure: 'disconnected', TemporaryBan: 'disconnected',
};

/** Acha a conexão pelo token (preferido) e, na falta, pelo nome da instância. */
async function resolverConexao({ instanceToken, instanceName }: { instanceToken?: string; instanceName?: string }): Promise<{ tabela: string; conn: Row } | null> {
  const db = admin();
  for (const tabela of [PESSOAL, TENANT]) {
    if (instanceToken) {
      const { data } = await db.from(tabela).select('*').eq('instance_token', instanceToken).maybeSingle();
      if (data) return { tabela, conn: data };
    }
    if (instanceName) {
      const { data } = await db.from(tabela).select('*').eq('instance_name', instanceName).maybeSingle();
      if (data) return { tabela, conn: data };
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();

  try {
    // O Evolution GO não assina o payload: o segredo na query é a primeira porta.
    if (!webhookAutorizado(req)) return json({ ok: false, error: 'não autorizado' }, 401);

    const ev = parseWebhook(await lerCorpo(req));
    console.log(`whatsapp-webhook: evento=${ev.evento} instancia=${ev.instanceName || '?'}`);

    const achado = await resolverConexao(ev);
    if (!achado) {
      console.log('whatsapp-webhook: nenhuma conexão corresponde à instância — ignorando');
      return json({ ok: true, ignored: 'instância desconhecida' });
    }
    const { tabela, conn } = achado;

    // Segunda porta: o token do corpo TEM que ser o da conexão que resolvemos.
    // Sem isso, saber o nome da instância bastaria para escrever no banco alheio.
    if (!ev.instanceToken || conn.instance_token !== ev.instanceToken) {
      console.error(`whatsapp-webhook: instanceToken não confere para ${ev.instanceName}`);
      return json({ ok: false, error: 'não autorizado' }, 401);
    }

    if (ev.tipo === 'conexao') return json(await tratarConexao(ev, tabela, conn));
    if (ev.tipo === 'qrcode') return json(await tratarQrCode(ev, tabela, conn));
    if (ev.tipo === 'mensagem') return json(await tratarMensagem(ev, tabela, conn));

    return json({ ok: true, ignored: ev.evento });
  } catch (e) {
    console.error('whatsapp-webhook:', e);
    return respostaErro(e);
  }
});

// ───────────────────────────────────────────────────────── eventos de conexão
async function tratarConexao(ev: EventoConexao, tabela: string, conn: Row) {
  const status = STATUS_POR_EVENTO[ev.evento] || 'disconnected';
  // qr_code some junto: um QR antigo na tela é pior do que nenhum.
  await admin().from(tabela).update({ status, qr_code: null }).eq('id', conn.id);
  console.log(`whatsapp-webhook: ${conn.instance_name} -> ${status} (${ev.evento})`);
  return { ok: true, status };
}

async function tratarQrCode(ev: EventoQrCode, tabela: string, conn: Row) {
  // O QR rotaciona; cada evento substitui o anterior e o front repinta.
  await admin().from(tabela).update({ status: 'qr_pending', qr_code: ev.qrcode || null }).eq('id', conn.id);
  console.log(`whatsapp-webhook: QR ${ev.contagem}/${ev.maximo} para ${conn.instance_name}`);
  return { ok: true, status: 'qr_pending' };
}

// ──────────────────────────────────────────────────────────────── mensagens
async function tratarMensagem(ev: EventoMensagem, tabela: string, conn: Row) {
  if (tabela === TENANT) return { ok: true, ignored: 'instância de tenant não atende mensagens' };
  // Grupo nunca: o assistente responderia a todo mundo o tempo todo.
  if (ev.deGrupo) return { ok: true, ignored: 'mensagem de grupo' };

  const temTexto = !!(ev.texto || '').trim();
  const midia = ev.midia?.tipo;
  const ehImagem = midia === 'imagem';
  const ehAudio = midia === 'audio';
  if (!temTexto && !ehImagem && !ehAudio) return { ok: true, ignored: 'sem conteúdo tratável' };

  const db = admin();

  // ── Deduplicação: grava PRIMEIRO e deixa a PK decidir quem processa.
  if (ev.mensagemId) {
    const { error } = await db.from('whatsapp_processed_messages').insert({
      message_id: ev.mensagemId,
      instance_name: conn.instance_name,
      processed_at: new Date().toISOString(),
    });
    if (error) {
      if (ehConflito(error)) {
        console.log(`whatsapp-webhook: mensagem ${ev.mensagemId} já processada`);
        return { ok: true, ignored: 'duplicada' };
      }
      throw error;
    }
  }

  // ── Quem pode falar com o assistente.
  const aceitaDe = conn.accept_messages_from || 'self_only';
  const meuNumero = soDigitos(conn.phone_number);
  if (aceitaDe === 'self_only') {
    // Só a conversa comigo mesmo: mensagem minha E no meu próprio chat.
    //
    // O WhatsApp está migrando para LID e entrega a MESMA conversa ora pelo
    // telefone (5511943246689), ora pelo identificador de privacidade
    // (108108688928998) — visto nos dois formatos no mesmo dia, no log. Comparar
    // só com o telefone gravado descartava metade das mensagens, sem nenhum
    // aviso para o usuário.
    //
    // Por isso a identidade do dono é um CONJUNTO: o telefone que conhecemos e
    // o remetente da própria mensagem. Numa conversa comigo mesmo o chat é o
    // próprio remetente, seja qual for o formato; falando com outra pessoa o
    // chat é ela, e a mensagem continua sendo recusada.
    const remetente = soDigitos(ev.remetente);
    const souEu = [meuNumero, remetente].filter(Boolean);
    const comigoMesmo = souEu.length === 0 || souEu.includes(ev.telefone);
    if (!ev.daMinhaConta || !comigoMesmo) {
      console.log(`whatsapp-webhook: ignorado (self_only) chat=${ev.telefone} eu=[${souEu.join(',')}]`);
      return { ok: true, ignored: 'self_only' };
    }
  }

  // NUNCA deduzir o número do dono a partir do `Sender` da mensagem: no
  // WhatsApp atual esse campo vem como LID (`<id>@lid`), um identificador de
  // privacidade que não é telefone. Era o que gravava lixo como
  // "108108688928998" no lugar de "5511943246689" — e, com o número errado,
  // o filtro self_only descartava TODAS as mensagens, inclusive as do próprio
  // aparelho pareado. O número certo vem do JID que o Evolution guarda.
  if (!conn.phone_number) {
    const numero = await numeroDaInstancia(conn.instance_name);
    if (numero) {
      await db.from(PESSOAL).update({ phone_number: numero }).eq('id', conn.id);
      conn.phone_number = numero;
    }
  }

  // ── Freio de 3s por instância: evita responder rajada de mensagens.
  if (await muitoRapido(conn.instance_name, ev.mensagemId)) {
    console.log('whatsapp-webhook: rajada, ignorando');
    return { ok: true, ignored: 'rate-limit' };
  }
  limparProcessadasAntigas().catch(() => {});

  const userId: string = conn.user_id;
  const tz: string = conn.timezone || 'America/Sao_Paulo';
  let texto = ev.texto || '';
  let resposta = '';
  const imagens: string[] = [];

  try {
    if (ehAudio) {
      const bytes = await bytesDaMidia(ev, conn);
      texto = await transcrever(bytes, { idioma: 'pt', mimeType: ev.midia?.mimetype || 'audio/ogg' });
      console.log(`whatsapp-webhook: áudio transcrito (${texto.length} caracteres)`);
    } else if (ehImagem) {
      imagens.push(await dataUrlDaImagem(ev, conn));
    }
  } catch (e) {
    const motivo = (e as Error).message || '';
    console.error(`whatsapp-webhook: mídia falhou: ${motivo}`);
    // "sem credencial" e "modelo inválido" são configuração do gateway, não um
    // problema do áudio que a pessoa gravou. Mandar "manda de novo" nesse caso
    // é jogar o usuário num laço: por mais que ele regrave, nunca vai funcionar.
    const transcricaoIndisponivel =
      /no credentials|invalid transcription model|HTTP 5\d\d/i.test(motivo);
    resposta = ehAudio
      ? transcricaoIndisponivel
        ? '⚠️ A transcrição de áudio não está disponível agora (o serviço de IA não respondeu). Me manda por escrito que eu registro na hora.'
        : '⚠️ Não consegui ouvir esse áudio. Pode mandar de novo ou escrever?'
      : '⚠️ Não consegui baixar a imagem do WhatsApp. Tente reenviar.';
  }

  if (!resposta) {
    resposta = texto.startsWith('/') && !imagens.length
      ? await processarComando(texto, userId)
      : await processarComIA({ texto, userId, imagens, tz });
  }

  // Responde no chat de origem (com self_only é o próprio número do dono).
  const destino = ev.telefone || conn.phone_number;
  if (resposta && destino) {
    await evolution.sendText(conn.instance_token, destino, resposta);
  }
  return { ok: true, replied: !!resposta };
}

/** Bytes da mídia: base64 do próprio evento (WEBHOOK_FILES) ou download. */
async function bytesDaMidia(ev: EventoMensagem, conn: Row): Promise<Uint8Array> {
  if (ev.base64) return dataUrlParaBytes(ev.base64);
  return evolution.downloadMedia(conn.instance_token, ev.mensagem);
}

async function dataUrlDaImagem(ev: EventoMensagem, conn: Row): Promise<string> {
  const mime = ev.midia?.mimetype || 'image/jpeg';
  // Com WEBHOOK_FILES o binário já vem como data-URL — nesse caso não há o que montar.
  if (ev.base64?.startsWith('data:')) return ev.base64;
  if (ev.base64) return `data:${mime};base64,${ev.base64}`;
  const bytes = await evolution.downloadMedia(conn.instance_token, ev.mensagem);
  return bytesParaDataUrl(bytes, mime);
}

async function muitoRapido(instanceName: string, mensagemId?: string): Promise<boolean> {
  const { data } = await admin()
    .from('whatsapp_processed_messages')
    .select('message_id, processed_at')
    .eq('instance_name', instanceName)
    .order('processed_at', { ascending: false })
    .limit(2);
  const anterior = (data ?? []).find((d: Row) => d.message_id !== mensagemId);
  if (!anterior?.processed_at) return false;
  return Date.now() - new Date(anterior.processed_at).getTime() < 3000;
}

/** A tabela de dedup só precisa das últimas 24h; o resto é lixo acumulando. */
async function limparProcessadasAntigas(): Promise<void> {
  const limite = new Date(Date.now() - 24 * 3600e3).toISOString();
  await admin().from('whatsapp_processed_messages').delete().lt('processed_at', limite);
}
