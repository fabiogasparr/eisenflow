import { useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { QUADRANT_CONFIG, type Task } from '@/types/task';
import { CheckCircle, Trash2, Play, Clock, UserPlus, Plus, X, RefreshCw, CalendarIcon, Timer, Pencil } from 'lucide-react';
import { format } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { useTeams, useTeamMembers } from '@/hooks/useTeams';
import { useSubtasks } from '@/hooks/useSubtasks';

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
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');

  const { subtasks, addSubtask, toggleSubtask, deleteSubtask, completedCount, totalCount } = useSubtasks(task?.id ?? null);

  if (!task) return null;

  const config = QUADRANT_CONFIG[task.quadrant];
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const handleAddSubtask = () => {
    if (!newSubtaskTitle.trim()) return;
    addSubtask.mutate({ title: newSubtaskTitle.trim(), position: totalCount });
    setNewSubtaskTitle('');
  };

  const recurrenceLabel = task.recurrence_rule
    ? t(task.recurrence_rule === 'daily' ? 'recurrenceDaily' : task.recurrence_rule === 'weekly' ? 'recurrenceWeekly' : 'recurrenceMonthly')
    : null;

  return (
    <Sheet open={!!task} onOpenChange={() => onClose()}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <span className="text-2xl">{config.emoji}</span>
            <Badge variant="outline" className={`text-quadrant-${task.quadrant}`}>
              {t(config.labelKey)}
            </Badge>
            {recurrenceLabel && (
              <Badge variant="secondary" className="gap-1">
                <RefreshCw className="h-3 w-3" />
                {recurrenceLabel}
              </Badge>
            )}
          </div>
          <SheetTitle className="font-display text-xl">{task.title}</SheetTitle>
          <SheetDescription>{task.description}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* Due Date - editable */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{pt ? 'Prazo' : 'Due date'}</Label>
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "justify-start text-left font-normal flex-1",
                      !task.due_date && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {task.due_date ? format(new Date(task.due_date), 'PPP p') : (pt ? 'Definir prazo' : 'Set due date')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={task.due_date ? new Date(task.due_date) : undefined}
                    onSelect={(date) => {
                      if (date) {
                        // Preserve time if existing, otherwise use current time
                        const existing = task.due_date ? new Date(task.due_date) : new Date();
                        date.setHours(existing.getHours(), existing.getMinutes());
                        onUpdate({ due_date: date.toISOString() });
                      }
                    }}
                    className={cn("p-3 pointer-events-auto")}
                  />
                  <div className="px-3 pb-3 flex gap-2 items-center">
                    <Label className="text-xs whitespace-nowrap">{pt ? 'Hora:' : 'Time:'}</Label>
                    <Input
                      type="time"
                      className="h-8 text-sm w-auto"
                      defaultValue={task.due_date ? format(new Date(task.due_date), 'HH:mm') : '09:00'}
                      onChange={(e) => {
                        const [h, m] = e.target.value.split(':').map(Number);
                        const d = task.due_date ? new Date(task.due_date) : new Date();
                        d.setHours(h, m, 0, 0);
                        onUpdate({ due_date: d.toISOString() });
                      }}
                    />
                  </div>
                </PopoverContent>
              </Popover>
              {task.due_date && (
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => onUpdate({ due_date: null })}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Estimated Time - editable */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{pt ? 'Tempo estimado (min)' : 'Estimated time (min)'}</Label>
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-muted-foreground" />
              <Input
                type="number"
                min={0}
                className="h-8 text-sm w-24"
                defaultValue={task.estimated_time ?? ''}
                placeholder="0"
                onBlur={(e) => {
                  const val = e.target.value ? parseInt(e.target.value, 10) : null;
                  if (val !== task.estimated_time) {
                    onUpdate({ estimated_time: val });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
              />
              <span className="text-xs text-muted-foreground">min</span>
            </div>
          </div>

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

          {task.impact_score != null && task.impact_score > 0 && (
            <div className="rounded-lg bg-secondary p-3 text-sm">
              <p className="text-muted-foreground">{t('impact')}</p>
              <p className="font-semibold text-lg">{task.impact_score}/100</p>
            </div>
          )}

          {/* Subtasks / Checklist */}
          <div className="space-y-3 pt-3 border-t">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{t('subtasks')}</p>
              {totalCount > 0 && (
                <span className="text-xs text-muted-foreground">{completedCount}/{totalCount} ({progressPercent}%)</span>
              )}
            </div>
            {totalCount > 0 && (
              <Progress value={progressPercent} className="h-2" />
            )}
            <div className="space-y-1.5">
              {subtasks.map((sub) => (
                <div key={sub.id} className="flex items-center gap-2 group">
                  <Checkbox
                    checked={sub.completed}
                    onCheckedChange={(checked) =>
                      toggleSubtask.mutate({ id: sub.id, completed: !!checked })
                    }
                  />
                  <span className={`text-sm flex-1 ${sub.completed ? 'line-through text-muted-foreground' : ''}`}>
                    {sub.title}
                  </span>
                  <button
                    onClick={() => deleteSubtask.mutate(sub.id)}
                    className="opacity-0 group-hover:opacity-60 transition-opacity"
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={newSubtaskTitle}
                onChange={(e) => setNewSubtaskTitle(e.target.value)}
                placeholder={t('addSubtask')}
                className="h-8 text-sm"
                onKeyDown={(e) => e.key === 'Enter' && handleAddSubtask()}
              />
              <Button size="sm" variant="outline" onClick={handleAddSubtask} disabled={!newSubtaskTitle.trim()}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Recurrence */}
          {task.recurrence_rule && (
            <div className="pt-3 border-t">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => onUpdate({ recurrence_rule: null } as any)}
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                {pt ? 'Remover recorrência' : 'Remove recurrence'}
              </Button>
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
