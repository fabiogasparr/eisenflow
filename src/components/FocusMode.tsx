import { useState, useMemo, useEffect } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { useTasks } from '@/hooks/useTasks';
import { useGamification } from '@/hooks/useGamification';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { QUADRANT_CONFIG, type Task } from '@/types/task';
import { X, CheckCircle, Play, Clock, Zap, Target, Timer } from 'lucide-react';
import { format } from 'date-fns';

interface FocusModeProps {
  open: boolean;
  onClose: () => void;
}

export function FocusMode({ open, onClose }: FocusModeProps) {
  const { t, language } = useLanguage();
  const { tasks, updateTask } = useTasks();
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);

  const doTasks = useMemo(
    () => tasks.filter((t) => t.quadrant === 'do' && t.status !== 'completed' && t.status !== 'eliminated'),
    [tasks]
  );

  const activeTask = useMemo(
    () => doTasks.find((t) => t.id === activeTaskId) ?? null,
    [doTasks, activeTaskId]
  );

  // Timer
  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, [running]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleStartTask = (task: Task) => {
    setActiveTaskId(task.id);
    setElapsed(0);
    setRunning(true);
    if (task.status === 'pending') {
      updateTask.mutate({ id: task.id, status: 'in_progress' });
    }
  };

  const handleCompleteTask = () => {
    if (activeTask) {
      updateTask.mutate({ id: activeTask.id, status: 'completed' });
      setRunning(false);
      setActiveTaskId(null);
      setElapsed(0);
    }
  };

  const handlePauseResume = () => setRunning(!running);

  if (!open) return null;

  const completedCount = tasks.filter((t) => t.quadrant === 'do' && t.status === 'completed').length;
  const totalDoTasks = tasks.filter((t) => t.quadrant === 'do').length;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-quadrant-do/20">
            <Target className="h-5 w-5 text-quadrant-do" />
          </div>
          <div>
            <h1 className="font-display text-lg font-bold">
              {language === 'pt-BR' ? 'Modo Foco' : 'Focus Mode'}
            </h1>
            <p className="text-xs text-muted-foreground">
              {QUADRANT_CONFIG.do.emoji} {t('doNow')} — {t('doNowDesc')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Badge variant="outline" className="text-quadrant-do gap-1">
            <CheckCircle className="h-3 w-3" />
            {completedCount}/{totalDoTasks}
          </Badge>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Active task area */}
        <div className="flex-1 flex items-center justify-center p-8">
          {activeTask ? (
            <div className="max-w-lg w-full text-center space-y-8">
              {/* Timer */}
              <div className="space-y-2">
                <p className="font-display text-6xl font-bold tracking-tight tabular-nums">
                  {formatTime(elapsed)}
                </p>
                <div className="flex items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePauseResume}
                    className="gap-1.5"
                  >
                    {running ? (
                      <>{language === 'pt-BR' ? 'Pausar' : 'Pause'}</>
                    ) : (
                      <><Play className="h-3.5 w-3.5" /> {language === 'pt-BR' ? 'Retomar' : 'Resume'}</>
                    )}
                  </Button>
                </div>
              </div>

              {/* Task info */}
              <div className="space-y-3">
                <h2 className="font-display text-2xl font-bold">{activeTask.title}</h2>
                {activeTask.description && (
                  <p className="text-muted-foreground">{activeTask.description}</p>
                )}
                <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
                  {activeTask.due_date && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      {format(new Date(activeTask.due_date), 'MMM dd, HH:mm')}
                    </span>
                  )}
                  {activeTask.estimated_time && (
                    <span className="flex items-center gap-1">
                      <Timer className="h-4 w-4" />
                      {activeTask.estimated_time} {t('minutes')}
                    </span>
                  )}
                </div>
                {activeTask.tags && activeTask.tags.length > 0 && (
                  <div className="flex items-center justify-center gap-1.5 flex-wrap">
                    {activeTask.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* Complete button */}
              <Button
                size="lg"
                onClick={handleCompleteTask}
                className="gap-2 bg-quadrant-do hover:bg-quadrant-do/90 text-primary-foreground px-8"
              >
                <CheckCircle className="h-5 w-5" />
                {t('complete')}
              </Button>
            </div>
          ) : (
            <div className="text-center space-y-4">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-quadrant-do/10">
                <Zap className="h-10 w-10 text-quadrant-do" />
              </div>
              <h2 className="font-display text-2xl font-bold">
                {language === 'pt-BR' ? 'Selecione uma tarefa' : 'Select a task'}
              </h2>
              <p className="text-muted-foreground max-w-sm mx-auto">
                {language === 'pt-BR'
                  ? 'Escolha uma tarefa da lista ao lado para começar a trabalhar com foco total.'
                  : 'Pick a task from the list to start working with total focus.'}
              </p>
            </div>
          )}
        </div>

        {/* Task list */}
        <div className="w-80 border-l bg-card/50 flex flex-col">
          <div className="px-4 py-3 border-b">
            <p className="text-sm font-semibold">
              {language === 'pt-BR' ? 'Tarefas Prioritárias' : 'Priority Tasks'}
              <span className="ml-2 text-muted-foreground font-normal">({doTasks.length})</span>
            </p>
          </div>
          <ScrollArea className="flex-1 p-3">
            <div className="space-y-2">
              {doTasks.length === 0 ? (
                <div className="text-center py-12">
                  <CheckCircle className="h-10 w-10 text-quadrant-do mx-auto mb-3 opacity-50" />
                  <p className="text-sm text-muted-foreground">
                    {language === 'pt-BR' ? 'Todas as tarefas concluídas! 🎉' : 'All tasks done! 🎉'}
                  </p>
                </div>
              ) : (
                doTasks.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => handleStartTask(task)}
                    className={`w-full text-left rounded-lg border p-3 transition-all hover:shadow-md ${
                      activeTaskId === task.id
                        ? 'border-quadrant-do bg-quadrant-do-bg ring-1 ring-quadrant-do'
                        : 'bg-card hover:bg-accent'
                    }`}
                  >
                    <p className="text-sm font-medium truncate">{task.title}</p>
                    {task.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      {task.estimated_time && (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                          <Timer className="h-2.5 w-2.5" />
                          {task.estimated_time}{t('minutes')}
                        </span>
                      )}
                      {task.status === 'in_progress' && (
                        <Badge variant="secondary" className="text-[10px] h-4 px-1.5 bg-quadrant-do/10 text-quadrant-do">
                          {language === 'pt-BR' ? 'Em andamento' : 'In progress'}
                        </Badge>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
