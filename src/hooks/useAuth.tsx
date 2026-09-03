import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import {
  onAuthChange,
  signUp as awSignUp,
  signIn as awSignIn,
  signOut as awSignOut,
  refreshAuth,
  type AppUser,
} from '@/integrations/appwrite/auth';
import { findOne, Query } from '@/integrations/appwrite/database';

interface AuthContextType {
  user: AppUser | null;
  /**
   * O Appwrite não expõe um objeto de sessão como o Supabase. Mantido como
   * espelho de `user` para os componentes que só checavam `session` para saber
   * se havia alguém logado.
   */
  session: AppUser | null;
  loading: boolean;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // O Appwrite não emite evento de auth: onAuthChange resolve a sessão uma vez
    // e revalida quando a aba volta ao foco.
    const unsubscribe = onAuthChange((u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName?: string) => {
    await awSignUp(email, password, displayName);
    await refreshAuth();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    await awSignIn(email, password);
    const me = await refreshAuth();

    // Mesma regra de antes: conta desativada não entra.
    if (me) {
      const profile = await findOne('profiles', [Query.equal('user_id', me.$id)]);
      if (profile?.disabled) {
        await awSignOut();
        await refreshAuth();
        throw new Error('Sua conta foi desativada. Entre em contato com o administrador.');
      }
    }
  }, []);

  const signOut = useCallback(async () => {
    await awSignOut();
    await refreshAuth();
  }, []);

  return (
    <AuthContext.Provider value={{ user, session: user, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
