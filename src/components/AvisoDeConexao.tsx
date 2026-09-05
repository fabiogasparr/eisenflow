import { useEffect, useState } from 'react';
import { EVENTO_FALHA_DE_REDE, hostDaApi, idiomaAtual } from '@/lib/erros';

type Estado = 'ok' | 'offline' | 'servidor-mudo';

/**
 * Faixa fina no topo quando o navegador está sem rede ou quando o servidor
 * parou de responder. Antes disso, a única pista que o usuário tinha era um
 * toast de dois segundos escrito "Failed to fetch".
 */
export function AvisoDeConexao() {
  const [estado, setEstado] = useState<Estado>('ok');
  const pt = idiomaAtual() === 'pt-BR';

  useEffect(() => {
    const offline = () => setEstado('offline');
    const online = () => setEstado('ok');
    const falhou = () => setEstado((e) => (e === 'offline' ? e : 'servidor-mudo'));

    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    window.addEventListener(EVENTO_FALHA_DE_REDE, falhou);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) offline();

    return () => {
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      window.removeEventListener(EVENTO_FALHA_DE_REDE, falhou);
    };
  }, []);

  // Enquanto houver aviso, testamos o servidor de tempos em tempos e sumimos
  // sozinhos quando ele voltar — sem obrigar o usuário a recarregar.
  useEffect(() => {
    if (estado === 'ok') return undefined;
    let vivo = true;
    const tentar = async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      try {
        const base = import.meta.env.VITE_SUPABASE_URL as string;
        const chave = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
        const r = await fetch(`${base}/auth/v1/health`, { headers: { apikey: chave } });
        if (vivo && r.ok) setEstado('ok');
      } catch {
        /* segue mostrando o aviso */
      }
    };
    const id = window.setInterval(tentar, 8000);
    tentar();
    return () => {
      vivo = false;
      window.clearInterval(id);
    };
  }, [estado]);

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
      role="status"
      className="fixed inset-x-0 top-0 z-[100] bg-destructive px-4 py-1.5 text-center text-xs font-medium text-destructive-foreground shadow"
    >
      {texto}
    </div>
  );
}

export default AvisoDeConexao;
