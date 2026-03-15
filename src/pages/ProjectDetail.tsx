import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { useLanguage } from '@/i18n/LanguageContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { ArrowLeft, Users, CheckCircle2, Clock, Zap, Trash2, Circle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTasks } from '@/hooks/useTasks';
import { TaskDetailSheet } from '@/components/TaskDetailSheet';
import type { Task, Quadrant, TaskStatus } from '@/types/task';
import { QUADRANT_CONFIG } from '@/types/task';

const STATUS_OPTIONS = [
  { value: 'all', label: 'Todos', icon: Circle },
  { value: 'pending', label: 'Pendente', icon: Clock },
  { value: 'in_progress', label: 'Em progresso', icon: Zap },
  { value: 'completed', label: 'Concluído', icon: CheckCircle2 },
  { value: 'eliminated', label: 'Eliminado', icon: Trash2 },
] as const;

const QUADRANT_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'do', label: '🟩 Fazer agora' },
  { value: 'schedule', label: '🟧 Agendar' },
  { value: 'delegate', label: '🟦 Delegar' },
  { value: 'eliminate', label: '🟥 Eliminar' },
] as const;

const QUADRANT_BORDER: Record<string, string> = {
  do: 'border-l-quadrant-do',
  schedule: 'border-l-quadrant-schedule',
  delegate: 'border-l-quadrant-delegate',
  eliminate: 'border-l-quadrant-eliminate',
};

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { user } = useAuth();
  const { tasks, updateTask, deleteTask } = useTasks();

  const [statusFilter, setStatusFilter] = useState('all');
  const [quadrantFilter, setQuadrantFilter] = useState('all');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('projects')
        .select('*, teams(name)')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id && !!user,
  });

  const filteredTasks = useMemo(() => {
    let result = tasks.filter((t) => t.project_id === id);
    if (statusFilter !== 'all') result = result.filter((t) => t.status === statusFilter);
    if (quadrantFilter !== 'all') result = result.filter((t) => t.quadrant === quadrantFilter);
    return result;
  }, [tasks, id, statusFilter, quadrantFilter]);

  const statusCounts = useMemo(() => {
    const projectTasks = tasks.filter((t) => t.project_id === id);
    return {
      all: projectTasks.length,
      pending: projectTasks.filter((t) => t.status === 'pending').length,
      in_progress: projectTasks.filter((t) => t.status === 'in_progress').length,
      completed: projectTasks.filter((t) => t.status === 'completed').length,
      eliminated: projectTasks.filter((t) => t.status === 'eliminated').length,
    };
  }, [tasks, id]);

  if (!project) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/projects')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="h-4 w-4 rounded-full shrink-0" style={{ backgroundColor: project.color }} />
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-2xl font-bold truncate">{project.name}</h1>
            {project.teams?.name && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
                <Users className="h-3.5 w-3.5" />
                <span>{project.teams.name}</span>
              </div>
            )}
          </div>
        </div>

        {/* Status summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {STATUS_OPTIONS.filter((s) => s.value !== 'all').map((s) => {
            const Icon = s.icon;
            const count = statusCounts[s.value as keyof typeof statusCounts];
            return (
              <button
                key={s.value}
                onClick={() => setStatusFilter(statusFilter === s.value ? 'all' : s.value)}
                className={`flex items-center gap-2 rounded-lg border p-3 transition-colors ${
                  statusFilter === s.value
                    ? 'bg-primary/10 border-primary/30 text-primary'
                    : 'bg-card hover:bg-accent/50'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="text-sm font-medium">{s.label}</span>
                <span className="ml-auto text-lg font-bold">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={quadrantFilter} onValueChange={setQuadrantFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Quadrante" />
            </SelectTrigger>
            <SelectContent>
              {QUADRANT_OPTIONS.map((q) => (
                <SelectItem key={q.value} value={q.value}>{q.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {(statusFilter !== 'all' || quadrantFilter !== 'all') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setStatusFilter('all'); setQuadrantFilter('all'); }}
            >
              Limpar filtros
            </Button>
          )}

          <span className="text-sm text-muted-foreground ml-auto">
            {filteredTasks.length} {filteredTasks.length === 1 ? 'tarefa' : 'tarefas'}
          </span>
        </div>

        {/* Task list */}
        <div className="space-y-2">
          {filteredTasks.map((task) => {
            const borderColor = QUADRANT_BORDER[task.quadrant] ?? '';
            const isCompleted = task.status === 'completed';
            const isInProgress = task.status === 'in_progress';

            return (
              <div
                key={task.id}
                onClick={() => setSelectedTask(task)}
                className={`rounded-lg border-l-4 border bg-card p-3 shadow-sm hover:shadow-md transition-all cursor-pointer ${borderColor} ${
                  isCompleted ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <p className={`text-sm font-medium flex-1 ${isCompleted ? 'line-through text-muted-foreground' : ''}`}>
                    {task.title}
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    {isInProgress && (
                      <Badge variant="secondary" className="text-[10px] gap-1">
                        <Zap className="h-3 w-3" />
                        Em progresso
                      </Badge>
                    )}
                    {task.due_date && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(task.due_date).toLocaleDateString()}
                      </span>
                    )}
                    <Badge variant="outline" className="text-[10px]">
                      {QUADRANT_CONFIG[task.quadrant].emoji}
                    </Badge>
                  </div>
                </div>
                {task.description && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{task.description}</p>
                )}
              </div>
            );
          })}

          {filteredTasks.length === 0 && (
            <p className="text-muted-foreground text-center py-12">
              Nenhuma tarefa encontrada neste projeto.
            </p>
          )}
        </div>
      </div>

      {/* Task detail sheet */}
      <TaskDetailSheet
        task={selectedTask}
        onClose={() => setSelectedTask(null)}
        onUpdate={async (updates) => { await updateTask.mutateAsync({ id: selectedTask!.id, ...updates }); }}
        onDelete={async () => { if (selectedTask) { await deleteTask.mutateAsync(selectedTask.id); setSelectedTask(null); } }}
      />
    </AppLayout>
  );
}
