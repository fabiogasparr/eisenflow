/**
 * Helpers HTTP comuns às Edge Functions: CORS, resposta JSON, erro tipado e
 * leitura tolerante do corpo.
 *
 * O contrato de erro segue o que o front já trata: `{ error: string }` com o
 * status HTTP correto. `supabase.functions.invoke` transforma qualquer status
 * não-2xx em `FunctionsHttpError`, então o status importa mais que o corpo.
 */

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-api-key, x-internal-secret, ' +
    'x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/** Erro com status HTTP e código opcional (o front usa `code` para casos como google_reconnect_required). */
export class HttpError extends Error {
  status: number;
  codigo?: string;
  constructor(message: string, status = 500, codigo?: string) {
    super(message);
    this.status = status;
    this.codigo = codigo;
  }
}

export const erro = (message: string, status = 400, codigo?: string) => new HttpError(message, status, codigo);

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extra },
  });
}

/** Resposta de erro padronizada a partir de qualquer exceção. */
export function respostaErro(e: unknown, fallback = 500): Response {
  // deno-lint-ignore no-explicit-any
  const qualquer = e as any;
  // PostgrestError (supabase-js) não é Error: tem message/code/details mas status indefinido.
  const status = typeof qualquer?.status === 'number' ? qualquer.status : fallback;
  const codigo = qualquer?.codigo;
  const message = typeof qualquer?.message === 'string' ? qualquer.message : String(e);
  return json({ ok: false, error: message, ...(codigo ? { code: codigo } : {}) }, status);
}

export const preflight = () => new Response(null, { headers: corsHeaders });

/** Corpo JSON tolerante: sem corpo ou JSON inválido vira `{}` (cron chama sem corpo). */
// deno-lint-ignore no-explicit-any
export async function lerCorpo(req: Request): Promise<Record<string, any>> {
  try {
    const txt = await req.text();
    if (!txt.trim()) return {};
    const parsed = JSON.parse(txt);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Query string como objeto simples. */
export function lerQuery(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  new URL(req.url).searchParams.forEach((v, k) => { out[k] = v; });
  return out;
}

/** IP do cliente atrás do Kong/Coolify. */
export function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for') || '';
  const primeiro = xff.split(',')[0].trim();
  return primeiro || req.headers.get('x-real-ip') || null;
}
