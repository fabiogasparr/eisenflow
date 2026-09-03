/**
 * Autenticação — equivalente Appwrite do Supabase Auth.
 *
 * Mapa Supabase -> Appwrite:
 *   supabase.auth.signUp                  -> account.create + createEmailPasswordSession
 *   supabase.auth.signInWithPassword      -> account.createEmailPasswordSession
 *   supabase.auth.signInWithOAuth         -> account.createOAuth2Session
 *   supabase.auth.signOut                 -> account.deleteSession('current')
 *   supabase.auth.getUser                 -> account.get
 *   supabase.auth.onAuthStateChange       -> não existe; use onAuthChange() abaixo
 *   auth.uid()                            -> (await account.get()).$id
 *   trigger handle_new_user               -> ensureProfile() logo após o login
 */
import { account, databases, ID, Query, Permission, Role } from './client';
import { DATABASE_ID, COLLECTIONS } from './types';
import type { Models } from 'appwrite';

export type AppUser = Models.User<Models.Preferences>;

// ------------------------------------------------------------------ sessão
export async function signUp(email: string, password: string, displayName?: string) {
  const user = await account.create(ID.unique(), email, password, displayName);
  await account.createEmailPasswordSession(email, password);
  await ensureProfile(displayName);
  return user;
}

export async function signIn(email: string, password: string) {
  const session = await account.createEmailPasswordSession(email, password);
  await ensureProfile();
  return session;
}

/** OAuth (Google, GitHub...). Configure o provider no console do Appwrite antes. */
export function signInWithOAuth(provider: 'google' | 'github', success?: string, failure?: string) {
  const origin = window.location.origin;
  return account.createOAuth2Session(
    provider as never,
    success ?? `${origin}/auth/callback`,
    failure ?? `${origin}/auth?error=oauth`,
  );
}

export async function signOut() {
  try { await account.deleteSession('current'); } catch { /* sessão já expirada */ }
  notify(null);
}

export async function getCurrentUser(): Promise<AppUser | null> {
  try { return await account.get(); } catch { return null; }
}

export async function getUserId(): Promise<string | null> {
  return (await getCurrentUser())?.$id ?? null;
}

// --------------------------------------------------------------- recuperação
export const requestPasswordReset = (email: string) =>
  account.createRecovery(email, `${window.location.origin}/auth/recovery`);

export const confirmPasswordReset = (userId: string, secret: string, password: string) =>
  account.updateRecovery(userId, secret, password);

export const sendVerificationEmail = () =>
  account.createVerification(`${window.location.origin}/auth/verify`);

// ------------------------------------------------------------------ MFA
// Substitui as tabelas user_2fa / failed_2fa_attempts do Postgres.
export const setupTotp = () => account.createMfaAuthenticator('totp' as never);
export const confirmTotp = (otp: string) => account.updateMfaAuthenticator('totp' as never, otp);
export const enableMfa = () => account.updateMFA(true);
export const listMfaFactors = () => account.listMfaFactors();

// ------------------------------------------------------------------ perfil
/**
 * Equivalente ao trigger handle_new_user do Postgres: garante que exista um
 * documento em `profiles` para a conta logada. Chame após todo login.
 */
export async function ensureProfile(displayName?: string) {
  const user = await getCurrentUser();
  if (!user) return null;

  const existing = await databases.listDocuments(DATABASE_ID, COLLECTIONS.profiles, [
    Query.equal('user_id', user.$id),
    Query.limit(1),
  ]);
  if (existing.total > 0) return existing.documents[0];

  const now = new Date().toISOString();
  return databases.createDocument(
    DATABASE_ID,
    COLLECTIONS.profiles,
    ID.unique(),
    {
      user_id: user.$id,
      display_name: displayName ?? user.name ?? user.email,
      preferred_language: 'pt-BR',
      disabled: false,
      created_at: now,
      updated_at: now,
    },
    [
      // O próprio dono lê/escreve; qualquer autenticado lê (a policy antiga era
      // "Authenticated users can view all profiles").
      Permission.read(Role.users()),
      Permission.update(Role.user(user.$id)),
      Permission.delete(Role.user(user.$id)),
    ],
  );
}

// ------------------------------------------------- onAuthStateChange caseiro
type AuthListener = (user: AppUser | null) => void;
const listeners = new Set<AuthListener>();
let current: AppUser | null | undefined;

function notify(user: AppUser | null): AppUser | null {
  current = user;
  listeners.forEach((l) => l(user));
  return user;
}

/**
 * O Appwrite não emite evento de auth. Este helper resolve a sessão uma vez,
 * avisa os inscritos, e revalida quando a aba volta ao foco.
 */
export function onAuthChange(listener: AuthListener): () => void {
  listeners.add(listener);

  if (current !== undefined) listener(current);
  else getCurrentUser().then(notify);

  const revalidate = () => { if (document.visibilityState === 'visible') getCurrentUser().then(notify); };
  document.addEventListener('visibilitychange', revalidate);

  return () => {
    listeners.delete(listener);
    document.removeEventListener('visibilitychange', revalidate);
  };
}

export const refreshAuth = () => getCurrentUser().then(notify);
