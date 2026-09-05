import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLanguage } from '@/i18n/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle, ArrowLeft, Zap } from 'lucide-react';

const TAMANHO_MINIMO = 8;

/**
 * Conclusão da recuperação de senha.
 *
 * O link do e-mail abre /auth/recovery já carregando a sessão de recuperação
 * (tokens no hash da URL no fluxo implícito, ou `?code=` no PKCE). O próprio
 * supabase-js consome a URL ao iniciar (`detectSessionInUrl`), grava a sessão
 * e dispara o evento `PASSWORD_RECOVERY` em `onAuthStateChange`. A partir daí
 * basta `auth.updateUser({ password })`.
 *
 * Por que não confiamos SÓ no evento: o cliente é criado na importação do
 * módulo e processa a URL antes de esta tela montar, então o evento pode já
 * ter passado quando assinamos. `getSession()` espera a inicialização terminar
 * e cobre esse caso; o evento fica como segunda via.
 *
 * Link expirado ou já usado: o GoTrue redireciona com `#error=...&error_code=
 * otp_expired` em vez de tokens — sem sessão, mostramos a tela de link inválido.
 */
type Estado = 'verificando' | 'pronto' | 'invalido';

export default function ResetPassword() {
  const [estado, setEstado] = useState<Estado>('verificando');
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [loading, setLoading] = useState(false);
  const { t } = useLanguage();
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (hash.get('error')) {
      console.warn('Recuperação de senha recusada pelo GoTrue:', hash.get('error_description'));
      setEstado('invalido');
      return;
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        setEstado('pronto');
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      // Sem sessão depois de o cliente ter lido a URL = link incompleto, expirado
      // ou aberto na mão. Com sessão (de recuperação ou antiga), pode trocar.
      setEstado(session ? 'pronto' : 'invalido');
    });

    return () => subscription.unsubscribe();
  }, []);

  if (estado === 'verificando') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <p className="text-sm text-muted-foreground">...</p>
      </div>
    );
  }

  if (estado === 'invalido') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md border-border/50 shadow-xl">
          <CardHeader className="text-center space-y-3">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive">
              <AlertTriangle className="h-7 w-7 text-destructive-foreground" />
            </div>
            <CardTitle className="font-display text-2xl font-bold tracking-tight">
              {t('invalidResetLink')}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {t('invalidResetLinkDesc')}
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex flex-col gap-3">
            <Button asChild className="w-full">
              <Link to="/auth/forgot">{t('forgotPassword')}</Link>
            </Button>
            <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              {t('backToLogin')}
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  const naoConfere = confirmacao.length > 0 && senha !== confirmacao;
  const curtaDemais = senha.length > 0 && senha.length < TAMANHO_MINIMO;
  const podeEnviar = senha.length >= TAMANHO_MINIMO && senha === confirmacao && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!podeEnviar) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) throw error;
      // A sessão de recuperação nasceu de um link de e-mail; encerramos e
      // pedimos o login normal com a senha nova (é o que a mensagem promete).
      await supabase.auth.signOut();
      toast({ title: t('passwordUpdated'), description: t('passwordUpdatedDesc') });
      navigate('/auth', { replace: true });
    } catch (err) {
      // Aqui o erro é útil para o usuário: quase sempre é sessão expirada ou
      // senha igual à anterior.
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: t('resetPassword'), description: msg, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border/50 shadow-xl">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary">
            <Zap className="h-7 w-7 text-primary-foreground" />
          </div>
          <CardTitle className="font-display text-2xl font-bold tracking-tight">
            {t('resetPassword')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('resetPasswordDesc')}
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <Input
              type="password"
              placeholder={t('newPassword')}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
              minLength={TAMANHO_MINIMO}
              autoFocus
            />
            <Input
              type="password"
              placeholder={t('confirmPassword')}
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              required
            />
            {curtaDemais && (
              <p className="text-sm text-destructive">{t('passwordTooShort')}</p>
            )}
            {naoConfere && (
              <p className="text-sm text-destructive">{t('passwordsDontMatch')}</p>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={!podeEnviar}>
              {loading ? '...' : t('resetPassword')}
            </Button>
            <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="mr-1 inline h-3 w-3" />
              {t('backToLogin')}
            </Link>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
