/**
 * whatsapp-webhook
 * ──────────────────────────────────────────────────────────────────────
 * O cérebro do assistente por WhatsApp: recebe o evento da Evolution GO,
 * deduplica, identifica o usuário pela instância, transcreve áudio, lê imagem,
 * conversa com a IA por function calling e cria/edita tarefas.
 *
 * Origem: supabase/functions/whatsapp-webhook/index.ts (Deno, 1389 linhas)
 * Destino: Appwrite Function, runtime node-20
 * Status: PORTADA (lógica completa, dividida em src/dados.js, src/ia.js, src/comandos.js)
 *
 * Gatilho .......... http (webhook externo, execute: any)
 * Autenticação ..... segredo na query (EVOLUTION_WEBHOOK_SECRET) + conferência
 *                    do instanceToken contra a conexão gravada
 * Entrada .......... { event, data, instanceId, instanceToken, instanceName }
 * Saída ............ { ok:true, ... } sempre 200 — a resposta real volta pelo WhatsApp
 * Lê ............... whatsapp_connections, tenant_whatsapp_connections, tasks,
 *                    team_members, teams, profiles, whatsapp_chat_history,
 *                    task_reminders, gamification, productivity_metrics
 * Escreve .......... tasks, task_reminders, delegations, whatsapp_chat_history,
 *                    whatsapp_processed_messages, whatsapp_connections,
 *                    tenant_whatsapp_connections
 * APIs externas .... Evolution GO, IA (_shared/ai.js -> OmniRoute)
 * Variáveis ........ EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_WEBHOOK_SECRET,
 *                    AI_API_KEY, APPWRITE_API_KEY
 *
 * MUDANÇAS EM RELAÇÃO AO ORIGINAL:
 *  1. SEGURANÇA. O original aceitava qualquer POST — quem tivesse a URL escrevia
 *     no banco em nome de qualquer usuário. Agora: segredo na query (única defesa
 *     possível, a Evolution GO não assina nada) E o instanceToken do corpo tem que
 *     bater com o instance_token gravado na conexão. Sem os dois, 401 antes de
 *     tocar no banco.
 *  2. ENVELOPE. Não existem mais MESSAGES_UPSERT nem CONNECTION_UPDATE. Os eventos
 *     são discretos (Message, QRCode, Connected, PairSuccess, Disconnected,
 *     LoggedOut, ConnectFailure, TemporaryBan) e chegam normalizados por
 *     parseWebhook().
 *  3. EVENTOS DE CONEXÃO passam a atualizar status e qr_code da conexão — é assim
 *     que o front descobre que o pareamento deu certo (o original só reagia a
 *     CONNECTION_UPDATE e nunca gravava o QR).
 *  4. ÁUDIO é novo: com WEBHOOK_FILES=true o binário vem no próprio evento, vai
 *     para transcrever() e segue pelo mesmo caminho de uma mensagem escrita.
 *  5. DEDUPLICAÇÃO por escrita-primeiro: tenta criar em whatsapp_processed_messages
 *     e trata o 409 do índice único. O original consultava antes de gravar — duas
 *     entregas simultâneas do mesmo evento passavam pelas duas.
 *  6. A RESPOSTA vai para quem escreveu (o chat de origem), não para o número do
 *     dono da instância. Com accept_messages_from='all' o original respondia para
 *     si mesmo.
 *
 * LIMITE CONHECIDO: mensagens que chegam numa instância de TENANT
 * (tenant_whatsapp_connections) só atualizam status — não há um único user_id a
 * quem atribuir a tarefa. O original também só atendia a instância pessoal.
 */
import { db, Query } from '../_shared/appwrite.js';
import { evolution, parseWebhook, webhookAutorizado, dataUrlParaBuffer, soDigitos } from '../_shared/evolution.js';
import { transcrever } from '../_shared/ai.js';
import { body, err } from '../_shared/http.js';
import { criarCru, ehConflito } from './dados.js';
import { processarComando } from './comandos.js';
import { processarComIA } from './ia.js';

const PESSOAL = 'whatsapp_connections';
const TENANT = 'tenant_whatsapp_connections';

/** Vocabulário de status combinado com o front (useWhatsApp.ts). */
const STATUS_POR_EVENTO = {
  Connected: 'connected', PairSuccess: 'connected',
  Disconnected: 'disconnected', LoggedOut: 'disconnected',
  ConnectFailure: 'disconnected', TemporaryBan: 'disconnected',
};

/** Acha a conexão pelo token (preferido) e, na falta, pelo nome da instância. */
async function resolverConexao({ instanceToken, instanceName }) {
  for (const collection of [PESSOAL, TENANT]) {
    if (instanceToken) {
      const porToken = await db.findOne(collection, [Query.equal('instance_token', instanceToken)]);
      if (porToken) return { collection, conn: porToken };
    }
    if (instanceName) {
      const porNome = await db.findOne(collection, [Query.equal('instance_name', instanceName)]);
      if (porNome) return { collection, conn: porNome };
    }
  }
  return null;
}

export default async ({ req, res, log, error }) => {
  try {
    // A Evolution GO não assina o payload: o segredo na query é a primeira porta.
    if (!webhookAutorizado(req)) {
      return res.json({ ok: false, error: 'não autorizado' }, 401);
    }

    const ev = parseWebhook(body(req));
    log(`whatsapp-webhook: evento=${ev.evento} instancia=${ev.instanceName || '?'}`);

    const achado = await resolverConexao(ev);
    if (!achado) {
      log('whatsapp-webhook: nenhuma conexão corresponde à instância — ignorando');
      return res.json({ ok: true, ignored: 'instância desconhecida' });
    }
    const { collection, conn } = achado;

    // Segunda porta: o token do corpo TEM que ser o da conexão que resolvemos.
    // Sem isso, saber o nome da instância bastaria para escrever no banco alheio.
    if (!ev.instanceToken || conn.instance_token !== ev.instanceToken) {
      error(`whatsapp-webhook: instanceToken não confere para ${ev.instanceName}`);
      return res.json({ ok: false, error: 'não autorizado' }, 401);
    }

    if (ev.tipo === 'conexao') return res.json(await tratarConexao(ev, collection, conn, log));
    if (ev.tipo === 'qrcode') return res.json(await tratarQrCode(ev, collection, conn, log));
    if (ev.tipo === 'mensagem') return res.json(await tratarMensagem(ev, collection, conn, log, error));

    return res.json({ ok: true, ignored: ev.evento });
  } catch (e) {
    error(`whatsapp-webhook: ${e.message}`);
    return err(res, e);
  }
};

// ───────────────────────────────────────────────────────── eventos de conexão
async function tratarConexao(ev, collection, conn, log) {
  const status = STATUS_POR_EVENTO[ev.evento] || 'disconnected';
  // qr_code some junto: um QR antigo na tela é pior do que nenhum.
  await db.update(collection, conn.$id, { status, qr_code: null });
  log(`whatsapp-webhook: ${conn.instance_name} -> ${status} (${ev.evento})`);
  return { ok: true, status };
}

async function tratarQrCode(ev, collection, conn, log) {
  // O QR rotaciona; cada evento substitui o anterior e o front repinta.
  await db.update(collection, conn.$id, { status: 'qr_pending', qr_code: ev.qrcode || null });
  log(`whatsapp-webhook: QR ${ev.contagem}/${ev.maximo} para ${conn.instance_name}`);
  return { ok: true, status: 'qr_pending' };
}

// ──────────────────────────────────────────────────────────────── mensagens
async function tratarMensagem(ev, collection, conn, log, error) {
  if (collection === TENANT) {
    return { ok: true, ignored: 'instância de tenant não atende mensagens' };
  }
  // Grupo nunca: o assistente responderia a todo mundo o tempo todo.
  if (ev.deGrupo) return { ok: true, ignored: 'mensagem de grupo' };

  const temTexto = !!(ev.texto || '').trim();
  const midia = ev.midia?.tipo;
  const ehImagem = midia === 'imagem';
  const ehAudio = midia === 'audio';
  if (!temTexto && !ehImagem && !ehAudio) return { ok: true, ignored: 'sem conteúdo tratável' };

  // ── Deduplicação: grava PRIMEIRO e deixa o índice único decidir quem processa.
  if (ev.mensagemId) {
    try {
      await criarCru('whatsapp_processed_messages', {
        message_id: ev.mensagemId,
        instance_name: conn.instance_name,
        processed_at: new Date().toISOString(),
      });
    } catch (e) {
      if (ehConflito(e)) {
        log(`whatsapp-webhook: mensagem ${ev.mensagemId} já processada`);
        return { ok: true, ignored: 'duplicada' };
      }
      throw e;
    }
  }

  // ── Quem pode falar com o assistente.
  const aceitaDe = conn.accept_messages_from || 'self_only';
  const meuNumero = soDigitos(conn.phone_number);
  if (aceitaDe === 'self_only') {
    // Só a conversa comigo mesmo: mensagem minha E no meu próprio chat.
    if (!ev.daMinhaConta || (meuNumero && ev.telefone !== meuNumero)) {
      log(`whatsapp-webhook: ignorado (self_only) de=${ev.telefone}`);
      return { ok: true, ignored: 'self_only' };
    }
  }

  // A Evolution GO não expõe o dono da instância; a primeira mensagem própria
  // revela o número e a gente aproveita para preencher o cadastro.
  if (!conn.phone_number && ev.daMinhaConta && ev.remetente) {
    const numero = soDigitos(ev.remetente);
    if (numero) {
      await db.update(PESSOAL, conn.$id, { phone_number: numero }).catch(() => {});
      conn.phone_number = numero;
    }
  }

  // ── Freio de 3s por instância: evita responder rajada de mensagens.
  if (await muitoRapido(conn.instance_name, ev.mensagemId)) {
    log('whatsapp-webhook: rajada, ignorando');
    return { ok: true, ignored: 'rate-limit' };
  }
  limparProcessadasAntigas().catch(() => {});

  const userId = conn.user_id;
  const tz = conn.timezone || 'America/Sao_Paulo';
  let texto = ev.texto || '';
  let resposta = '';
  const imagens = [];

  try {
    if (ehAudio) {
      const buffer = await bytesDaMidia(ev, conn);
      texto = await transcrever(buffer, { idioma: 'pt', mimeType: ev.midia.mimetype || 'audio/ogg' });
      log(`whatsapp-webhook: áudio transcrito (${texto.length} caracteres)`);
    } else if (ehImagem) {
      imagens.push(await dataUrlDaImagem(ev, conn));
    }
  } catch (e) {
    error(`whatsapp-webhook: mídia falhou: ${e.message}`);
    resposta = ehAudio
      ? '⚠️ Não consegui ouvir esse áudio. Pode mandar de novo ou escrever?'
      : '⚠️ Não consegui baixar a imagem do WhatsApp. Tente reenviar.';
  }

  if (!resposta) {
    resposta = texto.startsWith('/') && !imagens.length
      ? await processarComando(texto, userId, log)
      : await processarComIA({ texto, userId, imagens, tz, log });
  }

  // Responde no chat de origem (com self_only é o próprio número do dono).
  const destino = ev.telefone || conn.phone_number;
  if (resposta && destino) {
    await evolution.sendText(conn.instance_token, destino, resposta);
  }
  return { ok: true, replied: !!resposta };
}

/** Bytes da mídia: base64 do próprio evento (WEBHOOK_FILES) ou download. */
async function bytesDaMidia(ev, conn) {
  if (ev.base64) return dataUrlParaBuffer(ev.base64);
  return evolution.downloadMedia(conn.instance_token, ev.mensagem);
}

async function dataUrlDaImagem(ev, conn) {
  const mime = ev.midia?.mimetype || 'image/jpeg';
  // Com WEBHOOK_FILES o binário já vem como data-URL — nesse caso não há o que montar.
  if (ev.base64?.startsWith('data:')) return ev.base64;
  if (ev.base64) return `data:${mime};base64,${ev.base64}`;
  const buffer = await evolution.downloadMedia(conn.instance_token, ev.mensagem);
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

async function muitoRapido(instanceName, mensagemId) {
  const r = await db.list('whatsapp_processed_messages', [
    Query.equal('instance_name', instanceName), Query.orderDesc('processed_at'), Query.limit(2),
  ]);
  const anterior = (r.documents || []).find((d) => d.message_id !== mensagemId);
  if (!anterior?.processed_at) return false;
  return Date.now() - new Date(anterior.processed_at).getTime() < 3000;
}

/** A tabela de dedup só precisa das últimas 24h; o resto é lixo acumulando. */
async function limparProcessadasAntigas() {
  const limite = new Date(Date.now() - 24 * 3600e3).toISOString();
  const r = await db.list('whatsapp_processed_messages', [
    Query.lessThan('processed_at', limite), Query.limit(50),
  ]);
  for (const doc of r.documents || []) {
    await db.delete('whatsapp_processed_messages', doc.$id).catch(() => {});
  }
}
