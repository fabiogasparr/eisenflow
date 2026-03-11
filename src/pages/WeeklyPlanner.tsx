import { useState, useMemo } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { useLanguage } from '@/i18n/LanguageContext';
import { useTasks } from '@/hooks/useTasks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TaskDetailSheet } from '@/components/TaskDetailSheet';
import { ChevronLeft, ChevronRight, Clock, GripVertical } from 'lucide-react';
import { format, startOfWeek, addDays, isSameDay, addWeeks, subWeeks, type Locale } from 'date-fns';
import { ptBR, enUS } from 'date-fns/locale';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { QUADRANT_CONFIG, type Task } from '@/types/task';

function DraggableWeekTask({ task, onClick }: { task: Task; onClick: (t: Task) => void }) {
  const config = QUADRANT_CONFIG[task.quadrant];
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { task },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-start gap-2 rounded-lg border bg-card p-2.5 shadow-sm hover:shadow-md transition-all cursor-pointer ${
        isDragging ? 'ring-2 ring-primary z-50' : ''
      }`}
      onClick={() => onClick(task)}
    >
      <button
        {...attributes}
        {...listeners}
        className="mt-0.5 cursor-grab opacity-0 group-hover:opacity-60 transition-opacity shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-xs">{config.emoji}</span>
          <p className={`text-xs font-medium leading-tight truncate ${
            task.status === 'completed' ? 'line-through text-muted-foreground' : ''
          }`}>
            {task.title}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {task.estimated_time && (
            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <Clock className="h-2.5 w-2.5" />
              {task.estimated_time}min
            </span>
          )}
          {task.tags?.slice(0, 1).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{tag}</Badge>
          ))}
        </div>
      </div>
    </div>
  );
}

function DayColumn({
  date,
  tasks,
  isToday,
  locale,
  onTaskClick,
}: {
  date: Date;
  tasks: Task[];
  isToday: boolean;
  locale: Locale;
  onTaskClick: (t: Task) => void;
}) {
  const { t } = useLanguage();
  const dayId = format(date, 'yyyy-MM-dd');
  const { isOver, setNodeRef } = useDroppable({ id: dayId });

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-xl border-2 transition-all overflow-hidden min-h-[300px] ${
        isToday ? 'border-primary/50 bg-primary/5' : isOver ? 'border-quadrant-schedule bg-quadrant-schedule-bg' : 'border-border bg-card/50'
      }`}
    >
      <div className={`px-3 py-2 border-b text-center ${isToday ? 'bg-primary/10' : 'bg-muted/30'}`}>
        <p className="text-xs font-medium text-muted-foreground uppercase">
          {format(date, 'EEE', { locale })}
        </p>
        <p className={`text-lg font-display font-bold ${isToday ? 'text-primary' : ''}`}>
          {format(date, 'd')}
        </p>
      </div>
      <ScrollArea className="flex-1 p-2">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1.5">
            {tasks.length === 0 ? (
              <p className="text-center text-[10px] text-muted-foreground py-6">{t('noTasks')}</p>
            ) : (
              tasks.map((task) => (
                <DraggableWeekTask key={task.id} task={task} onClick={onTaskClick} />
              ))
            )}
          </div>
        </SortableContext>
      </ScrollArea>
      {tasks.length > 0 && (
        <div className="px-3 py-1.5 border-t bg-muted/20 text-center">
          <span className="text-[10px] text-muted-foreground">
            {tasks.reduce((a, t) => a + (t.estimated_time ?? 0), 0)} min
          </span>
        </div>
      )}
    </div>
  );
}

// Unscheduled tasks sidebar
function UnscheduledPanel({ tasks, onTaskClick }: { tasks: Task[]; onTaskClick: (t: Task) => void }) {
  const { t } = useLanguage();
  const { isOver, setNodeRef } = useDroppable({ id: 'unscheduled' });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border-2 transition-all overflow-hidden ${
        isOver ? 'border-quadrant-schedule bg-quadrant-schedule-bg' : 'border-border bg-card/50'
      }`}
    >
      <div className="px-3 py-2 border-b bg-muted/30">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {t('schedule')} — {t('dragHint')}
        </p>
      </div>
      <ScrollArea className="p-2 max-h-[calc(100vh-220px)]">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1.5">
            {tasks.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-8">{t('noTasks')}</p>
            ) : (
              tasks.map((task) => (
                <DraggableWeekTask key={task.id} task={task} onClick={onTaskClick} />
              ))
            )}
          </div>
        </SortableContext>
      </ScrollArea>
    </div>
  );
}

export default function WeeklyPlanner() {
  const { t, language } = useLanguage();
  const { tasks, updateTask, deleteTask } = useTasks();
  const [currentWeekStart, setCurrentWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const locale = language === 'pt-BR' ? ptBR : enUS;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));
  }, [currentWeekStart]);

  // Tasks with due_date that fall in this week
  const scheduledTasks = useMemo(() => {
    return tasks.filter((t) => t.quadrant === 'schedule' || t.due_date);
  }, [tasks]);

  const tasksByDay = useMemo(() => {
    const map: Record<string, Task[]> = {};
    weekDays.forEach((day) => {
      const key = format(day, 'yyyy-MM-dd');
      map[key] = scheduledTasks.filter(
        (t) => t.due_date && isSameDay(new Date(t.due_date), day)
      );
    });
    return map;
  }, [weekDays, scheduledTasks]);

  const unscheduledTasks = useMemo(() => {
    return tasks.filter((t) => (t.quadrant === 'schedule') && !t.due_date);
  }, [tasks]);

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === event.active.id);
    setActiveTask(task ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = active.id as string;
    const targetId = over.id as string;

    if (targetId === 'unscheduled') {
      updateTask.mutate({ id: taskId, due_date: null as any });
    } else {
      // It's a date string like 'yyyy-MM-dd'
      const targetDate = new Date(targetId + 'T09:00:00');
      updateTask.mutate({ id: taskId, due_date: targetDate.toISOString(), quadrant: 'schedule' });
    }
  };

  const weekLabel = `${format(weekDays[0], 'dd MMM', { locale })} — ${format(weekDays[6], 'dd MMM yyyy', { locale })}`;

  return (
    <AppLayout>
      <div className="p-4 md:p-6 h-full flex flex-col">
        {/* Week navigation */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="font-display text-xl font-bold">
            {language === 'pt-BR' ? 'Planejamento Semanal' : 'Weekly Planning'}
          </h1>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setCurrentWeekStart(subWeeks(currentWeekStart, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[180px] text-center">{weekLabel}</span>
            <Button variant="ghost" size="icon" onClick={() => setCurrentWeekStart(addWeeks(currentWeekStart, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
            >
              {language === 'pt-BR' ? 'Hoje' : 'Today'}
            </Button>
          </div>
        </div>

        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex-1 flex gap-4 overflow-hidden">
            {/* Unscheduled sidebar */}
            <div className="w-56 shrink-0">
              <UnscheduledPanel tasks={unscheduledTasks} onTaskClick={setSelectedTask} />
            </div>

            {/* Week grid */}
            <div className="flex-1 grid grid-cols-7 gap-2 overflow-x-auto">
              {weekDays.map((day) => {
                const key = format(day, 'yyyy-MM-dd');
                return (
                  <DayColumn
                    key={key}
                    date={day}
                    tasks={tasksByDay[key] ?? []}
                    isToday={isSameDay(day, new Date())}
                    locale={locale}
                    onTaskClick={setSelectedTask}
                  />
                );
              })}
            </div>
          </div>

          <DragOverlay>
            {activeTask ? (
              <div className="rounded-lg border bg-card p-2.5 shadow-lg max-w-[200px]">
                <p className="text-xs font-medium truncate">{activeTask.title}</p>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

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
