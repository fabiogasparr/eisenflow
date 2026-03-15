import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTeamInvites } from '@/hooks/useTeams';
import { useLanguage } from '@/i18n/LanguageContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Users, CheckCircle, XCircle, Loader2 } from 'lucide-react';

export default function JoinTeamPage() {
  const { code } = useParams<{ code: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const pt = language === 'pt-BR';
  const { acceptInvite } = useTeamInvites(null);
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'needs-auth'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setStatus('needs-auth');
      return;
    }

    if (!code) {
      setStatus('error');
      setErrorMsg(pt ? 'Código de convite inválido' : 'Invalid invite code');
      return;
    }

    // Auto-accept invite
    acceptInvite.mutateAsync(code)
      .then(() => setStatus('success'))
      .catch((err) => {
        setStatus('error');
        setErrorMsg(err.message);
      });
  }, [user, authLoading, code]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
          {status === 'loading' && (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-muted-foreground">{pt ? 'Entrando no time...' : 'Joining team...'}</p>
            </>
          )}

          {status === 'needs-auth' && (
            <>
              <Users className="h-10 w-10 text-primary" />
              <h2 className="font-display text-xl font-bold">
                {pt ? 'Convite para Time' : 'Team Invitation'}
              </h2>
              <p className="text-sm text-muted-foreground text-center">
                {pt
                  ? 'Você precisa estar logado para aceitar este convite. Faça login ou crie sua conta.'
                  : 'You need to be logged in to accept this invitation. Sign in or create an account.'}
              </p>
              <Button
                className="w-full"
                onClick={() => navigate(`/auth?redirect=/invite/${code}`)}
              >
                {pt ? 'Fazer Login / Criar Conta' : 'Sign In / Create Account'}
              </Button>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircle className="h-10 w-10 text-green-500" />
              <h2 className="font-display text-xl font-bold">
                {pt ? 'Você entrou no time!' : 'You joined the team!'}
              </h2>
              <p className="text-sm text-muted-foreground text-center">
                {pt ? 'Agora você pode colaborar com sua equipe.' : 'You can now collaborate with your team.'}
              </p>
              <Button onClick={() => navigate('/teams')} className="w-full">
                {pt ? 'Ir para Times' : 'Go to Teams'}
              </Button>
            </>
          )}

          {status === 'error' && (
            <>
              <XCircle className="h-10 w-10 text-destructive" />
              <h2 className="font-display text-xl font-bold">
                {pt ? 'Erro ao entrar' : 'Failed to join'}
              </h2>
              <p className="text-sm text-muted-foreground text-center">{errorMsg}</p>
              <Button variant="outline" onClick={() => navigate('/teams')} className="w-full">
                {pt ? 'Voltar para Times' : 'Back to Teams'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
