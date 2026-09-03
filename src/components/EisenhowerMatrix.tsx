import type { ReactNode } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import type { Quadrant } from '@/types/task';

/**
 * A matriz de Eisenhower propriamente dita.
 *
 * POR QUE ESTE COMPONENTE EXISTE
 * Antes os quatro quadrantes eram só uma `grid grid-cols-2` de cartões iguais.
 * Isso não é uma matriz — são quatro caixas. O que faz a ferramenta de
 * Eisenhower funcionar são os DOIS EIXOS: a posição de uma tarefa carrega a
 * informação de por que ela está ali (urgência no eixo X, importância no Y).
 * Sem os eixos visíveis, o usuário lê quatro listas e perde a lógica.
 *
 * Os rótulos dos eixos aparecem de md para cima. No celular a grade vira uma
 * coluna só, onde eixo não faz sentido — lá cada quadrante já se identifica
 * pelo próprio cabeçalho.
 */
interface Props {
  /** Recebe o quadrante e devolve o painel correspondente. */
  children: (quadrant: Quadrant) => ReactNode;
}

/** Ordem de leitura da matriz: linha de cima = importante; coluna da esquerda = urgente. */
const ORDEM: Quadrant[] = ['do', 'schedule', 'delegate', 'eliminate'];

export function EisenhowerMatrix({ children }: Props) {
  const { t } = useLanguage();

  return (
    <div className="flex-1 min-h-0 md:grid md:grid-cols-[1.25rem_1fr] md:grid-rows-[1.25rem_1fr] md:gap-x-2 md:gap-y-1.5">
      {/* canto vazio, onde os dois eixos se encontram */}
      <div className="hidden md:block" aria-hidden />

      {/* eixo X — urgência */}
      <div className="hidden md:grid grid-cols-2 gap-3" aria-hidden>
        {[t('axisUrgent'), t('axisNotUrgent')].map((rotulo) => (
          <span
            key={rotulo}
            className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70 text-center leading-5"
          >
            {rotulo}
          </span>
        ))}
      </div>

      {/* eixo Y — importância. Rotacionado para ocupar a lateral sem roubar largura. */}
      <div className="hidden md:grid grid-rows-2 gap-3" aria-hidden>
        {[t('axisImportant'), t('axisNotImportant')].map((rotulo) => (
          <span
            key={rotulo}
            className="flex items-center justify-center text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70"
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
          >
            {rotulo}
          </span>
        ))}
      </div>

      {/* a grade dos quatro quadrantes */}
      <div className="grid flex-1 min-h-0 grid-cols-1 grid-rows-none gap-2 sm:grid-cols-2 md:grid-rows-2 md:gap-3">
        {ORDEM.map((q) => children(q))}
      </div>
    </div>
  );
}
