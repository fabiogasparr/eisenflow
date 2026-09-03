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

export async function invoke<T = unknown>(
  functionId: string,
  body?: unknown,
  options: { path?: string; method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; headers?: Record<string, string> } = {},
): Promise<T> {
  const exec = await functions.createExecution(
    functionId,
    body === undefined ? undefined : JSON.stringify(body),
    false, // síncrono
    options.path ?? '/',
    (options.method ?? 'POST') as ExecutionMethod,
    { 'content-type': 'application/json', ...(options.headers ?? {}) },
  );

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
