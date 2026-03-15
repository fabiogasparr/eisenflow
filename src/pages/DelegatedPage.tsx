import { useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { useLanguage } from '@/i18n/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useSharedWithMe } from '@/hooks/useTaskShares';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { TaskDetailSheet } from '@/components/TaskDetailSheet';
import { useTasks } from '@/hooks/useTasks';
import { QUADRANT_CONFIG } from '@/types/task';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Share2, UserCheck, Eye, Pencil, User, Inbox } from 'lucide-react';
import type { Task } from '@/types/task';

export default function DelegatedPage() {
  const { language } = useLanguage();
  const pt = language === 'pt-BR';
  const { user } = useAuth();
  const { sharedTasks, isLoading: sharedLoading } = useSharedWithMe();
  const { updateTask, deleteTask } = useTasks();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // Tasks assigned to me (via assigned_to field)
  const assignedQuery = useQuery({
    queryKey: ['assigned-to-me', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('assigned_to', user.id)
        .neq('created_by', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const assignedTasks = assignedQuery.data ?? [];
  const isLoading = sharedLoading || assignedQuery.isLoading;

  const renderEmptyState = (message: string) => (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
      <Inbox className="h-10 w-10 opacity-30" />
      <p className="text-sm">{message}</p>
    </div>
  );

  const renderTaskCard = (task: any, extra?: { sharedBy?: string; permission?: string }) => {
    const config = QUADRANT_CONFIG[task.quadrant as keyof typeof QUADRANT_CONFIG];
    return (
      <div
        key={task.id}
        onClick={() => setSelectedTask(task)}
        className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-sm hover:shadow-md transition-all cursor-pointer group"
      >
        <span className="text-xl">{config.emoji}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{task.title}</p>
          {task.description && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{task.description}</p>
          )}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <Badge variant="outline" className={`text-xs text-quadrant-${task.quadrant}`}>
              {pt ? config.labelKey === 'doNow' ? 'Fazer' : config.labelKey === 'schedule' ? 'Agendar' : config.labelKey === 'delegate' ? 'Delegar' : 'Eliminar' : config.labelKey}
            </Badge>
            {task.status && (
              <Badge variant="secondary" className="text-xs">
                {task.status === 'pending' ? (pt ? 'Pendente' : 'Pending') :
                 task.status === 'in_progress' ? (pt ? 'Em andamento' : 'In Progress') :
                 task.status === 'completed' ? (pt ? 'Concluída' : 'Completed') :
                 pt ? 'Eliminada' : 'Eliminated'}
              </Badge>
            )}
            {extra?.sharedBy && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <User className="h-3 w-3" />
                {extra.sharedBy}
              </span>
            )}
            {extra?.permission && (
              <Badge variant="outline" className="text-xs gap-1">
                {extra.permission === 'edit' ? (
                  <><Pencil className="h-2.5 w-2.5" /> {pt ? 'Editar' : 'Edit'}</>
                ) : (
                  <><Eye className="h-2.5 w-2.5" /> {pt ? 'Ver' : 'View'}</>
                )}
              </Badge>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <AppLayout onSearch={() => {}} onFocusMode={() => {}} onCreateTask={() => {}}>
      <div className="p-4 md:p-6 h-full flex flex-col max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Share2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold">
              {pt ? 'Tarefas Delegadas' : 'Delegated Tasks'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {pt ? 'Tarefas atribuídas ou compartilhadas com você' : 'Tasks assigned or shared with you'}
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : (
          <Tabs defaultValue="assigned" className="flex-1">
            <TabsList className="w-full grid grid-cols-2 mb-4">
              <TabsTrigger value="assigned" className="gap-2">
                <UserCheck className="h-4 w-4" />
                {pt ? 'Atribuídas' : 'Assigned'}
                {assignedTasks.length > 0 && (
                  <Badge variant="secondary" className="ml-1 text-xs">{assignedTasks.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="shared" className="gap-2">
                <Share2 className="h-4 w-4" />
                {pt ? 'Compartilhadas' : 'Shared'}
                {sharedTasks.length > 0 && (
                  <Badge variant="secondary" className="ml-1 text-xs">{sharedTasks.length}</Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="assigned">
              <ScrollArea className="flex-1">
                {assignedTasks.length === 0
                  ? renderEmptyState(pt ? 'Nenhuma tarefa atribuída a você' : 'No tasks assigned to you')
                  : <div className="space-y-2">{assignedTasks.map((t: any) => renderTaskCard(t))}</div>
                }
              </ScrollArea>
            </TabsContent>

            <TabsContent value="shared">
              <ScrollArea className="flex-1">
                {sharedTasks.length === 0
                  ? renderEmptyState(pt ? 'Nenhuma tarefa compartilhada com você' : 'No tasks shared with you')
                  : <div className="space-y-2">
                      {sharedTasks.map((t: any) => renderTaskCard(t, {
                        sharedBy: t._share?.shared_by_name,
                        permission: t._share?.permission,
                      }))}
                    </div>
                }
              </ScrollArea>
            </TabsContent>
          </Tabs>
        )}

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
