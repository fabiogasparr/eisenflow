import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Subtask } from '@/types/task';

export function useSubtasks(taskId: string | null) {
  const queryClient = useQueryClient();

  const subtasksQuery = useQuery({
    queryKey: ['subtasks', taskId],
    queryFn: async (): Promise<Subtask[]> => {
      if (!taskId) return [];
      const { data, error } = await supabase
        .from('subtasks')
        .select('*')
        .eq('task_id', taskId)
        .order('position', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Subtask[];
    },
    enabled: !!taskId,
  });

  const addSubtask = useMutation({
    mutationFn: async ({ title, position }: { title: string; position: number }) => {
      if (!taskId) throw new Error('No task');
      const { data, error } = await supabase
        .from('subtasks')
        .insert({ task_id: taskId, title, position })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['subtasks', taskId] }),
  });

  const toggleSubtask = useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      const { error } = await supabase
        .from('subtasks')
        .update({ completed })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['subtasks', taskId] }),
  });

  const deleteSubtask = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('subtasks').delete().eq('id', id);
      if (error) throw error;
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
