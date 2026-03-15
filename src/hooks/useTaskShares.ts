import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

export interface TaskShare {
  id: string;
  task_id: string;
  shared_by: string;
  shared_with_email: string;
  shared_with_user_id: string | null;
  permission: 'view' | 'edit';
  created_at: string;
}

export function useTaskShares(taskId: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const sharesQuery = useQuery({
    queryKey: ['task-shares', taskId],
    queryFn: async (): Promise<TaskShare[]> => {
      if (!taskId) return [];
      const { data, error } = await supabase
        .from('task_shares')
        .select('*')
        .eq('task_id', taskId);
      if (error) throw error;
      return (data ?? []) as TaskShare[];
    },
    enabled: !!taskId && !!user,
  });

  const shareTask = useMutation({
    mutationFn: async ({ taskId, email, permission }: { taskId: string; email: string; permission: 'view' | 'edit' }) => {
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('task_shares')
        .insert({
          task_id: taskId,
          shared_by: user.id,
          shared_with_email: email.toLowerCase().trim(),
          permission,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-shares'] });
      toast({ title: '✅', description: 'Tarefa compartilhada com sucesso!' });
    },
    onError: (err: Error) => {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    },
  });

  const removeShare = useMutation({
    mutationFn: async (shareId: string) => {
      const { error } = await supabase.from('task_shares').delete().eq('id', shareId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-shares'] });
    },
  });

  return {
    shares: sharesQuery.data ?? [],
    isLoading: sharesQuery.isLoading,
    shareTask,
    removeShare,
  };
}

export function useSharedWithMe() {
  const { user } = useAuth();

  const sharedTasksQuery = useQuery({
    queryKey: ['shared-with-me', user?.id],
    queryFn: async () => {
      if (!user) return [];
      // Get shares where I'm the recipient
      const { data: shares, error: sharesError } = await supabase
        .from('task_shares')
        .select('*')
        .or(`shared_with_user_id.eq.${user.id},shared_with_email.eq.${user.email}`);
      if (sharesError) throw sharesError;
      if (!shares || shares.length === 0) return [];

      const taskIds = shares.map((s: any) => s.task_id);
      const { data: tasks, error: tasksError } = await supabase
        .from('tasks')
        .select('*')
        .in('id', taskIds);
      if (tasksError) throw tasksError;

      // Get sharer profiles
      const sharerIds = [...new Set(shares.map((s: any) => s.shared_by))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', sharerIds);

      const profileMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p.display_name]));

      return (tasks ?? []).map((task: any) => {
        const share = shares.find((s: any) => s.task_id === task.id);
        return {
          ...task,
          _share: {
            permission: share?.permission ?? 'view',
            shared_by_name: profileMap.get(share?.shared_by) ?? 'Unknown',
          },
        };
      });
    },
    enabled: !!user,
  });

  return {
    sharedTasks: sharedTasksQuery.data ?? [],
    isLoading: sharedTasksQuery.isLoading,
  };
}
