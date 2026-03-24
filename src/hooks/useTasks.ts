import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Task, Quadrant, CreateTaskInput } from '@/types/task';
import { useToast } from '@/hooks/use-toast';

export function useTasks(syncTaskToCalendar?: (task: Task) => void) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Realtime: auto-refresh quadrants when tasks change (e.g. via WhatsApp webhook)
  useEffect(() => {
    if (!user) return undefined;
    const channel = supabase
      .channel(`tasks-realtime-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `created_by=eq.${user.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['tasks', user.id] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, queryClient]);

  const tasksQuery = useQuery({
    queryKey: ['tasks', user?.id],
    queryFn: async (): Promise<Task[]> => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .order('position', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Task[];
    },
    enabled: !!user,
    refetchInterval: 30000,
  });

  const createTask = useMutation({
    mutationFn: async (input: CreateTaskInput) => {
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('tasks')
        .insert({
          ...input,
          created_by: user.id,
          tags: input.tags ?? [],
          recurrence_rule: input.recurrence_rule ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as Task;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      // Auto-sync to Google Calendar if task has due_date
      if (data?.due_date) {
        syncTaskToCalendar?.(data as Task);
      }
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const updateTask = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Task> & { id: string }) => {
      // Auto-recalculate quadrant when urgency or importance change
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
      // Auto-set started_at / completed_at based on status changes
      if (updates.status === 'in_progress' && !updates.started_at) {
        updates.started_at = new Date().toISOString();
        if (!updates.quadrant) {
          updates.quadrant = 'do' as Quadrant;
        }
      }
      if ((updates.status === 'completed' || updates.status === 'eliminated') && !updates.completed_at) {
        updates.completed_at = new Date().toISOString();
      }
      const { data, error } = await supabase
        .from('tasks')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const moveToQuadrant = useMutation({
    mutationFn: async ({ taskId, quadrant }: { taskId: string; quadrant: Quadrant }) => {
      const { error } = await supabase
        .from('tasks')
        .update({ quadrant })
        .eq('id', taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const deleteTask = useMutation({
    mutationFn: async (taskId: string) => {
      const { error } = await supabase.from('tasks').delete().eq('id', taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
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
