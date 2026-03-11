import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { Task } from '@/types/task';
import { useLanguage } from '@/i18n/LanguageContext';

const QUADRANT_BORDER_COLORS: Record<string, string> = {
  do: 'border-l-quadrant-do',
  schedule: 'border-l-quadrant-schedule',
  delegate: 'border-l-quadrant-delegate',
  eliminate: 'border-l-quadrant-eliminate',
};

interface TaskCardProps {
  task: Task;
  onClick?: (task: Task) => void;
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const { t } = useLanguage();
  const borderColor = QUADRANT_BORDER_COLORS[task.quadrant] ?? '';
  const isInProgress = task.status === 'in_progress';
  const isCompleted = task.status === 'completed';

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { task } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : isCompleted ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group rounded-lg border-l-4 border bg-card p-2.5 shadow-sm hover:shadow-md transition-all cursor-pointer ${borderColor} ${
        isDragging ? 'ring-2 ring-primary z-50' : ''
      } ${isInProgress ? 'animate-pulse ring-1 ring-primary/30' : ''}`}
      onClick={() => onClick?.(task)}
    >
      <div className="flex items-center gap-2">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab opacity-0 group-hover:opacity-60 transition-opacity shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        <p className={`text-sm font-medium leading-tight truncate flex-1 ${
          isCompleted ? 'line-through text-muted-foreground' : ''
        }`}>
          {task.title}
        </p>
        {isInProgress && (
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
            {t('inProgress') ?? 'Em progresso'}
          </span>
        )}
      </div>
    </div>
  );
}
