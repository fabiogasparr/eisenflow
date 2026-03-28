import { useState, useMemo } from 'react';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { AppLayout } from '@/components/AppLayout';
import { QuadrantDropZone } from '@/components/QuadrantDropZone';
import { TaskCard } from '@/components/TaskCard';
import { CreateTaskDialog } from '@/components/CreateTaskDialog';
import { TaskDetailSheet } from '@/components/TaskDetailSheet';
import { FocusMode } from '@/components/FocusMode';
import { useTasks } from '@/hooks/useTasks';
import { useGoogleCalendar } from '@/hooks/useGoogleCalendar';
import { useGamification } from '@/hooks/useGamification';
import { useLanguage } from '@/i18n/LanguageContext';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useIsMobile } from '@/hooks/use-mobile';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Play, RefreshCw } from 'lucide-react';
import type { Task, Quadrant, CreateTaskInput } from '@/types/task';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { QUADRANT_CONFIG } from '@/types/task';

export default function Index() {
  const { t, language } = useLanguage();
  const gcal = useGoogleCalendar();
  const { tasks, isLoading, createTask, moveToQuadrant, updateTask, deleteTask, refetch } = useTasks(gcal.syncTask);
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const { containerRef, pullDistance, isRefreshing, isPulling, handlers: pullHandlers } = usePullToRefresh({
    onRefresh: async () => { await refetch(); },
    disabled: !isMobile,
  });
  const { recordAction } = useGamification();
  const [searchQuery, setSearchQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [focusOpen, setFocusOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  );

  const filteredTasks = useMemo(() => {
    if (!searchQuery) return tasks;
    const q = searchQuery.toLowerCase();
    return tasks.filter(
      (t) =>
      t.title.toLowerCase().includes(q) ||
      t.description?.toLowerCase().includes(q) ||
      t.tags?.some((tag) => tag.toLowerCase().includes(q))
    );
  }, [tasks, searchQuery]);

  // Separate in-progress tasks from matrix tasks
  const inProgressTasks = useMemo(() => {
    return filteredTasks.filter((t) => t.status === 'in_progress');
  }, [filteredTasks]);

  const matrixTasks = useMemo(() => {
    return filteredTasks.filter((t) => t.status !== 'in_progress');
  }, [filteredTasks]);

  const tasksByQuadrant = useMemo(() => ({
    do: matrixTasks.filter((t) => t.quadrant === 'do'),
    schedule: matrixTasks.filter((t) => t.quadrant === 'schedule'),
    delegate: matrixTasks.filter((t) => t.quadrant === 'delegate'),
    eliminate: matrixTasks.filter((t) => t.quadrant === 'eliminate')
  }), [matrixTasks]);

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === event.active.id);
    setActiveTask(task ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const targetQuadrant = over.id as Quadrant;
    const taskId = active.id as string;
    const task = tasks.find((t) => t.id === taskId);

    if (task && task.quadrant !== targetQuadrant) {
      moveToQuadrant.mutate({ taskId, quadrant: targetQuadrant });
    }
  };

  const handleCreateTask = async (input: CreateTaskInput) => {
    await createTask.mutateAsync(input);
  };

  const classifyWithAI = async (title: string, description: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('classify-task', {
        body: { title, description }
      });
      if (error) throw error;
      return data as {quadrant: Quadrant;urgency: number;importance: number;};
    } catch (e: any) {
      toast({ title: 'AI Error', description: e.message, variant: 'destructive' });
      return null;
    }
  };

  const handleSwipeComplete = async (task: Task) => {
    await updateTask.mutateAsync({ id: task.id, status: 'completed' });
    recordAction.mutate('complete');
    toast({ title: language === 'pt-BR' ? 'Tarefa concluída!' : 'Task completed!' });
  };

  const handleSwipeDelete = async (task: Task) => {
    if (task.quadrant === 'eliminate') recordAction.mutate('eliminate');
    await deleteTask.mutateAsync(task.id);
    toast({ title: language === 'pt-BR' ? 'Tarefa excluída' : 'Task deleted', variant: 'destructive' });
  };

  const quadrants: Quadrant[] = ['do', 'schedule', 'delegate', 'eliminate'];

  const QUADRANT_BORDER_COLORS: Record<string, string> = {
    do: 'border-l-quadrant-do',
    schedule: 'border-l-quadrant-schedule',
    delegate: 'border-l-quadrant-delegate',
    eliminate: 'border-l-quadrant-eliminate',
  };

  return (
    <AppLayout onSearch={setSearchQuery} onFocusMode={() => setFocusOpen(true)} onCreateTask={() => setCreateOpen(true)}>
      <div
        ref={containerRef}
        className="p-2 md:p-6 h-full flex flex-col overflow-auto"
        {...pullHandlers}
      >
        {/* Pull-to-refresh indicator */}
        {(isPulling || isRefreshing) && (
          <div
            className="flex items-center justify-center py-2 transition-all"
            style={{ height: pullDistance > 0 ? pullDistance : isRefreshing ? 36 : 0 }}
          >
            <RefreshCw
              className={`h-5 w-5 text-primary transition-transform ${
                isRefreshing ? 'animate-spin' : ''
              }`}
              style={{
                transform: !isRefreshing ? `rotate(${Math.min(pullDistance * 4, 360)}deg)` : undefined,
                opacity: Math.min(pullDistance / 60, 1),
              }}
            />
          </div>
        )}
        {/* In Progress Section */}
        {inProgressTasks.length > 0 && (
          <div className="mb-4 rounded-xl border-2 border-primary/30 bg-primary/5 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-primary/10">
              <Play className="h-4 w-4 text-primary fill-primary" />
              <h3 className="font-display text-sm font-bold text-primary">
                {language === 'pt-BR' ? 'Em Andamento' : 'In Progress'}
              </h3>
              <span className="ml-auto rounded-full bg-primary/20 px-2 py-0.5 text-xs font-semibold text-primary">
                {inProgressTasks.length}
              </span>
            </div>
            <ScrollArea className="max-h-[180px]">
              <div className="p-2 md:p-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {inProgressTasks.map((task) => {
                  const config = QUADRANT_CONFIG[task.quadrant];
                  const borderColor = QUADRANT_BORDER_COLORS[task.quadrant] ?? '';
                  return (
                    <div
                      key={task.id}
                      onClick={() => setSelectedTask(task)}
                      className={`rounded-lg border-l-4 border bg-card p-2.5 shadow-sm hover:shadow-md transition-all cursor-pointer ${borderColor} ring-1 ring-primary/20`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{config.emoji}</span>
                        <p className="text-sm font-medium leading-tight truncate flex-1">
                          {task.title}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Matrix Grid */}
        {isLoading ? (
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2 md:gap-3">
            {quadrants.map((q) => {
              const config = QUADRANT_CONFIG[q];
              return (
                <div key={q} className="rounded-xl border bg-card/50 flex flex-col">
                  <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
                    <span className="text-base">{config.emoji}</span>
                    <Skeleton className="h-4 w-24" />
                  </div>
                  <div className="p-2 space-y-2 flex-1">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="rounded-lg border bg-card p-2.5 space-y-2 animate-fade-in" style={{ animationDelay: `${i * 100}ms` }}>
                        <div className="flex items-center gap-2">
                          <Skeleton className="h-3.5 w-3.5 rounded" />
                          <Skeleton className="h-4 flex-1" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2 md:gap-3">
            <div className="contents">
              {quadrants.map((q) =>
              <QuadrantDropZone
                key={q}
                quadrant={q}
                tasks={tasksByQuadrant[q]}
                onTaskClick={setSelectedTask}
                onComplete={handleSwipeComplete}
                onDelete={handleSwipeDelete}
                defaultCollapsed={q !== 'do'} />
              )}
            </div>
          </div>
          <DragOverlay>
            {activeTask ? <TaskCard task={activeTask} /> : null}
          </DragOverlay>
        </DndContext>
        )}

        <CreateTaskDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSubmit={handleCreateTask}
          onClassifyWithAI={classifyWithAI} />

        <TaskDetailSheet
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onUpdate={async (updates) => {
            if (selectedTask) {
              await updateTask.mutateAsync({ id: selectedTask.id, ...updates });
              if (updates.status === 'completed') recordAction.mutate('complete');
              if (updates.status === 'eliminated') recordAction.mutate('eliminate');
              setSelectedTask(null);
            }
          }}
          onDelete={async () => {
            if (selectedTask) {
              if (selectedTask.quadrant === 'eliminate') recordAction.mutate('eliminate');
              await deleteTask.mutateAsync(selectedTask.id);
              setSelectedTask(null);
            }
          }} />

        <FocusMode open={focusOpen} onClose={() => setFocusOpen(false)} />
      </div>
    </AppLayout>);
}
