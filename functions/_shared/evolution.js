/**
 * Evolution API (WhatsApp) — porta 1:1 do que as Edge Functions faziam.
 * Env: EVOLUTION_API_URL, EVOLUTION_API_KEY
 */
const BASE = (process.env.EVOLUTION_API_URL || '').replace(/\/+$/, '');
const KEY = process.env.EVOLUTION_API_KEY || '';

async function ev(method, path, body) {
  if (!BASE || !KEY) throw new Error('EVOLUTION_API_URL / EVOLUTION_API_KEY não configuradas');
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', apikey: KEY },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const txt = await res.text();
  let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }
  if (!res.ok) { const e = new Error(data?.message || `Evolution HTTP ${res.status}`); e.status = res.status; e.body = data; throw e; }
  return data;
}

export const evolution = {
  createInstance: (instanceName, webhookUrl) =>
    ev('POST', '/instance/create', {
      instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS',
      ...(webhookUrl ? { webhook: { url: webhookUrl, events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'] } } : {}),
    }),
  connect: (instanceName) => ev('GET', `/instance/connect/${instanceName}`),
  status: (instanceName) => ev('GET', `/instance/connectionState/${instanceName}`),
  logout: (instanceName) => ev('DELETE', `/instance/logout/${instanceName}`),
  deleteInstance: (instanceName) => ev('DELETE', `/instance/delete/${instanceName}`),
  setWebhook: (instanceName, url) =>
    ev('POST', `/webhook/set/${instanceName}`, {
      webhook: { enabled: true, url, events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'] },
    }),
  sendText: (instanceName, number, text) =>
    ev('POST', `/message/sendText/${instanceName}`, { number: normalize(number), text }),
};

/** Normaliza para o formato E.164 sem '+' que a Evolution espera. */
export function normalize(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d.startsWith('55') ? d : `55${d}`;
}
