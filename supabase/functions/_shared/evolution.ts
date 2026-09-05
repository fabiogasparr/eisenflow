/**
 * Evolution GO (WhatsApp em Go/whatsmeow) — camada de acesso.
 *
 * ATENÇÃO: isto NÃO é a Evolution API v2 (Node/Baileys). As functions Deno
 * originais falavam v2 e nenhuma rota delas existe aqui. As três diferenças
 * que mudam o desenho do app:
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
 *   EVOLUTION_API_URL         ex.: https://evo-eisenflow.kz3solucoes.cloud
 *   EVOLUTION_API_KEY         GLOBAL_API_KEY do servidor (rotas administrativas)
 *   EVOLUTION_WEBHOOK_SECRET  segredo que viaja na query do webhook
 *   EVOLUTION_WEBHOOK_URL     (opcional) URL exata do whatsapp-webhook
 *   PUBLIC_FUNCTIONS_URL      base pública das functions, ex.:
 *                             https://supabase-eisenflow.kz3solucoes.cloud/functions/v1
 *
 * Referência: evolution-foundation/evolution-go 0.7.2 (routes.go, auth_middleware.go,
 * webhook_producer.go). Porte fiel de functions/_shared/evolution.js.
 */
import { base64Decode, bytesParaDataUrl } from './bytes.ts';
export { bytesParaDataUrl };
import { HttpError } from './http.ts';

const base = () => (Deno.env.get('EVOLUTION_API_URL') || '').replace(/\/+$/, '');
const globalKey = () => Deno.env.get('EVOLUTION_API_KEY') || '';

/** Eventos que o EisenFlow assina. Qualquer nome fora da lista de 16 é descartado em silêncio pelo servidor. */
export const EVENTOS = ['MESSAGE', 'CONNECTION', 'QRCODE'];

// deno-lint-ignore no-explicit-any
type Json = any;

export class EvolutionError extends HttpError {
  body: Json;
  constructor(message: string, status: number, body: Json) {
    super(message, status);
    this.body = body;
  }
}

async function call(method: string, path: string, body: Json | undefined, apikey: string): Promise<Json> {
  const BASE = base();
  if (!BASE) throw new HttpError('EVOLUTION_API_URL não configurada', 500);
  if (!apikey) throw new HttpError('apikey ausente na chamada à Evolution GO', 500);
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', apikey },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const txt = await res.text();
  let data: Json;
  try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }
  if (!res.ok) {
    let msg = data?.message || data?.error || `Evolution GO HTTP ${res.status}`;
    // 503 aqui quase sempre é licença não ativada no Manager, não instabilidade.
    if (res.status === 503) msg += ' — verifique se a licença foi ativada em /manager/login';
    // 502 para quem chamou: a falha é do serviço externo, não do nosso request.
    throw new EvolutionError(msg, res.status >= 500 ? 502 : res.status, data);
  }
  return data?.data ?? data; // o servidor envelopa tudo em {message:"success", data:...}
}

const adminCall = (method: string, path: string, body?: Json) => call(method, path, body, globalKey());

export interface InstanciaCriada { id: string; token: string; name?: string }
export interface InstanciaListada { id?: string; name?: string; token?: string; jid?: string; [k: string]: Json }
export interface StatusInstancia { Connected?: boolean; LoggedIn?: boolean; Name?: string }
export interface QrInstancia { Qrcode?: string; Code?: string }

export interface ConnectOpts {
  webhookUrl?: string;
  subscribe?: string[];
  immediate?: boolean;
  phone?: string;
}

export const evolution = {
  // ------------------------------------------------------------ administrativo
  /** Guarde os DOIS: id para deletar, token para tudo o mais. */
  createInstance: (name: string, token?: string): Promise<InstanciaCriada> =>
    adminCall('POST', '/instance/create', { name, ...(token ? { token } : {}) }),
  listInstances: (): Promise<InstanciaListada[]> => adminCall('GET', '/instance/all'),
  /** Deletar exige o UUID da instância (não o nome) e a chave global. */
  deleteInstance: (instanceId: string): Promise<Json> => adminCall('DELETE', `/instance/delete/${instanceId}`),

  // ------------------------------------------------------------- por instância
  /**
   * Conecta E registra o webhook — é a única forma de configurar webhook aqui.
   * `immediate:true` faz o servidor responder sem esperar o pareamento.
   */
  connect: (token: string, { webhookUrl, subscribe = EVENTOS, immediate = true, phone }: ConnectOpts = {}): Promise<Json> =>
    call('POST', '/instance/connect', {
      ...(webhookUrl ? { webhookUrl } : {}),
      subscribe, immediate, ...(phone ? { phone } : {}),
    }, token),

  /** Qrcode é data-URI PNG; o QR rotaciona (~60s o 1º, ~20s os demais). */
  qr: (token: string): Promise<QrInstancia> => call('GET', '/instance/qr', undefined, token),

  /** Pareamento por código de 8 dígitos, alternativa ao QR. */
  pair: (token: string, phone: string): Promise<{ PairingCode?: string }> =>
    call('POST', '/instance/pair', { phone, subscribe: EVENTOS }, token),

  /** PascalCase: é o struct Go. */
  status: (token: string): Promise<StatusInstancia> => call('GET', '/instance/status', undefined, token),

  disconnect: (token: string): Promise<Json> => call('POST', '/instance/disconnect', {}, token),
  reconnect: (token: string): Promise<Json> => call('POST', '/instance/reconnect', {}, token),
  /** Derruba a sessão do WhatsApp (o aparelho é despareado). A instância continua existindo. */
  logout: (token: string): Promise<Json> => call('DELETE', '/instance/logout', undefined, token),

  // ------------------------------------------------------------------ mensagens
  sendText: (token: string, number: string | number, text: string, opts: Record<string, Json> = {}): Promise<Json> =>
    call('POST', '/send/text', { number: String(number), text, ...opts }, token),

  /** type: image|video|ptv|audio|document. `url` aceita http(s) OU base64 puro. */
  sendMedia: (token: string, { number, type, url, caption, filename }: { number: string; type: string; url: string; caption?: string; filename?: string }): Promise<Json> =>
    call('POST', '/send/media', { number: String(number), type, url, ...(caption ? { caption } : {}), ...(filename ? { filename } : {}) }, token),

  /**
   * Baixa e descriptografa a mídia de uma mensagem recebida.
   * `message` é o objeto `data.Message` INTEIRO que veio no webhook.
   * @returns bytes já decodificados.
   */
  async downloadMedia(token: string, message: Json): Promise<Uint8Array> {
    const r = await call('POST', '/message/downloadmedia', { message }, token);
    return dataUrlParaBytes(r?.base64 || '');
  },
};

/**
 * Garante que temos o par (token, id) de uma instância com esse nome.
 * Ordem: o que já está gravado na conexão -> criar -> recuperar pela listagem
 * administrativa. O terceiro caso cobre a instância que existe no servidor mas
 * cujo token se perdeu no banco: `/instance/create` recusa o nome duplicado e
 * `/instance/all` é o único jeito de reaver o token.
 * Usado por whatsapp-connect e tenant-whatsapp-connect.
 */
export async function garantirInstancia(
  nome: string,
  conn: { instance_token?: string | null; instance_id?: string | null } | null,
  rotulo = 'evolution',
): Promise<{ token: string; id: string | null }> {
  if (conn?.instance_token) return { token: conn.instance_token, id: conn.instance_id || null };

  try {
    const nova = await evolution.createInstance(nome);
    console.log(`${rotulo}: instância ${nome} criada (${nova.id})`);
    return { token: nova.token, id: nova.id };
  } catch (e) {
    const existentes = await evolution.listInstances().catch(() => [] as InstanciaListada[]);
    const achada = (Array.isArray(existentes) ? existentes : []).find((i) => i?.name === nome);
    if (!achada?.token) throw e;
    console.log(`${rotulo}: instância ${nome} já existia, token recuperado da listagem`);
    return { token: achada.token, id: achada.id || null };
  }
}

/**
 * O servidor devolve `data:audio/ogg; codecs=opus;base64,AAA...` — data-URL, não
 * base64 puro. Cortar até a PRIMEIRA vírgula não basta quando o mime tem vírgula
 * (`codecs=opus` não tem, mas `; codecs="opus, vorbis"` teria): corta na última
 * ocorrência de ';base64,'.
 */
export function dataUrlParaBytes(s: string): Uint8Array {
  if (!s) throw new Error('mídia vazia');
  const i = s.lastIndexOf(';base64,');
  const b64 = i >= 0 ? s.slice(i + 8) : (s.startsWith('data:') ? s.slice(s.indexOf(',') + 1) : s);
  return base64Decode(b64);
}

/**
 * URL do webhook com o segredo na query. É a única autenticação possível:
 * o Evolution GO não assina o payload.
 *
 * EVOLUTION_WEBHOOK_URL, quando definida, vence (endereço exato do
 * whatsapp-webhook — útil atrás de proxy). Senão monta
 * PUBLIC_FUNCTIONS_URL + /whatsapp-webhook, que é o padrão do self-hosted
 * (Kong publica as functions em <SUPABASE_URL>/functions/v1/<nome>).
 */
export function webhookUrl(): string {
  const segredo = Deno.env.get('EVOLUTION_WEBHOOK_SECRET') || '';
  if (!segredo) throw new HttpError('EVOLUTION_WEBHOOK_SECRET não configurada', 500);

  const direta = (Deno.env.get('EVOLUTION_WEBHOOK_URL') || '').replace(/\/+$/, '');
  if (direta) return `${direta}?secret=${encodeURIComponent(segredo)}`;

  const base = (Deno.env.get('PUBLIC_FUNCTIONS_URL') || '').replace(/\/+$/, '');
  if (!base) throw new HttpError('defina EVOLUTION_WEBHOOK_URL (ou PUBLIC_FUNCTIONS_URL)', 500);
  return `${base}/whatsapp-webhook?secret=${encodeURIComponent(segredo)}`;
}

/** Confere o segredo da query. Chame ANTES de olhar o corpo do webhook. */
export function webhookAutorizado(req: Request): boolean {
  const segredo = Deno.env.get('EVOLUTION_WEBHOOK_SECRET') || '';
  if (!segredo) return false;
  const q = new URL(req.url).searchParams;
  return q.get('secret') === segredo || req.headers.get('x-webhook-secret') === segredo;
}

// ------------------------------------------------------------------ webhook
export interface MidiaInfo { chave: string; tipo: string; mimetype?: string }

interface EventoBase {
  evento: string;
  instanceId?: string;
  instanceToken?: string;
  instanceName?: string;
  bruto: Json;
}
export interface EventoMensagem extends EventoBase {
  tipo: 'mensagem';
  mensagemId?: string;
  chat?: string;
  telefone: string;
  remetente?: string;
  daMinhaConta: boolean;
  deGrupo: boolean;
  nome?: string;
  quando?: Json;
  texto: string;
  midia: MidiaInfo | null;
  base64: string | null;
  mediaUrl: string | null;
  mensagem: Json;
}
export interface EventoConexao extends EventoBase {
  tipo: 'conexao';
  conectado: boolean;
  motivo: string | null;
}
export interface EventoQrCode extends EventoBase {
  tipo: 'qrcode';
  qrcode?: string;
  code?: string;
  contagem?: number;
  maximo?: number;
}
export interface EventoOutro extends EventoBase { tipo: 'outro' }
export type EventoWebhook = EventoMensagem | EventoConexao | EventoQrCode | EventoOutro;

const EVENTOS_CONEXAO = ['Connected', 'PairSuccess', 'Disconnected', 'LoggedOut', 'ConnectFailure', 'TemporaryBan'];

/**
 * Normaliza o envelope do webhook para uma forma estável, para o resto do código
 * não depender do PascalCase do struct Go nem de onde cada campo mora.
 *
 * Envelope real: { event, data, instanceId, instanceToken, instanceName }
 * (a doc oficial diz `{event, instance, data}` — está errada).
 */
export function parseWebhook(payload: Json): EventoWebhook {
  const evento: string = payload?.event || '';
  const d = payload?.data || {};
  const base: EventoBase = {
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
  if (EVENTOS_CONEXAO.includes(evento)) {
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

const MIDIAS: Record<string, string> = {
  audioMessage: 'audio', imageMessage: 'imagem', videoMessage: 'video',
  documentMessage: 'documento', stickerMessage: 'sticker', ptvMessage: 'video',
};
function tipoDeMidia(msg: Json): MidiaInfo | null {
  for (const k of Object.keys(MIDIAS)) if (msg?.[k]) return { chave: k, tipo: MIDIAS[k], mimetype: msg[k].mimetype };
  return null;
}

/** Extrai só os dígitos de um JID (`5511...@s.whatsapp.net` -> `5511...`). */
export function soDigitos(jid: unknown): string {
  return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

/** Normaliza um telefone brasileiro para E.164 sem '+', que é o que gravamos no banco. */
export function normalize(phone: unknown): string {
  const d = String(phone || '').replace(/\D/g, '');
  return d.startsWith('55') ? d : `55${d}`;
}
