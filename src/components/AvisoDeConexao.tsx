import { useCallback, useEffect, useState } from 'react';
import { EVENTO_FALHA_DE_REDE, hostDaApi, idiomaAtual } from '@/lib/erros';

type Estado = 'ok' | 'offline' | 'servidor-mudo';

/**
 * Faixa fina no topo quando o navegador está sem rede ou quando o servidor
 * parou de responder. Antes disso, a única pista que o usuário tinha era um
 * toast de poucos segundos escrito "Failed to fetch".
 *
 * A faixa nunca aparece por um tropeço isolado: ao receber o aviso de falha
 * ela primeiro confere o servidor, e só se mostra se a confirmação também
 * falhar. Some sozinha assim que ele volta.
 */
export function AvisoDeConexao() {
  const [estado, setEstado] = useState<Estado>('ok');
  const pt = idiomaAtual() === 'pt-BR';

  const conferir = useCallback(async (): Promise<boolean> => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    try {
      const base = import.meta.env.VITE_SUPABASE_URL as string;
      const chave = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
      const r = await fetch(`${base}/auth/v1/health`, { headers: { apikey: chave } });
      return r.status < 500;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    let vivo = true;
    const offline = () => vivo && setEstado('offline');
    const online = () => vivo && setEstado('ok');
    const falhou = async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return offline();
      const ok = await conferir();
      if (vivo && !ok) setEstado('servidor-mudo');
    };

    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    window.addEventListener(EVENTO_FALHA_DE_REDE, falhou);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) offline();

    return () => {
      vivo = false;
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      window.removeEventListener(EVENTO_FALHA_DE_REDE, falhou);
    };
  }, [conferir]);

  // Enquanto a faixa estiver visível, insistimos de tempos em tempos e sumimos
  // sozinhos quando o servidor voltar — sem obrigar o usuário a recarregar.
  useEffect(() => {
    if (estado === 'ok') return undefined;
    let vivo = true;
    const id = window.setInterval(async () => {
      if (await conferir()) {
        if (vivo) setEstado('ok');
      }
    }, 8000);
    return () => {
      vivo = false;
      window.clearInterval(id);
    };
  }, [estado, conferir]);

  if (estado === 'ok') return null;

  const texto =
    estado === 'offline'
      ? pt
        ? 'Você está sem internet. As alterações não estão sendo salvas.'
        : 'You are offline. Changes are not being saved.'
      : pt
        ? `Sem resposta de ${hostDaApi()}. Tentando reconectar…`
        : `No answer from ${hostDaApi()}. Reconnecting…`;

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[100] bg-destructive px-4 py-1.5 text-center text-xs font-medium text-destructive-foreground shadow"
    >
      {texto}
    </div>
  );
}

export default AvisoDeConexao;
