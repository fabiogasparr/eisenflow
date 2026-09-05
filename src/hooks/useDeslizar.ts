import { useRef } from 'react';

/**
 * Deslizar horizontal com o dedo.
 *
 * Só dispara quando o movimento é claramente horizontal — senão roubaria a
 * rolagem vertical da lista, que é o gesto mais usado. E como o arrastar de
 * tarefas do dnd-kit começa por um punho próprio (TouchSensor com atraso), os
 * dois gestos não brigam.
 */
export function useDeslizar({
  aoDeslizarEsquerda,
  aoDeslizarDireita,
  distanciaMinima = 60,
}: {
  aoDeslizarEsquerda?: () => void;
  aoDeslizarDireita?: () => void;
  distanciaMinima?: number;
}) {
  const inicio = useRef<{ x: number; y: number } | null>(null);

  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      inicio.current = t ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const i = inicio.current;
      inicio.current = null;
      const t = e.changedTouches[0];
      if (!i || !t) return;
      const dx = t.clientX - i.x;
      const dy = t.clientY - i.y;
      if (Math.abs(dx) < distanciaMinima) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.5) return; // rolagem vertical vence
      if (dx < 0) aoDeslizarEsquerda?.();
      else aoDeslizarDireita?.();
    },
  };
}
