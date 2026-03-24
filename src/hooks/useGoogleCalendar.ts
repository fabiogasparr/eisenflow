import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useEffect, useCallback } from 'react';

export function useGoogleCalendar() {
  const { user, session } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Listen for popup callback
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'google-calendar-connected') {
        queryClient.invalidateQueries({ queryKey: ['google-calendar-token'] });
        toast({ title: 'Google Calendar conectado com sucesso!' });
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [queryClient, toast]);

  const tokenQuery = useQuery({
    queryKey: ['google-calendar-token', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('google_calendar_tokens')
        .select('*')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const connect = useCallback(() => {
    if (!session?.access_token) return;
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const authUrl = `https://${projectId}.supabase.co/functions/v1/google-calendar-auth?action=authorize&state=${session.access_token}`;
    window.open(authUrl, 'google-calendar-auth', 'width=500,height=700');
  }, [session]);

  const disconnect = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke('google-calendar-auth', {
        body: { action: 'disconnect' },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['google-calendar-token'] });
      toast({ title: 'Google Calendar desconectado' });
    },
    onError: (err: Error) => {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    },
  });

  const syncAllTasks = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('google-calendar-sync', {
        body: { action: 'sync-tasks' },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast({
        title: 'Sincronização concluída',
        description: `${data?.synced ?? 0} de ${data?.total ?? 0} tarefas sincronizadas`,
      });
    },
    onError: (err: Error) => {
      toast({ title: 'Erro ao sincronizar', description: err.message, variant: 'destructive' });
    },
  });

  const updateSettings = useMutation({
    mutationFn: async (updates: { sync_enabled?: boolean; calendar_id?: string }) => {
      const { error } = await supabase
        .from('google_calendar_tokens')
        .update(updates)
        .eq('user_id', user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['google-calendar-token'] });
    },
  });

  const syncTask = useCallback(
    async (task: { id: string; title: string; description?: string | null; due_date: string; google_event_id?: string | null }) => {
      if (!tokenQuery.data?.sync_enabled) return;

      try {
        const action = task.google_event_id ? 'update-event' : 'create-event';
        const body: Record<string, unknown> = {
          action,
          summary: task.title,
          description: task.description || '',
          startDateTime: task.due_date,
        };
        if (task.google_event_id) {
          body.eventId = task.google_event_id;
        }

        const { data, error } = await supabase.functions.invoke('google-calendar-sync', { body });
        if (error) throw error;

        // If created, save event ID to task
        if (!task.google_event_id && data?.event?.id) {
          await supabase
            .from('tasks')
            .update({ google_event_id: data.event.id })
            .eq('id', task.id);
        }
      } catch (err) {
        console.error('Google Calendar sync error:', err);
      }
    },
    [tokenQuery.data]
  );

  return {
    isConnected: !!tokenQuery.data,
    tokenData: tokenQuery.data,
    isLoading: tokenQuery.isLoading,
    connect,
    disconnect,
    syncAllTasks,
    syncTask,
    updateSettings,
  };
}
