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
const MODEL = process.env.AI_MODEL || defaultModel(PROVIDER);
const BASE = (process.env.AI_BASE_URL || (PROVIDER === 'omniroute' ? DEFAULT_OMNIROUTE : '')).replace(/\/+$/, '');

function defaultModel(p) {
  return {
    omniroute: 'gpt-4o-mini',
    openai: 'gpt-4o-mini',
    anthropic: 'claude-sonnet-4-5',
    google: 'gemini-2.0-flash',
  }[p] || 'gpt-4o-mini';
}

/**
 * Monta a URL do endpoint sem duplicar o /v1.
 * O OmniRoute já é publicado COM /v1 no caminho; a OpenAI, não.
 */
function completionsUrl() {
  const base = BASE || 'https://api.openai.com';
  return /\/v\d+$/.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

/**
 * @param {object} opts
 * @param {Array<{role:string, content:any}>} opts.messages
 * @param {Array<object>} [opts.tools]   formato OpenAI: {type:'function', function:{name, description, parameters}}
 * @param {number} [opts.temperature]
 * @returns {Promise<{content:string|null, toolCalls:Array<{name:string,arguments:object}>, raw:any}>}
 */
export async function chat({ messages, tools, temperature = 0.2, model = MODEL }) {
  if (!KEY) throw new Error('AI_API_KEY não configurada');

  if (PROVIDER === 'anthropic') return anthropic({ messages, tools, temperature, model });
  if (PROVIDER === 'google') return google({ messages, temperature, model });
  return openai({ messages, tools, temperature, model });
}

// ------------------------------ OmniRoute / OpenAI / qualquer compatível
async function openai({ messages, tools, temperature, model }) {
  const url = completionsUrl();
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
