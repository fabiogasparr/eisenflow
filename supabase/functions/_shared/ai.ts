/**
 * Provider de IA — SUBSTITUI o Lovable AI Gateway.
 *
 * O gateway da Lovable (`ai.gateway.lovable.dev`, `LOVABLE_API_KEY`) é
 * proprietário e some quando o backend sai da Lovable. Este módulo mantém o
 * MESMO contrato que as Edge Functions usavam (mensagens estilo OpenAI +
 * tools/function-calling) e aponta, por padrão, para o OmniRoute
 * self-hospedado (https://omniroute.kz3solucoes.cloud/v1), que fala o
 * protocolo OpenAI. Trocar de modelo passa a ser mudar AI_MODEL_* — sem tocar
 * em código. Porte fiel de functions/_shared/ai.js.
 *
 * Env:
 *   AI_BASE_URL   default https://omniroute.kz3solucoes.cloud/v1
 *   AI_API_KEY    a chave do OmniRoute
 *   AI_PROVIDER   (opcional) omniroute (padrão) | openai | anthropic | google | openai-compat
 *   AI_MODEL_CLASSIFICAR, AI_MODEL_CONVERSAR, AI_MODEL_VISAO,
 *   AI_MODEL_JULGAR, AI_MODEL_TRANSCREVER   (opcionais, ver MODELOS)
 */
import { HttpError } from './http.ts';

const DEFAULT_OMNIROUTE = 'https://omniroute.kz3solucoes.cloud/v1';

const PROVIDER = Deno.env.get('AI_PROVIDER') || 'omniroute';
const KEY = Deno.env.get('AI_API_KEY') || '';
const BASE = (Deno.env.get('AI_BASE_URL') || (PROVIDER === 'omniroute' ? DEFAULT_OMNIROUTE : '')).replace(/\/+$/, '');

// deno-lint-ignore no-explicit-any
type Json = any;

export type Proposito = 'classificar' | 'conversar' | 'visao' | 'julgar' | 'transcrever';

/**
 * MODELO POR FINALIDADE, NÃO POR FUNCTION.
 *
 * O OmniRoute expõe aliases `auto/*` que escolhem o provedor e fazem failover
 * sozinhos — é o que interessa aqui, porque o custo/disponibilidade muda e o
 * código não deveria mudar junto.
 *
 *   classificar  chamada curta e frequente (toda tarefa criada). Precisa de
 *                tool_calling e latência baixa -> auto/fast
 *   conversar    o Chat IA cria tarefas via function calling e mantém contexto;
 *                aqui a qualidade da resposta é o produto -> auto/best-chat
 *   visao        OCR e leitura de imagem (anexo de tarefa e foto no WhatsApp)
 *                -> auto/best-vision
 *   julgar       reavaliação de prazos roda em lote, no cron, sem ninguém
 *                esperando: qualidade acima de latência -> auto/reasoning
 *   transcrever  áudio do WhatsApp -> texto, pelo endpoint /audio/transcriptions
 *                com Whisper -> whisper-large-v3-turbo
 */
export const MODELOS: Record<Proposito, string> = {
  classificar: Deno.env.get('AI_MODEL_CLASSIFICAR') || 'auto/fast',
  conversar: Deno.env.get('AI_MODEL_CONVERSAR') || 'auto/best-chat',
  visao: Deno.env.get('AI_MODEL_VISAO') || 'auto/best-vision',
  julgar: Deno.env.get('AI_MODEL_JULGAR') || 'auto/reasoning',
  transcrever: Deno.env.get('AI_MODEL_TRANSCREVER') || 'huggingface/openai/whisper-large-v3-turbo',
};

/** Fora do OmniRoute os aliases `auto/*` não existem — cai para um modelo real. */
function modeloPara(proposito: Proposito): string {
  const m = MODELOS[proposito] || MODELOS.conversar;
  if (PROVIDER === 'omniroute' || PROVIDER === 'openai-compat') return m;
  const fixos: Record<string, string> = { openai: 'gpt-4o-mini', anthropic: 'claude-sonnet-4-5', google: 'gemini-2.0-flash' };
  return fixos[PROVIDER] || 'gpt-4o-mini';
}

/**
 * Monta a URL do endpoint sem duplicar o /v1.
 * O OmniRoute é publicado COM /v1 no caminho; a OpenAI, não.
 */
function urlDe(caminho: string): string {
  const base = BASE || 'https://api.openai.com';
  return /\/v\d+$/.test(base) ? `${base}${caminho}` : `${base}/v1${caminho}`;
}

export interface Mensagem { role: string; content: Json }
export interface Tool { type: 'function'; function: { name: string; description?: string; parameters?: Json } }
export interface ToolCall { name: string; arguments: Record<string, Json> }
export interface RespostaChat { content: string | null; toolCalls: ToolCall[]; raw: Json }

/** `toolChoice`: 'auto' (padrão) ou o nome de uma tool para forçá-la (as functions originais usavam tool_choice fixo). */
export interface ChatOpts {
  messages: Mensagem[];
  tools?: Tool[];
  temperature?: number;
  proposito?: Proposito;
  model?: string;
  toolChoice?: 'auto' | 'none' | string;
}

export async function chat({ messages, tools, temperature = 0.2, proposito = 'conversar', model, toolChoice = 'auto' }: ChatOpts): Promise<RespostaChat> {
  if (!KEY) throw new HttpError('AI_API_KEY não configurada', 500);
  model = model || modeloPara(proposito);

  if (PROVIDER === 'anthropic') return anthropic({ messages, tools, temperature, model, toolChoice });
  if (PROVIDER === 'google') return google({ messages, temperature, model });
  return openai({ messages, tools, temperature, model, toolChoice });
}

/** Traduz erros HTTP do provider em status que o front já sabe mostrar (429/402). */
function erroProvider(status: number, texto: string): HttpError {
  if (status === 429) return new HttpError('Limite de requisições de IA excedido. Tente novamente em alguns segundos.', 429);
  if (status === 402) return new HttpError('Créditos de IA insuficientes.', 402);
  return new HttpError(`IA (${PROVIDER}) HTTP ${status}: ${texto.slice(0, 300)}`, 502);
}

// ------------------------------ OmniRoute / OpenAI / qualquer compatível
async function openai({ messages, tools, temperature, model, toolChoice }: Required<Pick<ChatOpts, 'messages' | 'temperature' | 'model' | 'toolChoice'>> & { tools?: Tool[] }): Promise<RespostaChat> {
  const tool_choice = !tools?.length ? undefined
    : (toolChoice === 'auto' || toolChoice === 'none') ? toolChoice
    : { type: 'function', function: { name: toolChoice } };

  const res = await fetch(urlDe('/chat/completions'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model, messages, temperature, ...(tools?.length ? { tools, tool_choice } : {}) }),
  });
  if (!res.ok) throw erroProvider(res.status, await res.text());
  const data = await res.json();
  const msg = data.choices?.[0]?.message ?? {};
  return {
    content: msg.content ?? null,
    toolCalls: (msg.tool_calls || []).map((t: Json) => ({
      name: t.function?.name,
      arguments: safeParse(t.function?.arguments),
    })),
    raw: data,
  };
}

// ------------------------------------------------------------------ Anthropic
async function anthropic({ messages, tools, temperature, model, toolChoice }: Required<Pick<ChatOpts, 'messages' | 'temperature' | 'model' | 'toolChoice'>> & { tools?: Tool[] }): Promise<RespostaChat> {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const rest = messages.filter((m) => m.role !== 'system');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model, max_tokens: 4096, temperature,
      ...(system ? { system } : {}),
      messages: rest,
      ...(tools?.length
        ? {
          tools: tools.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })),
          ...(toolChoice !== 'auto' && toolChoice !== 'none' ? { tool_choice: { type: 'tool', name: toolChoice } } : {}),
        }
        : {}),
    }),
  });
  if (!res.ok) throw erroProvider(res.status, await res.text());
  const data = await res.json();
  return {
    content: (data.content || []).filter((b: Json) => b.type === 'text').map((b: Json) => b.text).join('') || null,
    toolCalls: (data.content || []).filter((b: Json) => b.type === 'tool_use').map((b: Json) => ({ name: b.name, arguments: b.input })),
    raw: data,
  };
}

// --------------------------------------------------------------------- Google
async function google({ messages, temperature, model }: { messages: Mensagem[]; temperature: number; model: string }): Promise<RespostaChat> {
  const contents = messages.filter((m) => m.role !== 'system').map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
  }));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents, generationConfig: { temperature } }) },
  );
  if (!res.ok) throw erroProvider(res.status, await res.text());
  const data = await res.json();
  return {
    content: data.candidates?.[0]?.content?.parts?.map((p: Json) => p.text).join('') ?? null,
    toolCalls: [],
    raw: data,
  };
}

/** Bloco de imagem no formato multimodal do provider ativo. Aceita data URL ou URL http(s). */
export function imagePart(url: string): Json {
  if (PROVIDER === 'anthropic' && url.startsWith('data:')) {
    const [meta, b64] = url.split(',');
    return { type: 'image', source: { type: 'base64', media_type: meta.slice(5).split(';')[0], data: b64 } };
  }
  if (PROVIDER === 'anthropic') return { type: 'image', source: { type: 'url', url } };
  return { type: 'image_url', image_url: { url } };
}

const safeParse = (s: unknown): Record<string, Json> => {
  if (s && typeof s === 'object') return s as Record<string, Json>;
  try { return JSON.parse(String(s || '{}')); } catch { return {}; }
};

// --------------------------------------------------------------- transcrição
export interface TranscreverOpts { mimeType?: string; nomeArquivo?: string; idioma?: string }

/**
 * Áudio -> texto. É o que destrava "mandar áudio no WhatsApp para marcar
 * compromisso": o webhook pega o .ogg da Evolution, transcreve aqui, e o texto
 * segue pelo mesmo caminho de uma mensagem escrita.
 *
 * Não passa por chat/completions — usa o endpoint de transcrição, compatível
 * com o da OpenAI, que o OmniRoute expõe com Whisper por trás.
 */
export async function transcrever(audio: Uint8Array, opts: TranscreverOpts = {}): Promise<string> {
  if (!KEY) throw new HttpError('AI_API_KEY não configurada', 500);

  const fd = new FormData();
  fd.append('file', new Blob([audio], { type: opts.mimeType || 'audio/ogg' }), opts.nomeArquivo || 'audio.ogg');
  fd.append('model', MODELOS.transcrever);
  // Dizer o idioma melhora bastante a precisão e corta latência do Whisper.
  fd.append('language', opts.idioma || 'pt');
  fd.append('response_format', 'json');

  const res = await fetch(urlDe('/audio/transcriptions'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}` }, // sem Content-Type: o FormData define o boundary
    body: fd,
  });
  if (!res.ok) throw new HttpError(`Transcrição falhou (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`, 502);

  const data = await res.json();
  const texto = String(data.text || '').trim();
  if (!texto) throw new HttpError('A transcrição voltou vazia', 502);
  return texto;
}
