/** Helpers de resposta e parsing para o runtime de Functions do Appwrite. */
export const json = (res, body, status = 200) => res.json(body, status);
export const err = (res, e, fallback = 500) =>
  res.json({ ok: false, error: e?.message || 'erro interno' }, e?.status || fallback);

export function body(req) {
  if (req.bodyJson && typeof req.bodyJson === 'object') return req.bodyJson;
  if (typeof req.bodyRaw === 'string' && req.bodyRaw.trim()) {
    try { return JSON.parse(req.bodyRaw); } catch { return {}; }
  }
  return {};
}

export const query = (req) => req.query || {};

/**
 * Distingue execução por agendamento (cron) de chamada HTTP.
 * O Appwrite injeta x-appwrite-trigger: 'schedule' | 'http' | 'event'.
 */
export const isScheduled = (req) => (req.headers?.['x-appwrite-trigger'] || '') === 'schedule';
