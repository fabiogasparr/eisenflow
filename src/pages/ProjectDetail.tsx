import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { useLanguage } from '@/i18n/LanguageContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { ArrowLeft, Users, CheckCircle2, Clock, Zap, Trash2, Circle, Plus, MoreVertical, Pencil, Archive, ArchiveRestore } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTasks } from '@/hooks/useTasks';
import { useTeams } from '@/hooks/useTeams';
import { useToast } from '@/hooks/use-toast';
import { TaskDetailSheet } from '@/components/TaskDetailSheet';
import { CreateTaskDialog } from '@/components/CreateTaskDialog';
import type { Task, CreateTaskInput } from '@/types/task';
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
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const { tasks, updateTask, deleteTask, createTask } = useTasks();
  const { teams } = useTeams();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState('all');
  const [quadrantFilter, setQuadrantFilter] = useState('all');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Edit state
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#6366f1');
  const [editTeamId, setEditTeamId] = useState<string | null>(null);

  // Delete state
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleCreateTask = async (input: CreateTaskInput) => {
    await createTask.mutateAsync({ ...input, project_id: id });
  };

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

  const updateProject = useMutation({
    mutationFn: async (updates: { name?: string; color?: string; team_id?: string | null; archived?: boolean }) => {
      if (!id) throw new Error('No project id');
      const { error } = await supabase.from('projects').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', id] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    },
  });

  const deleteProject = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('No project id');
      const { error } = await supabase.from('projects').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate('/projects');
      toast({ title: language === 'pt-BR' ? 'Projeto excluído' : 'Project deleted' });
    },
    onError: (err: Error) => {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    },
  });

  const openEditDialog = () => {
    if (!project) return;
    setEditName(project.name);
    setEditColor(project.color);
    setEditTeamId(project.team_id);
    setEditOpen(true);
  };

  const handleSaveEdit = () => {
    updateProject.mutate({ name: editName, color: editColor, team_id: editTeamId || null });
    setEditOpen(false);
  };

  const handleToggleArchive = () => {
    if (!project) return;
    const newVal = !(project as any).archived;
    updateProject.mutate({ archived: newVal });
    toast({
      title: newVal
        ? (language === 'pt-BR' ? 'Projeto arquivado' : 'Project archived')
        : (language === 'pt-BR' ? 'Projeto desarquivado' : 'Project unarchived'),
    });
  };

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

  const isArchived = (project as any).archived;

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
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl font-bold truncate">{project.name}</h1>
              {isArchived && (
                <Badge variant="secondary" className="gap-1 text-xs">
                  <Archive className="h-3 w-3" />
                  {language === 'pt-BR' ? 'Arquivado' : 'Archived'}
                </Badge>
              )}
            </div>
            {project.teams?.name && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
                <Users className="h-3.5 w-3.5" />
                <span>{project.teams.name}</span>
              </div>
            )}
          </div>
          <Button onClick={() => setCreateDialogOpen(true)} size="sm" className="gap-1.5 shrink-0">
            <Plus className="h-4 w-4" />
            {language === 'pt-BR' ? 'Nova tarefa' : 'New task'}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0">
                <MoreVertical className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={openEditDialog}>
                <Pencil className="h-4 w-4 mr-2" />
                {language === 'pt-BR' ? 'Editar' : 'Edit'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleToggleArchive}>
                {isArchived ? <ArchiveRestore className="h-4 w-4 mr-2" /> : <Archive className="h-4 w-4 mr-2" />}
                {isArchived
                  ? (language === 'pt-BR' ? 'Desarquivar' : 'Unarchive')
                  : (language === 'pt-BR' ? 'Arquivar' : 'Archive')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setDeleteOpen(true)} className="text-destructive focus:text-destructive">
                <Trash2 className="h-4 w-4 mr-2" />
                {language === 'pt-BR' ? 'Excluir' : 'Delete'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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

      <CreateTaskDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSubmit={handleCreateTask}
      />

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">
              {language === 'pt-BR' ? 'Editar projeto' : 'Edit project'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder={language === 'pt-BR' ? 'Nome do projeto' : 'Project name'}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />
            <div className="flex items-center gap-3">
              <label className="text-sm text-muted-foreground">{language === 'pt-BR' ? 'Cor' : 'Color'}</label>
              <input type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)} className="h-8 w-8 rounded cursor-pointer" />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">{language === 'pt-BR' ? 'Time (opcional)' : 'Team (optional)'}</label>
              <Select value={editTeamId ?? '_none'} onValueChange={(v) => setEditTeamId(v === '_none' ? null : v)}>
                <SelectTrigger>
                  <SelectValue placeholder={language === 'pt-BR' ? 'Pessoal' : 'Personal'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">{language === 'pt-BR' ? 'Pessoal' : 'Personal'}</SelectItem>
                  {teams.map((team) => (
                    <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>{t('cancel')}</Button>
            <Button onClick={handleSaveEdit} disabled={!editName.trim()}>{t('save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {language === 'pt-BR' ? 'Excluir projeto?' : 'Delete project?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {language === 'pt-BR'
                ? 'Esta ação não pode ser desfeita. As tarefas do projeto não serão excluídas, mas ficarão sem projeto associado.'
                : 'This action cannot be undone. Tasks in this project will not be deleted but will become unassigned.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteProject.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {language === 'pt-BR' ? 'Excluir' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
