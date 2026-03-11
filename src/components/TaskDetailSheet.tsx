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
  const { t, language } = useLanguage();
  const pt = language === 'pt-BR';
  const { teams } = useTeams();
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const { members } = useTeamMembers(selectedTeamId || null);

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

          {(task.started_at || task.completed_at) && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              {task.started_at && (
                <div className="rounded-lg bg-secondary p-3">
                  <p className="text-muted-foreground">{pt ? 'Iniciada em' : 'Started at'}</p>
                  <p className="font-semibold">{format(new Date(task.started_at), 'dd/MM/yy HH:mm')}</p>
                </div>
              )}
              {task.completed_at && (
                <div className="rounded-lg bg-secondary p-3">
                  <p className="text-muted-foreground">{pt ? 'Concluída em' : 'Completed at'}</p>
                  <p className="font-semibold">{format(new Date(task.completed_at), 'dd/MM/yy HH:mm')}</p>
                </div>
              )}
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

          {/* Delegate / Assign */}
          {teams.length > 0 && (
            <div className="space-y-3 pt-3 border-t">
              <p className="text-sm font-semibold flex items-center gap-2">
                <UserPlus className="h-4 w-4" />
                {pt ? 'Delegar tarefa' : 'Assign task'}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Select value={selectedTeamId} onValueChange={(v) => setSelectedTeamId(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder={pt ? 'Time' : 'Team'} />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={task.assigned_to || ''}
                  onValueChange={(v) => onUpdate({ assigned_to: v })}
                  disabled={!selectedTeamId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={pt ? 'Membro' : 'Member'} />
                  </SelectTrigger>
                  <SelectContent>
                    {members.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {m.profile?.display_name || (pt ? 'Usuário' : 'User')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
