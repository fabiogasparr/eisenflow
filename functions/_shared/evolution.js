/**
 * Evolution GO (WhatsApp em Go/whatsmeow) — camada de acesso.
 *
 * ATENÇÃO: isto NÃO é a Evolution API v2 (Node/Baileys). O código anterior deste
 * arquivo falava v2 e nenhuma rota dele existe aqui. As três diferenças que
 * mudam o desenho do app:
 *
 *  1. NÃO EXISTE `{instance}` NO CAMINHO. A instância é derivada da API key
 *     enviada: cada instância tem um TOKEN próprio, e é ele que vai no header
 *     `apikey` das rotas de envio/status/QR. A GLOBAL_API_KEY só serve para
 *     criar, listar e deletar instância — ela NÃO envia mensagem.
 *     Consequência: o token da instância precisa ser persistido junto da
 *     conexão (whatsapp_connections.instance_token / tenant_whatsapp_connections).
 *  2. NÃO EXISTE ROTA DE WEBHOOK. O webhook é declarado em POST /instance/connect.
 *  3. NÃO EXISTE ASSINATURA DE WEBHOOK — nem HMAC, nem header, nada. A defesa é
 *     segredo na query string da URL do webhook + conferir o instanceToken do corpo.
 *
 * Env:
 *   EVOLUTION_API_URL       ex.: https://evo-eisenflow.kz3solucoes.cloud
 *   EVOLUTION_API_KEY       GLOBAL_API_KEY do servidor (rotas administrativas)
 *   EVOLUTION_WEBHOOK_SECRET  segredo que viaja na query do webhook
 *   PUBLIC_WEBHOOK_BASE_URL   base pública das functions
 *
 * Referência: evolution-foundation/evolution-go 0.7.2 (routes.go, auth_middleware.go,
 * webhook_producer.go). O README do projeto documenta rotas da v2 que não existem.
 */
const BASE = (process.env.EVOLUTION_API_URL || '').replace(/\/+$/, '');
const GLOBAL_KEY = process.env.EVOLUTION_API_KEY || '';

/** Eventos que o EisenFlow assina. Qualquer nome fora da lista de 16 é descartado em silêncio pelo servidor. */
export const EVENTOS = ['MESSAGE', 'CONNECTION', 'QRCODE'];

async function call(method, path, body, apikey) {
  if (!BASE) throw new Error('EVOLUTION_API_URL não configurada');
  if (!apikey) throw new Error('apikey ausente na chamada à Evolution GO');
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', apikey },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const txt = await res.text();
  let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }
  if (!res.ok) {
    const e = new Error(data?.message || data?.error || `Evolution GO HTTP ${res.status}`);
    e.status = res.status; e.body = data;
    // 503 aqui quase sempre é licença não ativada no Manager, não instabilidade.
    if (res.status === 503) e.message += ' — verifique se a licença foi ativada em /manager/login';
    throw e;
  }
  return data?.data ?? data; // o servidor envelopa tudo em {message:"success", data:...}
}

const admin = (method, path, body) => call(method, path, body, GLOBAL_KEY);

export const evolution = {
  // ------------------------------------------------------------ administrativo
  /** @returns {Promise<{id:string, token:string}>} guarde os DOIS: id para deletar, token para tudo o mais. */
  createInstance: (name, token) => admin('POST', '/instance/create', { name, ...(token ? { token } : {}) }),
  listInstances: () => admin('GET', '/instance/all'),
  /** Deletar exige o UUID da instância (não o nome) e a chave global. */
  deleteInstance: (instanceId) => admin('DELETE', `/instance/delete/${instanceId}`),

  // ------------------------------------------------------------- por instância
  /**
   * Conecta E registra o webhook — é a única forma de configurar webhook aqui.
   * `immediate:true` faz o servidor responder sem esperar o pareamento.
   */
  connect: (token, { webhookUrl, subscribe = EVENTOS, immediate = true, phone } = {}) =>
    call('POST', '/instance/connect', {
      ...(webhookUrl ? { webhookUrl } : {}),
      subscribe, immediate, ...(phone ? { phone } : {}),
    }, token),

  /** @returns {Promise<{Qrcode:string, Code:string}>} Qrcode é data-URI PNG; o QR rotaciona (~60s o 1º, ~20s os demais). */
  qr: (token) => call('GET', '/instance/qr', undefined, token),

  /** Pareamento por código de 8 dígitos, alternativa ao QR. */
  pair: (token, phone) => call('POST', '/instance/pair', { phone, subscribe: EVENTOS }, token),

  /** @returns {Promise<{Connected:boolean, LoggedIn:boolean, Name:string}>} PascalCase, é o struct Go. */
  status: (token) => call('GET', '/instance/status', undefined, token),

  disconnect: (token) => call('POST', '/instance/disconnect', {}, token),
  reconnect: (token) => call('POST', '/instance/reconnect', {}, token),
  /** Derruba a sessão do WhatsApp (o aparelho é despareado). A instância continua existindo. */
  logout: (token) => call('DELETE', '/instance/logout', undefined, token),

  // ------------------------------------------------------------------ mensagens
  sendText: (token, number, text, opts = {}) =>
    call('POST', '/send/text', { number: String(number), text, ...opts }, token),

  /** type: image|video|ptv|audio|document. `url` aceita http(s) OU base64 puro. */
  sendMedia: (token, { number, type, url, caption, filename }) =>
    call('POST', '/send/media', { number: String(number), type, url, ...(caption ? { caption } : {}), ...(filename ? { filename } : {}) }, token),

  /**
   * Baixa e descriptografa a mídia de uma mensagem recebida.
   * `message` é o objeto `data.Message` INTEIRO que veio no webhook.
   * @returns {Promise<Buffer>} bytes já decodificados.
   */
  async downloadMedia(token, message) {
    const r = await call('POST', '/message/downloadmedia', { message }, token);
    return dataUrlParaBuffer(r?.base64 || '');
  },
};

/**
 * O servidor devolve `data:audio/ogg; codecs=opus;base64,AAA...` — data-URL, não
 * base64 puro. Cortar até a PRIMEIRA vírgula não basta quando o mime tem vírgula
 * (`codecs=opus` não tem, mas `; codecs="opus, vorbis"` teria): corta na última
 * ocorrência de ';base64,'.
 */
export function dataUrlParaBuffer(s) {
  if (!s) throw new Error('mídia vazia');
  const i = s.lastIndexOf(';base64,');
  const b64 = i >= 0 ? s.slice(i + 8) : (s.startsWith('data:') ? s.slice(s.indexOf(',') + 1) : s);
  return Buffer.from(b64, 'base64');
}

/**
 * URL do webhook com o segredo na query. É a única autenticação possível:
 * o Evolution GO não assina o payload.
 *
 * No Appwrite self-hosted cada function ganha um domínio PRÓPRIO sob
 * _APP_DOMAIN_FUNCTIONS (algo como <id>.functions.appwrite.seu-dominio) — não
 * existe uma base comum com o nome da function no caminho. Por isso
 * EVOLUTION_WEBHOOK_URL, quando definida, vence: é o endereço exato do
 * whatsapp-webhook. PUBLIC_WEBHOOK_BASE_URL + /whatsapp-webhook fica como
 * alternativa para quem publica as functions atrás de um proxy próprio.
 */
export function webhookUrl() {
  const segredo = process.env.EVOLUTION_WEBHOOK_SECRET || '';
  if (!segredo) throw new Error('EVOLUTION_WEBHOOK_SECRET não configurada');

  const direta = (process.env.EVOLUTION_WEBHOOK_URL || '').replace(/\/+$/, '');
  if (direta) return `${direta}?secret=${encodeURIComponent(segredo)}`;

  const base = (process.env.PUBLIC_WEBHOOK_BASE_URL || '').replace(/\/+$/, '');
  if (!base) throw new Error('defina EVOLUTION_WEBHOOK_URL (ou PUBLIC_WEBHOOK_BASE_URL)');
  return `${base}/whatsapp-webhook?secret=${encodeURIComponent(segredo)}`;
}

/** Confere o segredo da query. Chame ANTES de olhar o corpo do webhook. */
export function webhookAutorizado(req) {
  const segredo = process.env.EVOLUTION_WEBHOOK_SECRET || '';
  if (!segredo) return false;
  const q = req.query || {};
  return q.secret === segredo || req.headers?.['x-webhook-secret'] === segredo;
}

/**
 * Normaliza o envelope do webhook para uma forma estável, para o resto do código
 * não depender do PascalCase do struct Go nem de onde cada campo mora.
 *
 * Envelope real: { event, data, instanceId, instanceToken, instanceName }
 * (a doc oficial diz `{event, instance, data}` — está errada).
 */
export function parseWebhook(payload) {
  const evento = payload?.event || '';
  const d = payload?.data || {};
  const base = {
    evento,
    instanceId: payload?.instanceId,
    instanceToken: payload?.instanceToken,
    instanceName: payload?.instanceName,
    bruto: payload,
  };

  if (evento === 'Message') {
    const info = d.Info || {};
    const msg = d.Message || {};
    return {
      ...base, tipo: 'mensagem',
      mensagemId: info.ID,
      chat: info.Chat,                       // ex.: 5511999999999@s.whatsapp.net
      telefone: soDigitos(info.Chat),
      remetente: info.Sender,
      daMinhaConta: !!info.IsFromMe,
      deGrupo: !!info.IsGroup,
      nome: info.PushName,
      quando: info.Timestamp,
      texto: msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.videoMessage?.caption || '',
      // Não existe campo `messageType`: o tipo é a chave presente em Message.
      midia: tipoDeMidia(msg),
      // Com WEBHOOK_FILES=true e MinIO desligado, o binário já vem aqui — sem round-trip.
      base64: msg.base64 || null,
      mediaUrl: msg.mediaUrl || null,
      mensagem: msg,                          // objeto inteiro, exigido por downloadMedia
    };
  }

  // A categoria CONNECTION emite eventos discretos; não existe CONNECTION_UPDATE.
  if (['Connected', 'PairSuccess', 'Disconnected', 'LoggedOut', 'ConnectFailure', 'TemporaryBan'].includes(evento)) {
    return {
      ...base, tipo: 'conexao',
      conectado: evento === 'Connected' || evento === 'PairSuccess',
      motivo: d.reason || null,
    };
  }

  if (evento === 'QRCode') {
    return { ...base, tipo: 'qrcode', qrcode: d.qrcode, code: d.code, contagem: d.count, maximo: d.maxCount };
  }

  return { ...base, tipo: 'outro' };
}

const MIDIAS = {
  audioMessage: 'audio', imageMessage: 'imagem', videoMessage: 'video',
  documentMessage: 'documento', stickerMessage: 'sticker', ptvMessage: 'video',
};
function tipoDeMidia(msg) {
  for (const k of Object.keys(MIDIAS)) if (msg?.[k]) return { chave: k, tipo: MIDIAS[k], mimetype: msg[k].mimetype };
  return null;
}

/** Extrai só os dígitos de um JID (`5511...@s.whatsapp.net` -> `5511...`). */
export function soDigitos(jid) {
  return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

/** Normaliza um telefone brasileiro para E.164 sem '+', que é o que gravamos no banco. */
export function normalize(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d.startsWith('55') ? d : `55${d}`;
}
