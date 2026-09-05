import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';
import { supabase } from './client';

/**
 * Camada fina sobre `supabase.functions.invoke`.
 *
 * POR QUE EXISTE
 * `functions.invoke` devolve `{ data, error }` e o `error` cru é pouco útil para
 * quem está na tela:
 *  - `FunctionsHttpError` (a function respondeu 4xx/5xx) esconde o corpo da
 *    resposta dentro de `context` (um Response ainda não lido). O JSON de erro
 *    que a function montou — `{ error, code }` — é o que interessa, e é o que
 *    a tela precisa para distinguir, por exemplo, "reconecte sua conta Google".
 *  - `FunctionsFetchError` / `FunctionsRelayError` aparecem quando a function
 *    não existe no edge-runtime (self-hosted: arquivos ainda não copiados para
 *    o volume) ou o gateway não a alcança. Não é um bug — é um recurso que
 *    ainda não subiu, e o usuário merece ouvir isso em português em vez de
 *    "Failed to send a request to the Edge Function".
 */

/** A function respondeu com erro. `body` é o JSON devolvido por ela, se houver. */
export class FunctionError extends Error {
  constructor(
    readonly functionName: string,
    readonly status: number,
    message: string,
    /** `code` legível que as functions do EisenFlow põem no corpo (ex.: google_reconnect_required). */
    readonly code?: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'FunctionError';
  }
}

/** A function não está implantada ou o gateway não a alcança. */
export class FunctionNotDeployedError extends Error {
  constructor(readonly functionName: string) {
    super(
      `O recurso "${NOMES[functionName] ?? functionName}" ainda não foi ativado neste servidor. ` +
      'As automações estão sendo implantadas.',
    );
    this.name = 'FunctionNotDeployedError';
  }
}

/** Nome legível de cada function, para a mensagem não citar um id técnico. */
const NOMES: Record<string, string> = {
  'classify-task': 'classificação automática por IA',
  'ai-task-chat': 'chat com IA',
  'analyze-task-image': 'análise de imagem',
  'reevaluate-deadlines': 'reavaliação de prazos',
  'google-calendar-auth': 'conexão com o Google Calendar',
  'google-calendar-sync': 'sincronização com o Google Calendar',
  'whatsapp-connect': 'conexão do WhatsApp',
  'whatsapp-disconnect': 'desconexão do WhatsApp',
  'whatsapp-status': 'status do WhatsApp',
  'tenant-whatsapp-connect': 'WhatsApp da organização',
  'tenant-whatsapp-verify-phone': 'verificação de telefone',
  'hermes-mcp': 'integração MCP',
};

/** Lê o corpo de erro que a function devolveu; tolera texto puro e corpo vazio. */
async function lerCorpo(context: unknown): Promise<{ status: number; body: unknown }> {
  const res = context as Response | undefined;
  const status = typeof res?.status === 'number' ? res.status : 0;
  if (!res || typeof res.text !== 'function') return { status, body: undefined };
  try {
    const texto = await res.text();
    try {
      return { status, body: texto ? JSON.parse(texto) : undefined };
    } catch {
      return { status, body: texto };
    }
  } catch {
    return { status, body: undefined };
  }
}

/**
 * Chama uma Edge Function e devolve o JSON de sucesso, ou lança um erro com
 * mensagem pronta para a tela. A sessão do usuário vai no cabeçalho pelo
 * próprio supabase-js.
 */
export async function invoke<T = unknown>(functionName: string, body?: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(functionName, {
    body: body === undefined ? undefined : body,
  });

  if (!error) return data as T;

  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
    throw new FunctionNotDeployedError(functionName);
  }

  if (error instanceof FunctionsHttpError) {
    const { status, body: corpo } = await lerCorpo(error.context);
    // Kong/edge-runtime respondem 404 quando a function não está no volume.
    if (status === 404) throw new FunctionNotDeployedError(functionName);
    const obj = (corpo && typeof corpo === 'object' ? corpo : {}) as { error?: unknown; message?: unknown; code?: unknown };
    const mensagem =
      (typeof obj.error === 'string' && obj.error)
      || (typeof obj.message === 'string' && obj.message)
      || (typeof corpo === 'string' && corpo)
      || error.message;
    throw new FunctionError(functionName, status, mensagem, typeof obj.code === 'string' ? obj.code : undefined, corpo);
  }

  throw error;
}
