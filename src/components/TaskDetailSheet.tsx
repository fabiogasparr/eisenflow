import { useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { QUADRANT_CONFIG, type Task } from '@/types/task';
import { CheckCircle, Trash2, Play, Clock, UserPlus } from 'lucide-react';
import { format } from 'date-fns';
import { useTeams, useTeamMembers } from '@/hooks/useTeams';

interface TaskDetailSheetProps {
  task: Task | null;
  onClose: () => void;
  onUpdate: (updates: Partial<Task>) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function TaskDetailSheet({ task, onClose, onUpdate, onDelete }: TaskDetailSheetProps) {
  const { t } = useLanguage();

  if (!task) return null;

  const config = QUADRANT_CONFIG[task.quadrant];

  return (
    <Sheet open={!!task} onOpenChange={() => onClose()}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <span className="text-2xl">{config.emoji}</span>
            <Badge variant="outline" className={`text-quadrant-${task.quadrant}`}>
              {t(config.labelKey)}
            </Badge>
          </div>
          <SheetTitle className="font-display text-xl">{task.title}</SheetTitle>
          <SheetDescription>{task.description}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {task.due_date && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              {format(new Date(task.due_date), 'PPP p')}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-secondary p-3">
              <p className="text-muted-foreground">{t('taskUrgency')}</p>
              <p className="font-semibold text-lg">{task.urgency}/5</p>
            </div>
            <div className="rounded-lg bg-secondary p-3">
              <p className="text-muted-foreground">{t('taskImportance')}</p>
              <p className="font-semibold text-lg">{task.importance}/5</p>
            </div>
          </div>

          {task.tags && task.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {task.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
              ))}
            </div>
          )}

          {task.impact_score > 0 && (
            <div className="rounded-lg bg-secondary p-3 text-sm">
              <p className="text-muted-foreground">{t('impact')}</p>
              <p className="font-semibold text-lg">{task.impact_score}/100</p>
            </div>
          )}

          <div className="flex flex-col gap-2 pt-4 border-t">
            {task.status !== 'in_progress' && task.status !== 'completed' && (
              <Button
                onClick={() => onUpdate({ status: 'in_progress' })}
                className="w-full gap-2"
                variant="outline"
              >
                <Play className="h-4 w-4" /> {t('start')}
              </Button>
            )}
            {task.status !== 'completed' && (
              <Button
                onClick={() => onUpdate({ status: 'completed' })}
                className="w-full gap-2"
              >
                <CheckCircle className="h-4 w-4" /> {t('complete')}
              </Button>
            )}
            <Button
              onClick={onDelete}
              variant="destructive"
              className="w-full gap-2"
            >
              <Trash2 className="h-4 w-4" /> {t('delete')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
