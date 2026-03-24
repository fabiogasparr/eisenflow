import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, RefreshCw, CalendarIcon, CheckCircle, Trash2 } from 'lucide-react';
import type { Task } from '@/types/task';
import { useLanguage } from '@/i18n/LanguageContext';
import { format, isPast, isToday } from 'date-fns';
import { useSwipeGesture } from '@/hooks/useSwipeGesture';

const QUADRANT_BORDER_COLORS: Record<string, string> = {
  do: 'border-l-quadrant-do',
  schedule: 'border-l-quadrant-schedule',
  delegate: 'border-l-quadrant-delegate',
  eliminate: 'border-l-quadrant-eliminate',
};

interface TaskCardProps {
  task: Task;
  onClick?: (task: Task) => void;
  onComplete?: (task: Task) => void;
  onDelete?: (task: Task) => void;
}

export function TaskCard({ task, onClick, onComplete, onDelete }: TaskCardProps) {
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

  const { offsetX, isSwiping, dismissed, handlers } = useSwipeGesture({
    threshold: 80,
    disabled: isDragging || isCompleted,
    onSwipeRight: () => onComplete?.(task),
    onSwipeLeft: () => onDelete?.(task),
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : isCompleted ? 0.6 : 1,
  };

  const dueDateInfo = task.due_date ? (() => {
    const d = new Date(task.due_date);
    const overdue = isPast(d) && !isToday(d) && !isCompleted;
    const today = isToday(d);
    return { label: format(d, 'dd/MM'), overdue, today };
  })() : null;

  const swipeProgress = Math.min(Math.abs(offsetX) / 80, 1);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative overflow-hidden rounded-lg"
    >
      {/* Swipe backgrounds */}
      {(isSwiping || dismissed) && (
        <>
          {/* Right swipe - Complete (green) */}
          <div
            className="absolute inset-0 flex items-center pl-4 rounded-lg bg-emerald-500/90"
            style={{ opacity: offsetX > 0 ? swipeProgress : 0 }}
          >
            <CheckCircle className="h-5 w-5 text-white" />
          </div>
          {/* Left swipe - Delete (red) */}
          <div
            className="absolute inset-0 flex items-center justify-end pr-4 rounded-lg bg-destructive/90"
            style={{ opacity: offsetX < 0 ? swipeProgress : 0 }}
          >
            <Trash2 className="h-5 w-5 text-white" />
          </div>
        </>
      )}

      {/* Card content */}
      <div
        {...handlers}
        className={`relative border-l-4 border bg-card p-2.5 shadow-sm hover:shadow-md transition-shadow cursor-pointer rounded-lg ${borderColor} ${
          isDragging ? 'ring-2 ring-primary z-50' : ''
        } ${isInProgress ? 'ring-1 ring-primary/30' : ''}`}
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: isSwiping ? 'none' : 'transform 0.25s ease-out',
        }}
        onClick={() => !isSwiping && !dismissed && onClick?.(task)}
      >
        <div className="flex items-center gap-2">
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab opacity-60 md:opacity-0 md:group-hover:opacity-60 transition-opacity shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <p className={`text-sm font-medium leading-tight truncate flex-1 ${
            isCompleted ? 'line-through text-muted-foreground' : ''
          }`}>
            {task.title}
          </p>
          <div className="flex items-center gap-1.5 shrink-0">
            {task.recurrence_rule && (
              <RefreshCw className="h-3 w-3 text-muted-foreground" />
            )}
            {dueDateInfo && (
              <span className={`flex items-center gap-0.5 text-[10px] font-medium ${
                dueDateInfo.overdue ? 'text-destructive' : dueDateInfo.today ? 'text-primary' : 'text-muted-foreground'
              }`}>
                <CalendarIcon className="h-2.5 w-2.5" />
                {dueDateInfo.label}
              </span>
            )}
            {isInProgress && (
              <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary"></span>
                </span>
                {t('inProgress') ?? 'Em progresso'}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
