import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useLanguage } from '@/i18n/LanguageContext';
import { TaskCard } from './TaskCard';
import { QUADRANT_CONFIG, type Quadrant, type Task } from '@/types/task';
import { ScrollArea } from '@/components/ui/scroll-area';

interface QuadrantDropZoneProps {
  quadrant: Quadrant;
  tasks: Task[];
  onTaskClick?: (task: Task) => void;
  onComplete?: (task: Task) => void;
  onDelete?: (task: Task) => void;
}

export function QuadrantDropZone({ quadrant, tasks, onTaskClick, onComplete, onDelete }: QuadrantDropZoneProps) {
  const { t } = useLanguage();
  const config = QUADRANT_CONFIG[quadrant];

  const { isOver, setNodeRef } = useDroppable({ id: quadrant });

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-xl border-2 transition-all overflow-hidden ${
        isOver
          ? `border-quadrant-${quadrant} bg-quadrant-${quadrant}-bg shadow-lg`
          : 'border-border bg-card/50'
      }`}
    >
      <div className={`flex items-center gap-2 px-3 py-2 md:px-4 md:py-3 border-b bg-quadrant-${quadrant}-bg`}>
        <span className="text-lg">{config.emoji}</span>
        <div>
          <h3 className={`font-display text-sm font-bold text-quadrant-${quadrant}`}>
            {t(config.labelKey)}
          </h3>
          <p className="text-xs text-muted-foreground hidden sm:block">{t(config.descKey)}</p>
        </div>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold bg-quadrant-${quadrant}/10 text-quadrant-${quadrant}`}>
          {tasks.length}
        </span>
      </div>
      <ScrollArea className="flex-1 p-2 md:p-3 min-h-[80px] max-h-[35vh] md:max-h-[calc(50vh-80px)]">
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1.5 md:space-y-2">
            {tasks.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-4">{t('noTasks')}</p>
            ) : (
              tasks.map((task) => (
                <TaskCard key={task.id} task={task} onClick={onTaskClick} onComplete={onComplete} onDelete={onDelete} />
              ))
            )}
          </div>
        </SortableContext>
      </ScrollArea>
    </div>
  );
}
