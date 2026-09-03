import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useLanguage } from '@/i18n/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { confirmPasswordReset } from '@/integrations/appwrite/auth';
import { AlertTriangle, ArrowLeft, Zap } from 'lucide-react';

const TAMANHO_MINIMO = 8;

/**
 * Conclusão da recuperação de senha.
 *
 * O e-mail leva para /auth/recovery?userId=...&secret=... e aqui trocamos esse
 * par pela nova senha via `account.updateRecovery`. O link vale 1 hora e é de
 * uso único — depois disso o Appwrite responde 401.
 */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const userId = params.get('userId');
  const secret = params.get('secret');

  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [loading, setLoading] = useState(false);
  const { t } = useLanguage();
  const { toast } = useToast();
  const navigate = useNavigate();

  // Link inválido ou aberto na mão, sem os parâmetros do e-mail.
  if (!userId || !secret) {
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
      await confirmPasswordReset(userId, secret, senha);
      toast({ title: t('passwordUpdated'), description: t('passwordUpdatedDesc') });
      navigate('/auth', { replace: true });
    } catch (err) {
      // Aqui o erro é útil para o usuário: quase sempre é link expirado ou já usado.
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
