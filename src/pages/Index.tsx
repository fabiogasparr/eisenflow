import { useState, useMemo } from 'react';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { AppLayout } from '@/components/AppLayout';
import { QuadrantDropZone } from '@/components/QuadrantDropZone';
import { TaskCard } from '@/components/TaskCard';
import { CreateTaskDialog } from '@/components/CreateTaskDialog';
import { TaskDetailSheet } from '@/components/TaskDetailSheet';
import { FocusMode } from '@/components/FocusMode';
import { useTasks } from '@/hooks/useTasks';
import { useLanguage } from '@/i18n/LanguageContext';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import type { Task, Quadrant, CreateTaskInput } from '@/types/task';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export default function Index() {
  const { t } = useLanguage();
  const { tasks, isLoading, createTask, moveToQuadrant, updateTask, deleteTask } = useTasks();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
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

  const tasksByQuadrant = useMemo(() => ({
    do: filteredTasks.filter((t) => t.quadrant === 'do'),
    schedule: filteredTasks.filter((t) => t.quadrant === 'schedule'),
    delegate: filteredTasks.filter((t) => t.quadrant === 'delegate'),
    eliminate: filteredTasks.filter((t) => t.quadrant === 'eliminate'),
  }), [filteredTasks]);

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
        body: { title, description },
      });
      if (error) throw error;
      return data as { quadrant: Quadrant; urgency: number; importance: number };
    } catch (e: any) {
      toast({ title: 'AI Error', description: e.message, variant: 'destructive' });
      return null;
    }
  };

  const quadrants: Quadrant[] = ['do', 'schedule', 'delegate', 'eliminate'];

  return (
    <AppLayout onSearch={setSearchQuery}>
      <div className="p-4 md:p-6 h-full flex flex-col">
        {/* Header row */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <span className="w-1/2 text-center">{t('urgent')}</span>
              <span className="w-1/2 text-center">{t('notUrgent')}</span>
            </div>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="gap-2 shadow-lg">
            <Plus className="h-4 w-4" />
            {t('addTask')}
          </Button>
        </div>

        {/* Matrix Grid */}
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-3">
            {/* Row labels */}
            <div className="contents">
              {quadrants.map((q) => (
                <QuadrantDropZone
                  key={q}
                  quadrant={q}
                  tasks={tasksByQuadrant[q]}
                  onTaskClick={setSelectedTask}
                />
              ))}
            </div>
          </div>
          <DragOverlay>
            {activeTask ? <TaskCard task={activeTask} /> : null}
          </DragOverlay>
        </DndContext>

        <CreateTaskDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSubmit={handleCreateTask}
          onClassifyWithAI={classifyWithAI}
        />

        <TaskDetailSheet
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onUpdate={async (updates) => {
            if (selectedTask) {
              await updateTask.mutateAsync({ id: selectedTask.id, ...updates });
              setSelectedTask(null);
            }
          }}
          onDelete={async () => {
            if (selectedTask) {
              await deleteTask.mutateAsync(selectedTask.id);
              setSelectedTask(null);
            }
          }}
        />
      </div>
    </AppLayout>
  );
}
