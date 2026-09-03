/**
 * Chamada de uma Function a partir de outra (server-to-server).
 *
 * No Supabase isso era `supabase.functions.invoke()` com a service role key.
 * No Appwrite não existe equivalente sem SDK, então usamos a API REST de
 * execuções: POST /functions/{id}/executions com a X-Appwrite-Key do servidor.
 *
 * Duas coisas importam aqui:
 *  - `async: false` — precisamos da RESPOSTA (se o WhatsApp saiu ou não) para
 *    decidir entre marcar o lembrete como enviado ou incrementar attempts.
 *    Com async:true a execução volta 'waiting' e perderíamos o resultado.
 *  - `headers` — é por onde vai o x-internal-secret. O Appwrite repassa esses
 *    headers para a function chamada, que é como whatsapp-send se autentica.
 *
 * Env: APPWRITE_FUNCTION_API_ENDPOINT, APPWRITE_FUNCTION_PROJECT_ID e
 *      APPWRITE_API_KEY (todos já usados por appwrite.js, reaproveitados via
 *      rawCall), mais INTERNAL_FUNCTION_SECRET para as chamadas internas.
 */
import { rawCall } from './appwrite.js';

/**
 * @param {string} functionId  ex: 'whatsapp-send'
 * @param {object} payload     corpo JSON entregue à function
 * @param {object} [opts]
 * @param {object} [opts.headers]  headers extras repassados à function
 * @param {string} [opts.path]     default '/'
 * @param {string} [opts.method]   default 'POST'
 * @returns {Promise<{statusCode:number, body:any, raw:object}>}
 */
export async function invokeFunction(functionId, payload = {}, opts = {}) {
  const exec = await rawCall('POST', `/functions/${functionId}/executions`, {
    body: JSON.stringify(payload),
    async: false,
    path: opts.path || '/',
    method: opts.method || 'POST',
    headers: opts.headers || {},
  });

  const statusCode = exec.responseStatusCode ?? 0;
  let parsed = null;
  if (exec.responseBody) {
    try { parsed = JSON.parse(exec.responseBody); } catch { parsed = exec.responseBody; }
  }

  if (statusCode < 200 || statusCode >= 300) {
    const motivo = parsed?.error || exec.errors || exec.responseBody || `HTTP ${statusCode}`;
    const e = new Error(`${functionId} falhou: ${String(motivo).slice(0, 300)}`);
    e.status = statusCode || 502;
    throw e;
  }
  return { statusCode, body: parsed, raw: exec };
}

/**
 * Atalho para as functions internas: injeta o x-internal-secret.
 * Falha cedo e com mensagem clara se o segredo não estiver configurado —
 * sem ele a function chamada devolveria 401 e o erro seria confuso.
 */
export function invokeInternal(functionId, payload = {}) {
  const segredo = process.env.INTERNAL_FUNCTION_SECRET;
  if (!segredo) throw new Error('INTERNAL_FUNCTION_SECRET não configurado');
  return invokeFunction(functionId, payload, { headers: { 'x-internal-secret': segredo } });
}
