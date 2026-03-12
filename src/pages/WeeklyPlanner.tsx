import { useState, useMemo } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { useLanguage } from '@/i18n/LanguageContext';
import { useTasks } from '@/hooks/useTasks';
import { useCalendarSettings } from '@/hooks/useCalendarSettings';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TaskDetailSheet } from '@/components/TaskDetailSheet';
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react';
import {
  format, startOfWeek, addDays, isSameDay, addWeeks, subWeeks,
  startOfMonth, endOfMonth, addMonths, subMonths, getDay,
  type Locale,
} from 'date-fns';
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
      className={`group flex items-center gap-1 rounded-md border-l-[3px] border bg-card p-1.5 shadow-sm hover:shadow-md transition-all cursor-pointer ${borderColor} ${
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
        <GripVertical className="h-2.5 w-2.5 text-muted-foreground" />
      </button>
      <p className={`text-[11px] font-medium leading-tight truncate flex-1 ${
        isCompleted ? 'line-through text-muted-foreground' : ''
      }`}>
        {task.title}
      </p>
      {isInProgress && (
        <span className="shrink-0 rounded-full bg-primary/10 px-1 py-px text-[8px] font-semibold text-primary">
          ⏳
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
  compact,
}: {
  date: Date;
  tasks: Task[];
  isToday: boolean;
  locale: Locale;
  onTaskClick: (t: Task) => void;
  compact?: boolean;
}) {
  const { t } = useLanguage();
  const dayId = format(date, 'yyyy-MM-dd');
  const { isOver, setNodeRef } = useDroppable({ id: dayId });

  if (compact) {
    return (
      <div
        ref={setNodeRef}
        className={`flex flex-col rounded-lg border transition-all overflow-hidden min-h-[90px] ${
          isToday ? 'border-primary/50 bg-primary/5' : isOver ? 'border-quadrant-schedule bg-quadrant-schedule-bg' : 'border-border bg-card/50'
        }`}
      >
        <div className={`px-2 py-1 border-b text-center ${isToday ? 'bg-primary/10' : 'bg-muted/30'}`}>
          <p className={`text-sm font-bold ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
            {format(date, 'd')}
          </p>
        </div>
        <ScrollArea className="flex-1 p-1">
          <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1">
              {tasks.map((task) => (
                <DraggableWeekTask key={task.id} task={task} onClick={onTaskClick} />
              ))}
            </div>
          </SortableContext>
        </ScrollArea>
      </div>
    );
  }

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

function isWeekend(date: Date) {
  const day = getDay(date);
  return day === 0 || day === 6;
}

export default function WeeklyPlanner() {
  const { t, language } = useLanguage();
  const { tasks, updateTask, deleteTask } = useTasks();
  const { viewMode, showWeekends } = useCalendarSettings();

  const locale = language === 'pt-BR' ? ptBR : enUS;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Weekly state
  const [currentWeekStart, setCurrentWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  // Monthly state
  const [currentMonth, setCurrentMonth] = useState(() => new Date());

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  // Weekly days
  const weekDays = useMemo(() => {
    const all = Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));
    return showWeekends ? all : all.filter((d) => !isWeekend(d));
  }, [currentWeekStart, showWeekends]);

  // Monthly days
  const monthDays = useMemo(() => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    const days: Date[] = [];
    // Pad start to Monday
    const startDow = getDay(start); // 0=Sun
    const padStart = startDow === 0 ? 6 : startDow - 1; // days to pad (Mon=0)
    for (let i = padStart; i > 0; i--) days.push(addDays(start, -i));
    // Month days
    let cur = start;
    while (cur <= end) {
      days.push(cur);
      cur = addDays(cur, 1);
    }
    // Pad end to fill last week
    while (days.length % 7 !== 0) {
      days.push(addDays(end, days.length - (padStart + end.getDate()) + 1));
    }
    if (!showWeekends) return days.filter((d) => !isWeekend(d));
    return days;
  }, [currentMonth, showWeekends]);

  const getTasksForDay = (day: Date) =>
    tasks.filter((t) => {
      const dateStr = t.started_at || t.due_date;
      return dateStr && isSameDay(new Date(dateStr), day);
    });

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

  // Navigation
  const navPrev = () => {
    if (viewMode === 'weekly') setCurrentWeekStart(subWeeks(currentWeekStart, 1));
    else setCurrentMonth(subMonths(currentMonth, 1));
  };
  const navNext = () => {
    if (viewMode === 'weekly') setCurrentWeekStart(addWeeks(currentWeekStart, 1));
    else setCurrentMonth(addMonths(currentMonth, 1));
  };
  const navToday = () => {
    if (viewMode === 'weekly') setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));
    else setCurrentMonth(new Date());
  };

  const headerLabel = viewMode === 'weekly'
    ? `${format(weekDays[0], 'dd MMM', { locale })} — ${format(weekDays[weekDays.length - 1], 'dd MMM yyyy', { locale })}`
    : format(currentMonth, 'MMMM yyyy', { locale });

  const colCount = showWeekends ? 7 : 5;
  const dayHeaders = viewMode === 'monthly'
    ? (showWeekends
        ? [1, 2, 3, 4, 5, 6, 0] // Mon-Sun
        : [1, 2, 3, 4, 5]        // Mon-Fri
      ).map((d) => {
        const ref = addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), d === 0 ? 6 : d - 1);
        return format(ref, 'EEE', { locale });
      })
    : [];

  return (
    <AppLayout>
      <div className="p-4 md:p-6 h-full flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h1 className="font-display text-xl font-bold">
            {viewMode === 'weekly' ? t('weeklyPlanning') : t('monthly')}
          </h1>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={navPrev}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[180px] text-center capitalize">{headerLabel}</span>
            <Button variant="ghost" size="icon" onClick={navNext}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={navToday}>
              {language === 'pt-BR' ? 'Hoje' : 'Today'}
            </Button>
          </div>
        </div>

        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex-1 flex gap-4 overflow-hidden">
            <div className="w-56 shrink-0">
              <BacklogPanel tasks={backlogTasks} onTaskClick={setSelectedTask} />
            </div>

            {viewMode === 'weekly' ? (
              <div className={`flex-1 grid gap-2 overflow-x-auto`} style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}>
                {weekDays.map((day) => (
                  <DayColumn
                    key={format(day, 'yyyy-MM-dd')}
                    date={day}
                    tasks={getTasksForDay(day)}
                    isToday={isSameDay(day, new Date())}
                    locale={locale}
                    onTaskClick={setSelectedTask}
                  />
                ))}
              </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-auto">
                {/* Day headers */}
                <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}>
                  {dayHeaders.map((h) => (
                    <p key={h} className="text-xs font-medium text-muted-foreground uppercase text-center py-1">{h}</p>
                  ))}
                </div>
                {/* Day cells */}
                <div className="grid gap-1 flex-1" style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}>
                  {monthDays.map((day) => (
                    <DayColumn
                      key={format(day, 'yyyy-MM-dd')}
                      date={day}
                      tasks={getTasksForDay(day)}
                      isToday={isSameDay(day, new Date())}
                      locale={locale}
                      onTaskClick={setSelectedTask}
                      compact
                    />
                  ))}
                </div>
              </div>
            )}
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
