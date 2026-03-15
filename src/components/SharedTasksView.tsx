import { useLanguage } from '@/i18n/LanguageContext';
import { useSharedWithMe } from '@/hooks/useTaskShares';
import { QUADRANT_CONFIG } from '@/types/task';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Share2, Eye, Pencil, User } from 'lucide-react';
import type { Task } from '@/types/task';

interface SharedTasksViewProps {
  onTaskClick: (task: Task) => void;
}

export function SharedTasksView({ onTaskClick }: SharedTasksViewProps) {
  const { language } = useLanguage();
  const pt = language === 'pt-BR';
  const { sharedTasks, isLoading } = useSharedWithMe();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
        {pt ? 'Carregando...' : 'Loading...'}
      </div>
    );
  }

  if (sharedTasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
        <Share2 className="h-8 w-8 opacity-40" />
        <p className="text-sm">{pt ? 'Nenhuma tarefa compartilhada com você' : 'No tasks shared with you'}</p>
      </div>
    );
  }

  return (
    <ScrollArea className="max-h-[300px]">
      <div className="space-y-2 p-1">
        {sharedTasks.map((task: any) => {
          const config = QUADRANT_CONFIG[task.quadrant as keyof typeof QUADRANT_CONFIG];
          return (
            <div
              key={task.id}
              onClick={() => onTaskClick(task)}
              className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-sm hover:shadow-md transition-all cursor-pointer"
            >
              <span className="text-lg">{config.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{task.title}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <User className="h-3 w-3" />
                    {task._share?.shared_by_name}
                  </span>
                  <Badge variant="outline" className="text-xs gap-1">
                    {task._share?.permission === 'edit' ? (
                      <><Pencil className="h-2.5 w-2.5" /> {pt ? 'Editar' : 'Edit'}</>
                    ) : (
                      <><Eye className="h-2.5 w-2.5" /> {pt ? 'Ver' : 'View'}</>
                    )}
                  </Badge>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
