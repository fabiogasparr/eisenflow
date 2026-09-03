/**
 * Provider de IA — SUBSTITUI o Lovable AI Gateway.
 *
 * O gateway da Lovable é proprietário e some quando o backend sai da Lovable.
 * Este módulo mantém o MESMO contrato que as Edge Functions usavam
 * (mensagens estilo OpenAI + tools/function-calling).
 *
 * PADRÃO DESTE PROJETO: OmniRoute self-hospedado
 * (https://omniroute.kz3solucoes.cloud/v1), que fala o protocolo OpenAI.
 * Trocar de modelo passa a ser mudar AI_MODEL — sem tocar em código.
 *
 * Env:
 *   AI_PROVIDER = omniroute (padrão) | openai | anthropic | google | openai-compat
 *   AI_BASE_URL   default https://omniroute.kz3solucoes.cloud/v1
 *   AI_API_KEY    a chave do OmniRoute
 *   AI_MODEL      o nome do modelo como o OmniRoute o expõe
 */
const DEFAULT_OMNIROUTE = 'https://omniroute.kz3solucoes.cloud/v1';

const PROVIDER = process.env.AI_PROVIDER || 'omniroute';
const KEY = process.env.AI_API_KEY || '';
const BASE = (process.env.AI_BASE_URL || (PROVIDER === 'omniroute' ? DEFAULT_OMNIROUTE : '')).replace(/\/+$/, '');

/**
 * MODELO POR FINALIDADE, NÃO POR FUNCTION.
 *
 * O OmniRoute expõe aliases `auto/*` que escolhem o provedor e fazem failover
 * sozinhos — é o que interessa aqui, porque o custo/disponibilidade muda e o
 * código não deveria mudar junto. Cada finalidade abaixo foi escolhida a partir
 * do catálogo real do servidor (889 modelos, 381 com visão, 695 com
 * tool_calling, janela de ~1M tokens nos aliases).
 *
 *   classificar  chamada curta e frequente (toda tarefa criada). Precisa de
 *                tool_calling e latência baixa; qualidade de raciocínio importa
 *                pouco para escolher um quadrante -> auto/fast
 *   conversar    o Chat IA cria tarefas via function calling e mantém contexto;
 *                aqui a qualidade da resposta é o produto -> auto/best-chat
 *   visao        OCR e leitura de imagem (anexo de tarefa e foto no WhatsApp).
 *                Texto de foto costuma vir torto e com pouca luz, então vale o
 *                melhor modelo de visão -> auto/best-vision
 *   julgar       reavaliação de prazos roda em lote, no cron, sem ninguém
 *                esperando: qualidade acima de latência -> auto/reasoning
 *   transcrever  áudio do WhatsApp -> texto. Não é chat: usa o endpoint
 *                /audio/transcriptions com Whisper. A variante `turbo` porque
 *                quem mandou áudio está esperando resposta -> whisper-large-v3-turbo
 *
 * Qualquer uma pode ser sobrescrita por variável de ambiente sem tocar em código:
 *   AI_MODEL_CLASSIFICAR, AI_MODEL_CONVERSAR, AI_MODEL_VISAO,
 *   AI_MODEL_JULGAR, AI_MODEL_TRANSCREVER
 */
export const MODELOS = {
  classificar: process.env.AI_MODEL_CLASSIFICAR || 'auto/fast',
  conversar: process.env.AI_MODEL_CONVERSAR || 'auto/best-chat',
  visao: process.env.AI_MODEL_VISAO || 'auto/best-vision',
  julgar: process.env.AI_MODEL_JULGAR || 'auto/reasoning',
  transcrever: process.env.AI_MODEL_TRANSCREVER || 'huggingface/openai/whisper-large-v3-turbo',
};

/** Fora do OmniRoute os aliases `auto/*` não existem — cai para um modelo real. */
function modeloPara(proposito) {
  const m = MODELOS[proposito] || MODELOS.conversar;
  if (PROVIDER === 'omniroute' || PROVIDER === 'openai-compat') return m;
  return { openai: 'gpt-4o-mini', anthropic: 'claude-sonnet-4-5', google: 'gemini-2.0-flash' }[PROVIDER] || 'gpt-4o-mini';
}

/**
 * Monta a URL do endpoint sem duplicar o /v1.
 * O OmniRoute é publicado COM /v1 no caminho; a OpenAI, não.
 */
function urlDe(caminho) {
  const base = BASE || 'https://api.openai.com';
  return /\/v\d+$/.test(base) ? `${base}${caminho}` : `${base}/v1${caminho}`;
}

/**
 * @param {object} opts
 * @param {Array<{role:string, content:any}>} opts.messages
 * @param {Array<object>} [opts.tools]   formato OpenAI: {type:'function', function:{name, description, parameters}}
 * @param {number} [opts.temperature]
 * @returns {Promise<{content:string|null, toolCalls:Array<{name:string,arguments:object}>, raw:any}>}
 */
export async function chat({ messages, tools, temperature = 0.2, proposito = 'conversar', model }) {
  if (!KEY) throw new Error('AI_API_KEY não configurada');
  model = model || modeloPara(proposito);

  if (PROVIDER === 'anthropic') return anthropic({ messages, tools, temperature, model });
  if (PROVIDER === 'google') return google({ messages, temperature, model });
  return openai({ messages, tools, temperature, model });
}

// ------------------------------ OmniRoute / OpenAI / qualquer compatível
async function openai({ messages, tools, temperature, model }) {
  const url = urlDe('/chat/completions');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model, messages, temperature, ...(tools?.length ? { tools, tool_choice: 'auto' } : {}) }),
  });
  if (!res.ok) throw new Error(`IA (${PROVIDER}) HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const msg = data.choices?.[0]?.message ?? {};
  return {
    content: msg.content ?? null,
    toolCalls: (msg.tool_calls || []).map((t) => ({
      name: t.function?.name,
      arguments: safeParse(t.function?.arguments),
    })),
    raw: data,
  };
}

// ------------------------------------------------------------------ Anthropic
async function anthropic({ messages, tools, temperature, model }) {
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
        ? { tools: tools.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })) }
        : {}),
    }),
  });
  if (!res.ok) throw new Error(`IA (anthropic) HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    content: (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('') || null,
    toolCalls: (data.content || []).filter((b) => b.type === 'tool_use').map((b) => ({ name: b.name, arguments: b.input })),
    raw: data,
  };
}

// --------------------------------------------------------------------- Google
async function google({ messages, temperature, model }) {
  const contents = messages.filter((m) => m.role !== 'system').map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
  }));
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents, generationConfig: { temperature } }) },
  );
  if (!res.ok) throw new Error(`IA (google) HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    content: data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? null,
    toolCalls: [],
    raw: data,
  };
}

/** Bloco de imagem no formato multimodal do provider ativo. */
export function imagePart(dataUrl) {
  if (PROVIDER === 'anthropic') {
    const [meta, b64] = dataUrl.split(',');
    return { type: 'image', source: { type: 'base64', media_type: meta.slice(5).split(';')[0], data: b64 } };
  }
  return { type: 'image_url', image_url: { url: dataUrl } };
}

const safeParse = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

// --------------------------------------------------------------- transcrição
/**
 * Áudio -> texto. É o que destrava "mandar áudio no WhatsApp para marcar
 * compromisso": o webhook baixa o .ogg da Evolution, transcreve aqui, e o texto
 * segue pelo mesmo caminho de uma mensagem escrita.
 *
 * Não passa por chat/completions — usa o endpoint de transcrição, compatível
 * com o da OpenAI, que o OmniRoute expõe com Whisper por trás.
 *
 * @param {Buffer|Uint8Array} audio  bytes do áudio (ogg/opus no WhatsApp)
 * @param {object} [opts]
 * @param {string} [opts.mimeType]   default audio/ogg
 * @param {string} [opts.nomeArquivo] default audio.ogg
 * @param {string} [opts.idioma]     dica de idioma ISO-639-1, ex 'pt'
 * @returns {Promise<string>} o texto transcrito
 */
export async function transcrever(audio, opts = {}) {
  if (!KEY) throw new Error('AI_API_KEY não configurada');

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
  if (!res.ok) throw new Error(`Transcrição falhou (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);

  const data = await res.json();
  const texto = (data.text || '').trim();
  if (!texto) throw new Error('A transcrição voltou vazia');
  return texto;
}
