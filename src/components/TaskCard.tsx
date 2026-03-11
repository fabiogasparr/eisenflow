import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Clock, Tag } from 'lucide-react';
import type { Task } from '@/types/task';
import { QUADRANT_CONFIG } from '@/types/task';
import { useLanguage } from '@/i18n/LanguageContext';
import { format } from 'date-fns';

interface TaskCardProps {
  task: Task;
  onClick?: (task: Task) => void;
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const { t } = useLanguage();
  const config = QUADRANT_CONFIG[task.quadrant];

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
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group rounded-lg border bg-card p-3 shadow-sm hover:shadow-md transition-all cursor-pointer ${
        isDragging ? 'ring-2 ring-primary z-50' : ''
      }`}
      onClick={() => onClick?.(task)}
    >
      <div className="flex items-start gap-2">
        <button
          {...attributes}
          {...listeners}
          className="mt-0.5 cursor-grab opacity-0 group-hover:opacity-60 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium leading-tight truncate ${
            task.status === 'completed' ? 'line-through text-muted-foreground' : ''
          }`}>
            {task.title}
          </p>
          {task.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.description}</p>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {task.due_date && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {format(new Date(task.due_date), 'MMM dd')}
              </span>
            )}
            {task.estimated_time && (
              <span className="text-xs text-muted-foreground">
                {task.estimated_time}{t('minutes')}
              </span>
            )}
            {task.tags?.slice(0, 2).map((tag) => (
              <span key={tag} className="flex items-center gap-0.5 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                <Tag className="h-2.5 w-2.5" />
                {tag}
              </span>
            ))}
            {task.impact_score > 0 && (
              <span className={`text-xs font-medium text-quadrant-${config.colorClass.replace('quadrant-', '')}`}>
                {t('impact')}: {task.impact_score}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
