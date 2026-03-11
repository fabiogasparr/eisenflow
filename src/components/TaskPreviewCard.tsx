import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Clock, User } from 'lucide-react';
import { useLanguage } from '@/i18n/LanguageContext';

export interface TaskSuggestion {
  title: string;
  description?: string;
  quadrant: 'do' | 'schedule' | 'delegate' | 'eliminate';
  urgency: number;
  importance: number;
  estimated_time?: number;
  assigned_to_id?: string;
  assigned_to_name?: string;
  project_id?: string;
  selected: boolean;
}

const quadrantConfig = {
  do: { label: 'doNow', color: 'bg-destructive/10 text-destructive border-destructive/20' },
  schedule: { label: 'schedule', color: 'bg-primary/10 text-primary border-primary/20' },
  delegate: { label: 'delegate', color: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
  eliminate: { label: 'eliminate', color: 'bg-muted text-muted-foreground border-border' },
} as const;

interface TaskPreviewCardProps {
  task: TaskSuggestion;
  index: number;
  onToggle: (index: number) => void;
}

export function TaskPreviewCard({ task, index, onToggle }: TaskPreviewCardProps) {
  const { t } = useLanguage();
  const config = quadrantConfig[task.quadrant];

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border p-3 transition-opacity ${
        task.selected ? 'opacity-100' : 'opacity-50'
      }`}
    >
      <Checkbox
        checked={task.selected}
        onCheckedChange={() => onToggle(index)}
        className="mt-0.5"
      />
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-sm font-medium leading-tight">{task.title}</p>
        {task.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{task.description}</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${config.color}`}>
            {t(config.label as any)}
          </Badge>
          {task.estimated_time && (
            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <Clock className="h-3 w-3" /> {task.estimated_time}{t('minutes')}
            </span>
          )}
          {task.assigned_to_name && (
            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <User className="h-3 w-3" /> {task.assigned_to_name}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
