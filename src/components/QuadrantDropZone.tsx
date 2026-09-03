import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useLanguage } from '@/i18n/LanguageContext';
import { TaskCard } from './TaskCard';
import { QUADRANT_CONFIG, type Quadrant, type Task } from '@/types/task';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronDown, TriangleAlert } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

interface QuadrantDropZoneProps {
  quadrant: Quadrant;
  tasks: Task[];
  onTaskClick?: (task: Task) => void;
  onComplete?: (task: Task) => void;
  onDelete?: (task: Task) => void;
  defaultCollapsed?: boolean;
}

/**
 * PESO VISUAL POR QUADRANTE
 *
 * Quatro quadrantes com a mesma presença visual anulam o propósito da matriz:
 * se tudo pesa igual, o usuário volta a ter uma lista e precisa decidir sozinho
 * onde olhar — exatamente o problema que a ferramenta deveria resolver.
 *
 * Aqui a hierarquia é explícita: "Fazer Agora" domina, "Eliminar" recua. A tela
 * passa a dizer para onde olhar antes de o usuário ler qualquer palavra.
 */
const PESO: Record<Quadrant, { moldura: string; cabecalho: string; corpo: string; contador: string }> = {
  do: {
    moldura: 'border-2 border-quadrant-do/70 shadow-sm',
    cabecalho: 'bg-quadrant-do-bg',
    corpo: '',
    contador: 'bg-quadrant-do text-background',
  },
  schedule: {
    moldura: 'border border-quadrant-schedule/45',
    cabecalho: 'bg-quadrant-schedule-bg/70',
    corpo: '',
    contador: 'bg-quadrant-schedule/15 text-quadrant-schedule',
  },
  delegate: {
    moldura: 'border border-quadrant-delegate/35',
    cabecalho: 'bg-quadrant-delegate-bg/50',
    corpo: '',
    contador: 'bg-quadrant-delegate/15 text-quadrant-delegate',
  },
  eliminate: {
    // Recua de propósito: é o quadrante que o usuário deveria olhar por último.
    moldura: 'border border-border/60',
    cabecalho: 'bg-muted/30',
    corpo: 'opacity-75 hover:opacity-100 focus-within:opacity-100 transition-opacity',
    contador: 'bg-muted text-muted-foreground',
  },
};

/** Frase que ensina o que pertence a cada quadrante, no lugar de "Nenhuma tarefa". */
const DICA_VAZIA: Record<Quadrant, string> = {
  do: 'emptyDo',
  schedule: 'emptySchedule',
  delegate: 'emptyDelegate',
  eliminate: 'emptyEliminate',
};

/**
 * Acima disto, "Fazer Agora" deixa de ser prioridade e vira uma lista de
 * aflições. É o diagnóstico que a matriz de Eisenhower existe para dar, então
 * vale dizer em voz alta em vez de deixar o número crescer em silêncio.
 */
const LIMITE_SOBRECARGA = 5;

export function QuadrantDropZone({ quadrant, tasks, onTaskClick, onComplete, onDelete, defaultCollapsed = false }: QuadrantDropZoneProps) {
  const { t } = useLanguage();
  const config = QUADRANT_CONFIG[quadrant];
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(isMobile ? defaultCollapsed : false);

  const { isOver, setNodeRef } = useDroppable({ id: quadrant });
  const peso = PESO[quadrant];
  const sobrecarregado = quadrant === 'do' && tasks.length > LIMITE_SOBRECARGA;

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl bg-card/50 transition-all ${
        isOver ? `border-2 border-quadrant-${quadrant} bg-quadrant-${quadrant}-bg shadow-lg` : peso.moldura
      } ${peso.corpo}`}
    >
      <button
        type="button"
        onClick={() => isMobile && setCollapsed(!collapsed)}
        className={`flex w-full items-center gap-2 border-b px-3 py-2 text-left md:px-4 md:py-2.5 ${peso.cabecalho} ${isMobile ? 'active:opacity-80' : ''}`}
      >
        <span className="text-lg leading-none">{config.emoji}</span>
        <div className="min-w-0 flex-1">
          <h3 className={`font-display text-sm font-bold text-quadrant-${quadrant}`}>
            {t(config.labelKey)}
          </h3>
          <p className="hidden text-xs text-muted-foreground sm:block">{t(config.descKey)}</p>
        </div>

        {sobrecarregado && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive"
            title={t('overloadedHint')}
          >
            <TriangleAlert className="h-3 w-3" />
            <span className="hidden sm:inline">{t('overloaded')}</span>
          </span>
        )}

        <span className={`min-w-[1.5rem] rounded-full px-2 py-0.5 text-center text-xs font-semibold tabular-nums ${peso.contador}`}>
          {tasks.length}
        </span>

        {isMobile && (
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${collapsed ? '-rotate-90' : ''}`} />
        )}
      </button>

      {!collapsed && (
        <ScrollArea className="min-h-[80px] flex-1 p-2 md:p-3">
          <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5 md:space-y-2">
              {tasks.length === 0 ? (
                // Quadrante vazio é a maior área da tela num app novo. Em vez de
                // repetir "Nenhuma tarefa" quatro vezes, cada um ensina o que
                // pertence ali — vira a explicação da matriz sem tutorial.
                <p className="px-3 py-6 text-center text-xs leading-relaxed text-muted-foreground/80">
                  {t(DICA_VAZIA[quadrant] as never)}
                </p>
              ) : (
                tasks.map((task) => (
                  <TaskCard key={task.id} task={task} onClick={onTaskClick} onComplete={onComplete} onDelete={onDelete} />
                ))
              )}
            </div>
          </SortableContext>
        </ScrollArea>
      )}
    </div>
  );
}
