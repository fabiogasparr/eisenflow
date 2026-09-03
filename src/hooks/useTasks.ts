import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import type { Task, Quadrant, CreateTaskInput } from '@/types/task';
import { useToast } from '@/hooks/use-toast';
import { useTenantContext } from '@/hooks/useTenantContext';
import { create, update, remove, listAll, getById, Query } from '@/integrations/appwrite/database';
import { subscribeCollection } from '@/integrations/appwrite/realtime';
import { taskPermissions } from '@/integrations/appwrite/permissions';

export function useTasks(syncTaskToCalendar?: (task: Task) => void) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { activeTenantId } = useTenantContext();

  // Realtime: o Appwrite só entrega evento de documento que a sessão pode LER,
  // então o filtro `created_by=eq.<uid>` do Supabase virou desnecessário — a
  // permissão do documento já faz esse recorte.
  useEffect(() => {
    if (!user) return undefined;
    return subscribeCollection('tasks', () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', user.$id] });
    });
  }, [user, queryClient]);

  const tasksQuery = useQuery({
    queryKey: ['tasks', user?.$id],
    queryFn: async (): Promise<Task[]> => {
      if (!user) return [];
      // listAll pagina com cursor: o Appwrite devolve no máximo 100 por request.
      const docs = await listAll('tasks', [Query.orderAsc('position')]);
      return docs as unknown as Task[];
    },
    enabled: !!user,
    refetchInterval: 30000,
  });

  const createTask = useMutation({
    mutationFn: async (input: CreateTaskInput) => {
      if (!user) throw new Error('Not authenticated');
      const doc = await create(
        'tasks',
        {
          ...input,
          created_by: user.$id,
          // Array no Appwrite não aceita default no schema — o padrão vem daqui.
          tags: input.tags ?? [],
          recurrence_rule: input.recurrence_rule ?? null,
          tenant_id: activeTenantId ?? null,
        } as never,
        // No Postgres a RLS decidia quem via a tarefa a cada query. Aqui a regra
        // é gravada NO DOCUMENTO, no momento da criação.
        taskPermissions({
          createdBy: user.$id,
          assignedTo: input.assigned_to ?? null,
          tenantTeamId: activeTenantId ?? null,
        }),
      );
      return doc as unknown as Task;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      if (data) syncTaskToCalendar?.(data);
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const updateTask = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Task> & { id: string }) => {
      // Recalcula o quadrante quando urgência ou importância mudam
      if ((updates.urgency !== undefined || updates.importance !== undefined) && !updates.quadrant) {
        const currentTask = tasksQuery.data?.find((t) => t.id === id);
        if (currentTask) {
          const urg = updates.urgency ?? currentTask.urgency;
          const imp = updates.importance ?? currentTask.importance;
          const isUrgent = urg >= 3;
          const isImportant = imp >= 3;
          if (isUrgent && isImportant) updates.quadrant = 'do' as Quadrant;
          else if (!isUrgent && isImportant) updates.quadrant = 'schedule' as Quadrant;
          else if (isUrgent && !isImportant) updates.quadrant = 'delegate' as Quadrant;
          else updates.quadrant = 'eliminate' as Quadrant;
        }
      }
      if (updates.status === 'in_progress' && !updates.started_at) {
        updates.started_at = new Date().toISOString();
        if (!updates.quadrant) updates.quadrant = 'do' as Quadrant;
      }
      if ((updates.status === 'completed' || updates.status === 'eliminated') && !updates.completed_at) {
        updates.completed_at = new Date().toISOString();
      }

      // Delegar muda quem pode ver a tarefa: as permissões do documento precisam
      // ser recalculadas junto. No Postgres a RLS fazia isso sozinha.
      let permissions: string[] | undefined;
      if (updates.assigned_to !== undefined) {
        const current = tasksQuery.data?.find((t) => t.id === id)
          ?? (await getById('tasks', id) as unknown as Task);
        permissions = taskPermissions({
          createdBy: current.created_by,
          assignedTo: updates.assigned_to ?? null,
          tenantTeamId: current.tenant_id ?? activeTenantId ?? null,
        });
      }

      const doc = await update('tasks', id, updates as never, permissions);
      return doc as unknown as Task;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      if (data) syncTaskToCalendar?.(data);
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const moveToQuadrant = useMutation({
    mutationFn: async ({ taskId, quadrant }: { taskId: string; quadrant: Quadrant }) => {
      await update('tasks', taskId, { quadrant } as never);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const deleteTask = useMutation({
    mutationFn: async (taskId: string) => {
      // O Appwrite não tem ON DELETE CASCADE: os filhos precisam sair na mão.
      await deleteTaskCascade(taskId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['subtasks'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  return {
    tasks: tasksQuery.data ?? [],
    isLoading: tasksQuery.isLoading,
    refetch: tasksQuery.refetch,
    createTask,
    updateTask,
    moveToQuadrant,
    deleteTask,
  };
}

/**
 * Substitui o ON DELETE CASCADE que existia no Postgres.
 * Apaga primeiro tudo que apontava para a tarefa, depois a tarefa.
 * Erros nos filhos não impedem a remoção da tarefa — o objetivo é não deixar
 * a tarefa órfã na tela porque um lembrete falhou.
 */
export async function deleteTaskCascade(taskId: string) {
  const filhos = [
    'subtasks', 'task_shares', 'task_attachments', 'task_reminders',
    'delegations', 'task_focus_sessions', 'task_reclassification_suggestions',
  ] as const;

  await Promise.all(
    filhos.map(async (col) => {
      try {
        const docs = await listAll(col, [Query.equal('task_id', taskId)]);
        await Promise.all(docs.map((d) => remove(col, d.id).catch(() => undefined)));
      } catch {
        /* sem permissão de leitura nessa collection: segue */
      }
    }),
  );

  await remove('tasks', taskId);
}
