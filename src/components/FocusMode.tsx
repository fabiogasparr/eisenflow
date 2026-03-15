import { useState, useMemo, useEffect, useCallback } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { useTasks } from '@/hooks/useTasks';
import { useGamification } from '@/hooks/useGamification';
import { usePomodoroSettings } from '@/hooks/usePomodoroSettings';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { QUADRANT_CONFIG, type Task } from '@/types/task';
import { X, CheckCircle, Play, Clock, Zap, Target, Timer, Coffee, SkipForward, Pause } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { playStartSound, playPauseSound, playResumeSound, playFocusEndSound, playBreakEndSound, playCompleteSound } from '@/lib/focusSounds';

type PomodoroPhase = 'focus' | 'short_break' | 'long_break';

interface FocusModeProps {
  open: boolean;
  onClose: () => void;
}

export function FocusMode({ open, onClose }: FocusModeProps) {
  const { t, language } = useLanguage();
  const { tasks, updateTask } = useTasks();
  const { recordAction } = useGamification();
  const pomodoro = usePomodoroSettings();

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<PomodoroPhase>('focus');
  const [pomodoroCount, setPomodoroCount] = useState(0);
  const [sessionPomodoros, setSessionPomodoros] = useState(0);

  const isPomodoroEnabled = pomodoro.enabled;

  const doTasks = useMemo(
    () => tasks.filter((t) => t.quadrant === 'do' && t.status !== 'completed' && t.status !== 'eliminated'),
    [tasks]
  );

  const activeTask = useMemo(
    () => doTasks.find((t) => t.id === activeTaskId) ?? null,
    [doTasks, activeTaskId]
  );

  const getPhaseDuration = useCallback((p: PomodoroPhase) => {
    switch (p) {
      case 'focus': return pomodoro.focusDuration * 60;
      case 'short_break': return pomodoro.shortBreakDuration * 60;
      case 'long_break': return pomodoro.longBreakDuration * 60;
    }
  }, [pomodoro.focusDuration, pomodoro.shortBreakDuration, pomodoro.longBreakDuration]);

  const playNotificationSound = useCallback(() => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 800;
      gain.gain.value = 0.3;
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
      setTimeout(() => {
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.frequency.value = 1000;
        gain2.gain.value = 0.3;
        osc2.start();
        osc2.stop(ctx.currentTime + 0.3);
      }, 350);
    } catch {}
  }, []);

  const handlePhaseEnd = useCallback(() => {
    setRunning(false);
    playNotificationSound();

    if (phase === 'focus') {
      const newCount = pomodoroCount + 1;
      setPomodoroCount(newCount);
      setSessionPomodoros((s) => s + 1);
      recordAction.mutate('pomodoro');
      recordAction.mutate('focus_minutes');

      const isLongBreak = newCount % pomodoro.longBreakInterval === 0;
      const nextPhase: PomodoroPhase = isLongBreak ? 'long_break' : 'short_break';

      toast.success(
        language === 'pt-BR' ? `🍅 Pomodoro #${newCount} concluído!` : `🍅 Pomodoro #${newCount} completed!`,
        {
          description: language === 'pt-BR'
            ? (isLongBreak ? 'Hora de uma pausa longa!' : 'Hora de uma pausa curta!')
            : (isLongBreak ? 'Time for a long break!' : 'Time for a short break!'),
        }
      );

      setPhase(nextPhase);
      setTimeLeft(getPhaseDuration(nextPhase));
    } else {
      toast.info(
        language === 'pt-BR' ? '⏰ Pausa finalizada!' : '⏰ Break over!',
        { description: language === 'pt-BR' ? 'Pronto para mais um pomodoro?' : 'Ready for another pomodoro?' }
      );
      setPhase('focus');
      setTimeLeft(getPhaseDuration('focus'));
    }
  }, [phase, pomodoroCount, pomodoro.longBreakInterval, getPhaseDuration, playNotificationSound, recordAction, language]);

  // Timer logic
  useEffect(() => {
    if (!running) return;

    const interval = setInterval(() => {
      if (isPomodoroEnabled) {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            handlePhaseEnd();
            return 0;
          }
          return prev - 1;
        });
      } else {
        setElapsed((e) => {
          const next = e + 1;
          if (next % 60 === 0) recordAction.mutate('focus_minutes');
          return next;
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [running, isPomodoroEnabled, handlePhaseEnd, recordAction]);

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
    setPhase('focus');
    setPomodoroCount(0);
    if (isPomodoroEnabled) {
      setTimeLeft(getPhaseDuration('focus'));
    } else {
      setElapsed(0);
    }
    setRunning(true);
    if (task.status === 'pending') {
      updateTask.mutate({ id: task.id, status: 'in_progress' });
    }
  };

  const handleCompleteTask = () => {
    if (activeTask) {
      updateTask.mutate({ id: activeTask.id, status: 'completed' });
      recordAction.mutate('complete');
      setRunning(false);
      setActiveTaskId(null);
      setElapsed(0);
      setTimeLeft(0);
    }
  };

  const handlePauseResume = () => setRunning(!running);

  const handleSkipBreak = () => {
    setPhase('focus');
    setTimeLeft(getPhaseDuration('focus'));
    setRunning(true);
  };

  if (!open) return null;

  const completedCount = tasks.filter((t) => t.quadrant === 'do' && t.status === 'completed').length;
  const totalDoTasks = tasks.filter((t) => t.quadrant === 'do').length;

  const isBreak = phase === 'short_break' || phase === 'long_break';
  const phaseColor = isBreak ? 'text-emerald-500' : 'text-quadrant-do';
  const phaseBg = isBreak ? 'bg-emerald-500/10' : 'bg-quadrant-do/10';

  const phaseLabel = (() => {
    if (!isPomodoroEnabled) return '';
    switch (phase) {
      case 'focus': return language === 'pt-BR' ? '🍅 Foco' : '🍅 Focus';
      case 'short_break': return language === 'pt-BR' ? '☕ Pausa Curta' : '☕ Short Break';
      case 'long_break': return language === 'pt-BR' ? '🌿 Pausa Longa' : '🌿 Long Break';
    }
  })();

  // Pomodoro dots indicator
  const pomodoroIndicator = isPomodoroEnabled && (
    <div className="flex items-center gap-1.5 justify-center">
      {Array.from({ length: pomodoro.longBreakInterval }).map((_, i) => (
        <div
          key={i}
          className={`h-3 w-3 rounded-full transition-all ${
            i < (pomodoroCount % pomodoro.longBreakInterval)
              ? 'bg-destructive scale-110'
              : 'bg-muted'
          }`}
        />
      ))}
      {sessionPomodoros > 0 && (
        <span className="ml-2 text-xs text-muted-foreground">
          {sessionPomodoros} 🍅
        </span>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div className="flex items-center gap-3">
          <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${phaseBg}`}>
            {isBreak ? <Coffee className={`h-5 w-5 ${phaseColor}`} /> : <Target className={`h-5 w-5 ${phaseColor}`} />}
          </div>
          <div>
            <h1 className="font-display text-lg font-bold">
              {language === 'pt-BR' ? 'Modo Foco' : 'Focus Mode'}
            </h1>
            <p className="text-xs text-muted-foreground">
              {isPomodoroEnabled ? phaseLabel : `${QUADRANT_CONFIG.do.emoji} ${t('doNow')} — ${t('doNowDesc')}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Badge variant="outline" className={`${phaseColor} gap-1`}>
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
              {/* Phase badge */}
              {isPomodoroEnabled && (
                <Badge variant="secondary" className={`text-sm px-4 py-1 ${isBreak ? 'bg-emerald-500/15 text-emerald-600' : 'bg-destructive/15 text-destructive'}`}>
                  {phaseLabel}
                </Badge>
              )}

              {/* Timer */}
              <div className="space-y-4">
                <p className={`font-display text-7xl font-bold tracking-tight tabular-nums ${phaseColor}`}>
                  {isPomodoroEnabled ? formatTime(timeLeft) : formatTime(elapsed)}
                </p>

                {/* Pomodoro dots */}
                {pomodoroIndicator}

                <div className="flex items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePauseResume}
                    className="gap-1.5"
                  >
                    {running ? (
                      <><Pause className="h-3.5 w-3.5" /> {language === 'pt-BR' ? 'Pausar' : 'Pause'}</>
                    ) : (
                      <><Play className="h-3.5 w-3.5" /> {language === 'pt-BR' ? 'Retomar' : 'Resume'}</>
                    )}
                  </Button>
                  {isPomodoroEnabled && isBreak && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSkipBreak}
                      className="gap-1.5"
                    >
                      <SkipForward className="h-3.5 w-3.5" />
                      {language === 'pt-BR' ? 'Pular Pausa' : 'Skip Break'}
                    </Button>
                  )}
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
              {!isBreak && (
                <Button
                  size="lg"
                  onClick={handleCompleteTask}
                  className="gap-2 bg-quadrant-do hover:bg-quadrant-do/90 text-primary-foreground px-8"
                >
                  <CheckCircle className="h-5 w-5" />
                  {t('complete')}
                </Button>
              )}
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
