import { Zap, CalendarClock, UserPlus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TaskPreviewCard, type TaskSuggestion } from '@/components/TaskPreviewCard';
import { useLanguage } from '@/i18n/LanguageContext';

type Quadrant = TaskSuggestion['quadrant'];

const QUADRANT_ORDER: Quadrant[] = ['do', 'schedule', 'delegate', 'eliminate'];

const QUADRANT_META: Record<
  Quadrant,
  { icon: typeof Zap; labelKey: string; chip: string; ring: string }
> = {
  do: {
    icon: Zap,
    labelKey: 'doNow',
    chip: 'bg-destructive/10 text-destructive border-destructive/20',
    ring: 'border-l-destructive',
  },
  schedule: {
    icon: CalendarClock,
    labelKey: 'schedule',
    chip: 'bg-primary/10 text-primary border-primary/20',
    ring: 'border-l-primary',
  },
  delegate: {
    icon: UserPlus,
    labelKey: 'delegate',
    chip: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    ring: 'border-l-amber-500',
  },
  eliminate: {
    icon: Trash2,
    labelKey: 'eliminate',
    chip: 'bg-muted text-muted-foreground border-border',
    ring: 'border-l-muted-foreground/50',
  },
};

interface Props {
  tasks: TaskSuggestion[];
  /** Toggles the task at its absolute index in the original `tasks` array */
  onToggle: (absoluteIndex: number) => void;
  /** Toggles all tasks in a quadrant on/off based on current selection majority */
  onToggleQuadrant: (quadrant: Quadrant, nextSelected: boolean) => void;
}

export function EisenhowerTaskGroups({ tasks, onToggle, onToggleQuadrant }: Props) {
  const { t, language } = useLanguage();
  const pt = language === 'pt-BR';

  // Index tasks by quadrant while keeping their original index
  const grouped = QUADRANT_ORDER.map((q) => ({
    quadrant: q,
    items: tasks
      .map((task, absoluteIndex) => ({ task, absoluteIndex }))
      .filter(({ task }) => task.quadrant === q),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-3">
      {grouped.map(({ quadrant, items }) => {
        const meta = QUADRANT_META[quadrant];
        const Icon = meta.icon;
        const selectedCount = items.filter(({ task }) => task.selected).length;
        const allSelected = selectedCount === items.length;
        return (
          <section
            key={quadrant}
            className={`rounded-lg border border-l-4 ${meta.ring} bg-card/40`}
          >
            <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/60">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${meta.chip}`}
                >
                  <Icon className="h-3 w-3" />
                  {t(meta.labelKey as any)}
                </span>
                <span className="text-xs text-muted-foreground truncate">
                  {selectedCount}/{items.length}{' '}
                  {pt ? 'selecionada(s)' : 'selected'}
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => onToggleQuadrant(quadrant, !allSelected)}
              >
                {allSelected
                  ? pt
                    ? 'Desmarcar tudo'
                    : 'Unselect all'
                  : pt
                  ? 'Selecionar tudo'
                  : 'Select all'}
              </Button>
            </header>
            <div className="p-2 space-y-2">
              {items.map(({ task, absoluteIndex }) => (
                <TaskPreviewCard
                  key={absoluteIndex}
                  task={task}
                  index={absoluteIndex}
                  onToggle={onToggle}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
