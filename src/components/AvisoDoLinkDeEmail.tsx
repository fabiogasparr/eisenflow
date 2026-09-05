import { useEffect, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { idiomaAtual } from '@/lib/erros';
import { lerResultadoDoLinkDeEmail } from '@/lib/hashInicial';

/**
 * Quem clica no link de confirmação volta para a raiz do app com um fragmento
 * (#access_token=... ou #error=...). O supabase-js consome o fragmento em
 * silêncio, então o usuário só via a URL terminar em "/#" e nenhuma explicação —
 * nem quando o link estava expirado. Aqui esse resultado vira uma mensagem.
 */
export function AvisoDoLinkDeEmail() {
  const { toast } = useToast();
  const jaAvisou = useRef(false);

  useEffect(() => {
    if (jaAvisou.current) return;
    const r = lerResultadoDoLinkDeEmail();
    if (r.tipo === 'nenhum') return;
    jaAvisou.current = true;

    const pt = idiomaAtual() === 'pt-BR';

    if (r.tipo === 'sucesso') {
      const cadastro = r.acao === 'signup';
      toast({
        title: cadastro
          ? pt ? 'E-mail confirmado' : 'E-mail confirmed'
          : pt ? 'Tudo certo' : 'All set',
        description: cadastro
          ? pt
            ? 'Sua conta está ativa e você já está dentro do EisenFlow.'
            : 'Your account is active and you are signed in.'
          : pt
            ? 'Link validado com sucesso.'
            : 'Link validated successfully.',
      });
      return;
    }

    const expirado =
      (r.codigo ?? '').includes('expired') || (r.descricao ?? '').toLowerCase().includes('expired');

    toast({
      variant: 'destructive',
      title: expirado
        ? pt ? 'Link expirado' : 'Link expired'
        : pt ? 'O link não pôde ser usado' : 'The link could not be used',
      description: expirado
        ? pt
          ? 'Links de e-mail valem por tempo limitado e uma única vez. Faça login para receber um novo.'
          : 'E-mail links are single-use and time limited. Sign in to get a new one.'
        : pt
          ? `O servidor recusou o link${r.descricao ? `: ${r.descricao}` : ''}. Tente entrar normalmente.`
          : `The server rejected the link${r.descricao ? `: ${r.descricao}` : ''}. Try signing in.`,
    });
  }, [toast]);

  return null;
}

export default AvisoDoLinkDeEmail;
