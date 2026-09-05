/**
 * Acesso ao Supabase e autenticação dentro das Edge Functions.
 *
 * Duas identidades possíveis em cada chamada:
 *  1. USUÁRIO — JWT do GoTrue no header Authorization (chamada do front via
 *     `supabase.functions.invoke`). Resolvido com `auth.getUser()`.
 *  2. SERVIDOR — pg_cron/pg_net ou outra function. Prova-se com
 *     `x-internal-secret: INTERNAL_FUNCTION_SECRET` OU `Authorization: Bearer
 *     <SUPABASE_SERVICE_ROLE_KEY>`. É assim que os crons são chamados no
 *     self-hosted (não existe o agendador do Supabase Cloud).
 *
 * Todas as ESCRITAS das functions usam o client de service role: as
 * permissões voltam a ser RLS no Postgres, então quem chama a function precisa
 * ser autorizado AQUI (membro do tenant, dono do recurso etc.) antes da escrita.
 *
 * Env (injetadas no container edge-runtime): SUPABASE_URL, SUPABASE_ANON_KEY,
 * SUPABASE_SERVICE_ROLE_KEY, INTERNAL_FUNCTION_SECRET.
 */
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { erro } from './http.ts';

function env(nome: string): string {
  const v = Deno.env.get(nome);
  if (!v) throw erro(`${nome} não configurada no ambiente das Edge Functions`, 500);
  return v;
}

// deno-lint-ignore no-explicit-any
export type Db = SupabaseClient<any, 'public', any>;

let _admin: Db | null = null;

/** Client com a service role — ignora RLS. Um por isolate, reaproveitado. */
export function admin(): Db {
  if (!_admin) {
    _admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}

export interface Usuario {
  id: string;
  email: string | null;
}

/** Usuário do JWT, ou null. Nunca lança por token inválido — quem decide é requireUser. */
export async function getUser(req: Request): Promise<Usuario | null> {
  const auth = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/i.test(auth)) return null;
  const token = auth.replace(/^Bearer\s+/i, '');
  // A service role não é um usuário: getUser() devolveria erro. Atalho explícito.
  if (token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return null;
  try {
    const client = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  } catch {
    return null;
  }
}

export async function requireUser(req: Request): Promise<Usuario> {
  const u = await getUser(req);
  if (!u) throw erro('Não autenticado', 401);
  return u;
}

/**
 * Segredo das chamadas internas. O nome canônico é INTERNAL_FUNCTION_SECRET;
 * INTERNAL_SECRET é aceito porque a migration de cron
 * (20260905000600_cron-edge-functions.sql) documenta esse nome — o valor tem
 * que ser o mesmo de app.settings.internal_secret no Postgres.
 */
export const segredoInterno = (): string | undefined =>
  Deno.env.get('INTERNAL_FUNCTION_SECRET') || Deno.env.get('INTERNAL_SECRET');

/**
 * Chamada de servidor: segredo interno OU service role no Authorization.
 * Sem INTERNAL_FUNCTION_SECRET configurado, `undefined === undefined` liberaria
 * geral — por isso a comparação exige o segredo existir.
 */
export function isInternalCall(req: Request): boolean {
  const segredo = segredoInterno();
  const header = req.headers.get('x-internal-secret');
  if (segredo && header && header === segredo) return true;

  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  return !!service && !!bearer && bearer === service;
}

/** Crons e functions internas: só servidor. */
export function requireInternal(req: Request): void {
  if (!isInternalCall(req)) throw erro('Somente chamada interna (x-internal-secret ou service role)', 403);
}

// ------------------------------------------------------------------ tenants
export type PapelTenant = 'owner' | 'admin' | 'member' | 'guest' | string;

/** Equivalente à função SQL get_tenant_role, mas sem depender de RPC. */
export async function getTenantRole(tenantId: string, userId: string): Promise<PapelTenant | null> {
  const { data } = await admin()
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();
  return data?.role ?? null;
}

export async function requireTenantMember(tenantId: string | null | undefined, userId: string): Promise<PapelTenant> {
  if (!tenantId) throw erro('tenant_id é obrigatório', 400);
  const papel = await getTenantRole(tenantId, userId);
  if (!papel) throw erro('Você não é membro deste workspace', 403);
  return papel;
}

export async function requireTenantAdmin(tenantId: string | null | undefined, userId: string): Promise<PapelTenant> {
  const papel = await requireTenantMember(tenantId, userId);
  if (!['owner', 'admin'].includes(papel)) throw erro('Requer papel owner/admin no workspace', 403);
  return papel;
}

/**
 * Tenant "corrente" quando o front não manda tenant_id: o mais antigo do
 * usuário (o pessoal, criado pelo trigger handle_new_user_tenant). Mantém
 * compatível o front antigo, que não conhecia tenant_id nessas chamadas.
 */
export async function tenantPadraoDe(userId: string): Promise<string | null> {
  const { data } = await admin()
    .from('tenant_members')
    .select('tenant_id, joined_at')
    .eq('user_id', userId)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.tenant_id ?? null;
}

/** 23505 = unique_violation do Postgres. É o sinal de "outro alguém chegou antes". */
// deno-lint-ignore no-explicit-any
export const ehConflito = (e: any): boolean => e?.code === '23505' || /duplicate key/i.test(String(e?.message || ''));
