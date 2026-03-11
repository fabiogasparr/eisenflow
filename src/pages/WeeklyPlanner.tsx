import { useState, useMemo } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { useLanguage } from '@/i18n/LanguageContext';
import { useTasks } from '@/hooks/useTasks';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TaskDetailSheet } from '@/components/TaskDetailSheet';
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react';
import { format, startOfWeek, addDays, isSameDay, addWeeks, subWeeks, type Locale } from 'date-fns';
import { ptBR, enUS } from 'date-fns/locale';
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { type Task } from '@/types/task';

const QUADRANT_BORDER_COLORS: Record<string, string> = {
  do: 'border-l-quadrant-do',
  schedule: 'border-l-quadrant-schedule',
  delegate: 'border-l-quadrant-delegate',
  eliminate: 'border-l-quadrant-eliminate',
};

function DraggableWeekTask({ task, onClick }: { task: Task; onClick: (t: Task) => void }) {
  const { t } = useLanguage();
  const borderColor = QUADRANT_BORDER_COLORS[task.quadrant] ?? '';
  const isInProgress = task.status === 'in_progress';
  const isCompleted = task.status === 'completed';

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { task },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : isCompleted ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-2 rounded-lg border-l-4 border bg-card p-2 shadow-sm hover:shadow-md transition-all cursor-pointer ${borderColor} ${
        isDragging ? 'ring-2 ring-primary z-50' : ''
      } ${isInProgress ? 'ring-1 ring-primary/30' : ''}`}
      onClick={() => onClick(task)}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab opacity-0 group-hover:opacity-60 transition-opacity shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-3 w-3 text-muted-foreground" />
      </button>
      <p className={`text-xs font-medium leading-tight truncate flex-1 ${
        isCompleted ? 'line-through text-muted-foreground' : ''
      }`}>
        {task.title}
      </p>
      {isInProgress && (
        <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
          {t('inProgress') ?? '⏳'}
        </span>
      )}
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
    </div>
  );
}

function BacklogPanel({ tasks, onTaskClick }: { tasks: Task[]; onTaskClick: (t: Task) => void }) {
  const { t, language } = useLanguage();
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
          Backlog
        </p>
        <p className="text-[10px] text-muted-foreground">
          {language === 'pt-BR' ? 'Arraste para agendar' : 'Drag to schedule'}
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

  // Distribute tasks by started_at or due_date
  const tasksByDay = useMemo(() => {
    const map: Record<string, Task[]> = {};
    weekDays.forEach((day) => {
      const key = format(day, 'yyyy-MM-dd');
      map[key] = tasks.filter((t) => {
        const dateStr = t.started_at || t.due_date;
        return dateStr && isSameDay(new Date(dateStr), day);
      });
    });
    return map;
  }, [weekDays, tasks]);

  // Backlog: tasks without started_at AND without due_date
  const backlogTasks = useMemo(() => {
    return tasks.filter((t) => !t.started_at && !t.due_date && t.status !== 'completed' && t.status !== 'eliminated');
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
      updateTask.mutate({ id: taskId, due_date: null as any, started_at: null as any });
    } else {
      const targetDate = new Date(targetId + 'T09:00:00');
      updateTask.mutate({ id: taskId, due_date: targetDate.toISOString() });
    }
  };

  const weekLabel = `${format(weekDays[0], 'dd MMM', { locale })} — ${format(weekDays[6], 'dd MMM yyyy', { locale })}`;

  return (
    <AppLayout>
      <div className="p-4 md:p-6 h-full flex flex-col">
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
            <div className="w-56 shrink-0">
              <BacklogPanel tasks={backlogTasks} onTaskClick={setSelectedTask} />
            </div>
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
              <div className={`rounded-lg border-l-4 border bg-card p-2 shadow-lg max-w-[200px] ${QUADRANT_BORDER_COLORS[activeTask.quadrant] ?? ''}`}>
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
