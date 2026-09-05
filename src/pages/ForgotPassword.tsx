import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/i18n/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { ArrowLeft, MailCheck, Zap } from 'lucide-react';

/**
 * Pedido de recuperação de senha.
 *
 * `supabase.auth.resetPasswordForEmail(email, { redirectTo })` faz o GoTrue
 * mandar um e-mail com um link que abre `redirectTo` já com uma sessão de
 * recuperação (tokens no hash da URL, ou `?code=` no fluxo PKCE). Quem consome
 * isso é /auth/recovery (ResetPassword.tsx). O link vale 1 hora e é de uso único.
 *
 * DOIS PRÉ-REQUISITOS no Supabase self-hosted, senão isto falha em produção:
 *  1. SMTP configurado no GoTrue (GOTRUE_SMTP_*) — sem isso o e-mail não sai.
 *  2. A URL de `redirectTo` precisa constar em GOTRUE_URI_ALLOW_LIST (ou ser o
 *     SITE_URL); caso contrário o GoTrue ignora e manda para o SITE_URL, onde
 *     não existe a tela de nova senha.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const { t } = useLanguage();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/recovery`,
      });
      if (error) throw error;
      setEnviado(true);
    } catch (err) {
      // Não revelamos se o e-mail existe ou não — dizer "essa conta não existe"
      // entrega quais e-mails estão cadastrados para quem estiver testando.
      // Qualquer falha aqui vira a mesma tela de sucesso, e o erro real só
      // aparece no console para depuração.
      console.error('Falha ao pedir recuperação de senha:', err);
      setEnviado(true);
    } finally {
      setLoading(false);
    }
  };

  if (enviado) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md border-border/50 shadow-xl">
          <CardHeader className="text-center space-y-3">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary">
              <MailCheck className="h-7 w-7 text-primary-foreground" />
            </div>
            <CardTitle className="font-display text-2xl font-bold tracking-tight">
              {t('resetLinkSent')}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {t('resetLinkSentDesc')}
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild variant="outline" className="w-full">
              <Link to="/auth">
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t('backToLogin')}
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border/50 shadow-xl">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary">
            <Zap className="h-7 w-7 text-primary-foreground" />
          </div>
          <CardTitle className="font-display text-2xl font-bold tracking-tight">
            {t('forgotPassword')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('forgotPasswordDesc')}
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <Input
              type="email"
              placeholder={t('email')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={loading || !email}>
              {loading ? '...' : t('sendResetLink')}
            </Button>
            <Link
              to="/auth"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('backToLogin')}
            </Link>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
