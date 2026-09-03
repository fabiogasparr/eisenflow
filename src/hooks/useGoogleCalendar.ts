import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useEffect, useCallback } from 'react';
import { invoke } from '@/integrations/appwrite/functions';
import { update } from '@/integrations/appwrite/database';

/**
 * Metadados da conexão com o Google Calendar.
 *
 * MUDANÇA DE SEGURANÇA DELIBERADA: no backend antigo o cliente lia
 * `google_calendar_tokens` direto (e portanto enxergava access_token e
 * refresh_token do usuário — isso era uma falha). No Appwrite a collection é
 * SERVER-ONLY: o cliente não lê nem escreve. Todo acesso passa pelas Functions
 * `google-calendar-auth` e `google-calendar-sync`, que devolvem apenas os
 * metadados não sensíveis descritos abaixo. Token nenhum chega ao navegador.
 */
export interface GoogleCalendarStatus {
  connected: boolean;
  google_email?: string | null;
  calendar_id?: string | null;
  sync_enabled?: boolean | null;
  last_synced_at?: string | null;
}

export function useGoogleCalendar() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Aviso do popup de OAuth quando a Function termina o callback
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
    queryKey: ['google-calendar-token', user?.$id],
    queryFn: async (): Promise<GoogleCalendarStatus | null> => {
      // Antes: SELECT em google_calendar_tokens. Agora a Function responde por
      // ela — o cliente não tem permissão de leitura na collection.
      // TODO(migração): a action 'status' precisa existir em google-calendar-auth
      // (o scaffold hoje documenta apenas authorize/callback/disconnect) e deve
      // devolver SÓ os metadados de GoogleCalendarStatus, nunca os tokens.
      const status = await invoke<GoogleCalendarStatus>('google-calendar-auth', { action: 'status' });
      return status?.connected ? status : null;
    },
    enabled: !!user,
  });

  // Importa os eventos uma vez por sessão quando a sincronização está ligada
  useEffect(() => {
    if (tokenQuery.data?.sync_enabled && sessionStorage.getItem('gcal-auto-imported') !== 'true') {
      sessionStorage.setItem('gcal-auto-imported', 'true');
      invoke('google-calendar-sync', { action: 'import-events' })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['tasks'] });
        })
        .catch(console.error);
    }
  }, [tokenQuery.data?.sync_enabled, queryClient]);

  const isConnected = !!tokenQuery.data;

  const calendarsQuery = useQuery({
    queryKey: ['google-calendars', user?.$id],
    queryFn: async () => {
      const data = await invoke<{
        calendars?: Array<{ id: string; summary: string; primary: boolean; backgroundColor: string }>;
      }>('google-calendar-sync', { action: 'list-calendars' });
      return data?.calendars ?? [];
    },
    enabled: !!user && isConnected,
  });

  const connect = useCallback(async () => {
    if (!user) return;
    try {
      // Antes a URL da function era montada no cliente com o access_token da
      // sessão na querystring (`state=<access_token>`) — token de sessão
      // viajando em URL. Agora a própria Function monta a URL de consent do
      // Google e a devolve; a sessão do Appwrite viaja no cabeçalho.
      const { url } = await invoke<{ url: string }>('google-calendar-auth', { action: 'authorize' });
      window.open(url, 'google-calendar-auth', 'width=500,height=700');
    } catch (err) {
      toast({
        title: 'Erro ao conectar',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  }, [user, toast]);

  const disconnect = useMutation({
    mutationFn: async () => {
      await invoke('google-calendar-auth', { action: 'disconnect' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['google-calendar-token'] });
      queryClient.invalidateQueries({ queryKey: ['google-calendars'] });
      toast({ title: 'Google Calendar desconectado' });
    },
    onError: (err: Error) => {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    },
  });

  const syncAllTasks = useMutation({
    mutationFn: async () => {
      // Exporta tarefas → Google
      const exportData = await invoke<{ synced?: number }>('google-calendar-sync', {
        action: 'sync-tasks',
      });

      // Importa Google → tarefas
      const importData = await invoke<{ imported?: number; updated?: number }>('google-calendar-sync', {
        action: 'import-events',
      });

      return { export: exportData, import: importData };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      const exported = data?.export?.synced ?? 0;
      const imported = data?.import?.imported ?? 0;
      const updated = data?.import?.updated ?? 0;
      toast({
        title: 'Sincronização concluída',
        description: `${exported} tarefas exportadas, ${imported} eventos importados, ${updated} atualizados`,
      });
    },
    onError: (err: Error) => {
      toast({ title: 'Erro ao sincronizar', description: err.message, variant: 'destructive' });
    },
  });

  const importEvents = useMutation({
    mutationFn: async () =>
      invoke<{ imported?: number; updated?: number }>('google-calendar-sync', {
        action: 'import-events',
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast({
        title: 'Importação concluída',
        description: `${data?.imported ?? 0} eventos importados, ${data?.updated ?? 0} atualizados`,
      });
    },
    onError: (err: Error) => {
      toast({ title: 'Erro ao importar', description: err.message, variant: 'destructive' });
    },
  });

  const updateSettings = useMutation({
    mutationFn: async (updates: { sync_enabled?: boolean; calendar_id?: string }) => {
      // Antes: UPDATE em google_calendar_tokens. A collection é server-only,
      // então quem grava é a Function — mesmo para campos inofensivos, porque a
      // permissão é do documento inteiro.
      // TODO(migração): a action 'update-settings' precisa existir em
      // google-calendar-auth e aceitar apenas sync_enabled e calendar_id.
      await invoke('google-calendar-auth', { action: 'update-settings', ...updates });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['google-calendar-token'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    },
  });

  const syncTask = useCallback(
    async (task: {
      id: string;
      title: string;
      description?: string | null;
      due_date?: string | null;
      created_at?: string | null;
      status?: string | null;
      google_event_id?: string | null;
    }) => {
      if (!tokenQuery.data?.sync_enabled) return;

      try {
        const startDateTime = task.due_date || task.created_at || new Date().toISOString();
        const allDay = !task.due_date;
        const prefix =
          task.status === 'completed' ? '✅ ' : task.status === 'eliminated' ? '❌ ' : '';
        const summary = prefix + task.title;

        const action = task.google_event_id ? 'update-event' : 'create-event';
        const body: Record<string, unknown> = {
          action,
          summary,
          description: task.description || '',
          startDateTime,
          allDay,
        };
        if (task.google_event_id) {
          body.eventId = task.google_event_id;
        }

        const data = await invoke<{ event?: { id?: string } }>('google-calendar-sync', body);

        // `tasks` continua sendo escrita pelo cliente: guardar o id do evento não
        // muda a titularidade do documento, então as permissões seguem as mesmas.
        if (!task.google_event_id && data?.event?.id) {
          await update('tasks', task.id, { google_event_id: data.event.id });
        }
      } catch (err) {
        console.error('Google Calendar sync error:', err);
      }
    },
    [tokenQuery.data]
  );

  return {
    isConnected,
    tokenData: tokenQuery.data,
    isLoading: tokenQuery.isLoading,
    calendars: calendarsQuery.data ?? [],
    calendarsLoading: calendarsQuery.isLoading,
    connect,
    disconnect,
    syncAllTasks,
    importEvents,
    syncTask,
    updateSettings,
  };
}
