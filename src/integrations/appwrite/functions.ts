/**
 * Chamada de Functions — equivalente ao `supabase.functions.invoke()`.
 *
 * Supabase:
 *   const { data, error } = await supabase.functions.invoke('classify-task', { body: {...} });
 *   if (error) throw error;
 *
 * Appwrite:
 *   const data = await invoke('classify-task', {...});   // lança em caso de erro
 *
 * Diferenças que importam:
 * - O Appwrite devolve o corpo como STRING em `responseBody`; aqui já vem parseado.
 * - A sessão do usuário viaja sozinha: a function lê `x-appwrite-user-id`.
 * - `async: false` faz a execução ser síncrona (o padrão do supabase.invoke).
 */
import { functions } from './client';
import { ExecutionMethod } from 'appwrite';

export class FunctionError extends Error {
  constructor(message: string, readonly status: number, readonly raw: string) {
    super(message);
    this.name = 'FunctionError';
  }
}

/**
 * A function existe no projeto, mas ainda não foi implantada (ou nem foi criada).
 * Vale distinguir de um erro de execução: aqui não há nada quebrado — é um
 * recurso que ainda não subiu, e o usuário merece ouvir isso em português em
 * vez de "Function with the requested ID could not be found".
 */
export class FunctionNotDeployedError extends Error {
  constructor(readonly functionId: string) {
    super(
      `O recurso "${NOMES[functionId] ?? functionId}" ainda não foi ativado neste servidor. ` +
      'A migração para o Appwrite está concluída no banco; as automações estão sendo implantadas.',
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
  'create-tenant': 'criação de organização',
};

export async function invoke<T = unknown>(
  functionId: string,
  body?: unknown,
  options: { path?: string; method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; headers?: Record<string, string> } = {},
): Promise<T> {
  let exec;
  try {
    exec = await functions.createExecution(
      functionId,
      body === undefined ? undefined : JSON.stringify(body),
      false, // síncrono
      options.path ?? '/',
      (options.method ?? 'POST') as ExecutionMethod,
      { 'content-type': 'application/json', ...(options.headers ?? {}) },
    );
  } catch (e) {
    // 404 aqui significa que a function não existe no projeto — não é falha de
    // execução. Traduzimos para um erro específico e legível.
    const status = (e as { code?: number })?.code;
    if (status === 404) throw new FunctionNotDeployedError(functionId);
    throw e;
  }

  const raw = exec.responseBody ?? '';
  let parsed: unknown = raw;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { /* resposta não-JSON */ }

  const status = exec.responseStatusCode ?? 0;
  if (status >= 400 || exec.status === 'failed') {
    const msg =
      (parsed && typeof parsed === 'object' && 'error' in parsed && String((parsed as { error: unknown }).error)) ||
      exec.errors ||
      `Function ${functionId} falhou (HTTP ${status})`;
    throw new FunctionError(msg, status, raw);
  }

  return parsed as T;
}

/**
 * Mesma assinatura de retorno do Supabase, para quem preferir converter o
 * mínimo possível no chamador: `const { data, error } = await invokeSafe(...)`.
 */
export async function invokeSafe<T = unknown>(
  functionId: string,
  body?: unknown,
): Promise<{ data: T | null; error: Error | null }> {
  try {
    return { data: await invoke<T>(functionId, body), error: null };
  } catch (e) {
    return { data: null, error: e as Error };
  }
}
