import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

/**
 * Por que este arquivo existe:
 *
 * O supabase-js guarda os canais por *tópico*. Quando dois componentes pediam
 * `supabase.channel('tasks-realtime-<uid>')`, o segundo recebia de volta o canal
 * do primeiro — que já tinha passado por `.subscribe()`. Chamar `.on()` num canal
 * já assinado lança "cannot add postgres_changes callbacks ... after subscribe()".
 * O erro subia de dentro de um useEffect, o React não tinha nenhum ErrorBoundary
 * para segurá-lo e desmontava a árvore inteira: tela preta, sem nenhuma mensagem.
 *
 * A correção é dar a cada instância do hook o seu próprio tópico, e nunca deixar
 * uma falha de realtime derrubar a aplicação — realtime é conveniência, não
 * requisito para a tela funcionar.
 */

let contador = 0;

/** Identificador estável enquanto o componente vive, único entre instâncias. */
export function useIdDeInstancia(): string {
  const ref = useRef<string>('');
  if (!ref.current) {
    contador += 1;
    ref.current = `${contador}${Math.random().toString(36).slice(2, 7)}`;
  }
  return ref.current;
}

/**
 * Assina um canal de realtime com tópico exclusivo desta instância.
 *
 * @param nomeBase  prefixo do tópico; passe null para não assinar nada
 * @param montar    registra os handlers no canal e devolve o próprio canal
 * @param deps      dependências que devem refazer a assinatura
 */
export function useCanalRealtime(
  nomeBase: string | null | undefined,
  montar: (canal: RealtimeChannel) => RealtimeChannel,
  deps: unknown[] = [],
): void {
  const id = useIdDeInstancia();
  const montarRef = useRef(montar);
  montarRef.current = montar;

  useEffect(() => {
    if (!nomeBase) return undefined;

    let canal: RealtimeChannel | undefined;
    try {
      canal = supabase.channel(`${nomeBase}-${id}`);
      montarRef.current(canal).subscribe();
    } catch (erro) {
      // Degrada em silêncio: a tela segue funcionando, só não atualiza sozinha.
      console.error('[realtime] não foi possível assinar', nomeBase, erro);
      if (canal) {
        try {
          supabase.removeChannel(canal);
        } catch {
          /* nada a fazer */
        }
      }
      return undefined;
    }

    return () => {
      try {
        supabase.removeChannel(canal!);
      } catch {
        /* canal já removido */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nomeBase, id, ...deps]);
}
