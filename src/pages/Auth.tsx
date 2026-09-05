import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/i18n/LanguageContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Zap } from 'lucide-react';
import { avisoDeErro } from '@/lib/erros';

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, signUp } = useAuth();
  const { t } = useLanguage();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        await signIn(email, password);
      } else {
        await signUp(email, password, displayName);
        // No Supabase o próprio signUp dispara o e-mail de confirmação (GoTrue),
        // então não há chamada extra aqui — só a mensagem, que antes vinha
        // fixa em inglês e agora passa pelo i18n.
        toast({
          title: t('signup'),
          description: t('signupSuccess'),
        });
      }
    } catch (error: any) {
      // O contexto importa: o mesmo "não consegui falar com o servidor" tem
      // significados diferentes entrando e criando conta.
      const aviso = avisoDeErro(error, isLogin ? t('login') : t('signup'));
      toast({
        title: aviso.titulo,
        description: aviso.descricao,
        variant: 'destructive',
      });
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
          <CardTitle className="font-display text-3xl font-bold tracking-tight">
            EisenFlow
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('welcomeDesc')}
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {!isLogin && (
              <Input
                placeholder={t('displayName')}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            )}
            <Input
              type="email"
              placeholder={t('email')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              type="password"
              placeholder={t('password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '...' : isLogin ? t('login') : t('signup')}
            </Button>
            <button
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {isLogin ? t('noAccount') : t('hasAccount')}
            </button>
            {isLogin && (
              <Link
                to="/auth/forgot"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {t('forgotPassword')}
              </Link>
            )}
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
