import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Subtask } from '@/types/task';
import { create, update, remove, listDocs, getById, Query } from '@/integrations/appwrite/database';
import { inheritFrom } from '@/integrations/appwrite/permissions';

export function useSubtasks(taskId: string | null) {
  const queryClient = useQueryClient();

  const subtasksQuery = useQuery({
    queryKey: ['subtasks', taskId],
    queryFn: async (): Promise<Subtask[]> => {
      if (!taskId) return [];
      const docs = await listDocs('subtasks', [
        Query.equal('task_id', taskId),
        Query.orderAsc('position'),
      ]);
      return docs as unknown as Subtask[];
    },
    enabled: !!taskId,
  });

  const addSubtask = useMutation({
    mutationFn: async ({ title, position }: { title: string; position: number }) => {
      if (!taskId) throw new Error('No task');

      // PERMISSÕES: a policy "Users can view subtasks of accessible tasks" (e as
      // irmãs de insert/update/delete) faziam um EXISTS na tabela `tasks` a cada
      // query — criador, responsável, membro do tenant, membro do time do projeto
      // ou usuário com share enxergavam a subtarefa.
      // No Appwrite não há consulta no momento da leitura: a regra fica gravada
      // NO DOCUMENTO. Por isso a subtarefa nasce COM AS MESMAS PERMISSÕES DA
      // TAREFA PAI — é o que reproduz o "quem vê a tarefa vê a subtarefa" sem
      // precisar reavaliar nada depois.
      const parent = await getById('tasks', taskId);

      const doc = await create(
        'subtasks',
        { task_id: taskId, title, position, completed: false },
        inheritFrom(parent.$permissions),
      );
      return doc as unknown as Subtask;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['subtasks', taskId] }),
  });

  const toggleSubtask = useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      // Marcar como concluída não muda titularidade nenhuma: as permissões
      // gravadas na criação continuam valendo, então não passamos o 3º argumento.
      await update('subtasks', id, { completed });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['subtasks', taskId] }),
  });

  const deleteSubtask = useMutation({
    mutationFn: async (id: string) => {
      await remove('subtasks', id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['subtasks', taskId] }),
  });

  const completedCount = (subtasksQuery.data ?? []).filter(s => s.completed).length;
  const totalCount = (subtasksQuery.data ?? []).length;

  return {
    subtasks: subtasksQuery.data ?? [],
    isLoading: subtasksQuery.isLoading,
    addSubtask,
    toggleSubtask,
    deleteSubtask,
    completedCount,
    totalCount,
  };
}
