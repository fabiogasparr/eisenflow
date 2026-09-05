import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invoke, FunctionError } from '@/integrations/supabase/functions';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useTenantContext } from '@/hooks/useTenantContext';
import { useEffect, useCallback } from 'react';

/**
 * MULTI-TENANT: existe um único app OAuth do EisenFlow no Google Cloud, mas cada
 * TENANT conecta a própria conta Google. A conexão em `google_calendar_tokens`
 * é (user_id, tenant_id) — o mesmo usuário pode ter contas Google diferentes em
 * organizações diferentes. Por isso toda chamada às Functions leva `tenant_id`
 * (sem ele elas respondem 400 e conferem a associação antes de qualquer coisa),
 * e a leitura da tabela filtra pelo tenant ativo.
 *
 * O que o front lê da tabela são só metadados (calendar_id, sync_enabled,
 * is_revoked...). Os tokens em si ficam cifrados e nunca são usados no
 * navegador: quem fala com a API do Google são as Functions.
 */

/** As Functions devolvem este code quando o refresh falha por invalid_grant. */
const PRECISA_RECONECTAR = 'google_reconnect_required';

function precisaReconectar(err: unknown): boolean {
  if (err instanceof FunctionError && err.code === PRECISA_RECONECTAR) return true;
  return /reconecte sua conta google/i.test((err as Error)?.message ?? '');
}

export function useGoogleCalendar() {
  const { user } = useAuth();
  const { activeTenantId } = useTenantContext();
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
    queryKey: ['google-calendar-token', user?.id, activeTenantId],
    queryFn: async () => {
      // Só metadados: nada de access_token/refresh_token no navegador.
      const { data, error } = await supabase
        .from('google_calendar_tokens')
        .select('id, user_id, tenant_id, calendar_id, sync_enabled, last_synced_at, google_email, is_revoked, revoked_reason')
        .eq('user_id', user!.id)
        .eq('tenant_id', activeTenantId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!activeTenantId,
  });

  // Importa os eventos uma vez por sessão quando a sincronização está ligada
  useEffect(() => {
    if (tokenQuery.data?.sync_enabled && !tokenQuery.data?.is_revoked && activeTenantId
        && sessionStorage.getItem(`gcal-auto-imported:${activeTenantId}`) !== 'true') {
      // A trava é por tenant: trocar de organização precisa importar de novo.
      sessionStorage.setItem(`gcal-auto-imported:${activeTenantId}`, 'true');
      invoke('google-calendar-sync', { action: 'import-events', tenant_id: activeTenantId })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['tasks'] });
        })
        .catch(console.error);
    }
  }, [tokenQuery.data?.sync_enabled, tokenQuery.data?.is_revoked, activeTenantId, queryClient]);

  // Conectado = existe registro e o acesso não foi retirado na Conta Google.
  // Distinguir "nunca conectou" de "conectou e foi revogado" é o que permite
  // pedir reconexão em vez de tratar como conexão viva.
  const isConnected = !!tokenQuery.data && !tokenQuery.data.is_revoked;

  // Lista os calendários da conta conectada para o tenant escolher qual usar
  // (grava depois em calendar_id via updateSettings).
  const calendarsQuery = useQuery({
    queryKey: ['google-calendars', user?.id, activeTenantId],
    queryFn: async () => {
      const data = await invoke<{
        calendars?: Array<{ id: string; summary: string; primary: boolean; backgroundColor: string }>;
      }>('google-calendar-sync', { action: 'list-calendars', tenant_id: activeTenantId });
      return data?.calendars ?? [];
    },
    enabled: !!user && !!activeTenantId && isConnected,
  });

  const connect = useCallback(async () => {
    if (!user) return;
    if (!activeTenantId) {
      // Sem organização ativa não há onde amarrar a conta Google. Normalmente
      // não acontece: o trigger handle_new_user_tenant cria o tenant pessoal
      // no primeiro login — mas a lista ainda pode estar carregando.
      toast({
        title: 'Selecione uma organização antes de conectar',
        description: 'O Google Calendar é conectado por organização. Aguarde a lista carregar ou escolha uma no menu.',
        variant: 'destructive',
      });
      return;
    }
    try {
      // Antes a URL da function era montada no cliente com o access_token da
      // sessão na querystring (`state=<access_token>`) — token de sessão
      // viajando em URL. Agora a própria Function monta a URL de consent do
      // Google (com state assinado por HMAC) e a devolve; a sessão viaja no
      // cabeçalho Authorization, como em qualquer outra chamada.
      const { url } = await invoke<{ url: string }>('google-calendar-auth', {
        action: 'authorize',
        tenant_id: activeTenantId,
      });
      window.open(url, 'google-calendar-auth', 'width=500,height=700');
    } catch (err) {
      toast({
        title: 'Não foi possível iniciar a conexão',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    }
  }, [user, activeTenantId, toast]);

  const disconnect = useMutation({
    mutationFn: async () => {
      await invoke('google-calendar-auth', { action: 'disconnect', tenant_id: activeTenantId });
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
        tenant_id: activeTenantId,
      });

      // Importa Google → tarefas
      const importData = await invoke<{ imported?: number; updated?: number }>('google-calendar-sync', {
        action: 'import-events',
        tenant_id: activeTenantId,
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
        tenant_id: activeTenantId,
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
      // Só sync_enabled e calendar_id são graváveis pelo cliente; o filtro por
      // tenant evita alterar a conexão de outra organização do mesmo usuário.
      const { error } = await supabase
        .from('google_calendar_tokens')
        .update(updates)
        .eq('user_id', user!.id)
        .eq('tenant_id', activeTenantId!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['google-calendar-token'] });
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
      if (!tokenQuery.data?.sync_enabled || tokenQuery.data?.is_revoked || !activeTenantId) return;

      try {
        const startDateTime = task.due_date || task.created_at || new Date().toISOString();
        const allDay = !task.due_date;
        const prefix =
          task.status === 'completed' ? '✅ ' : task.status === 'eliminated' ? '❌ ' : '';
        const summary = prefix + task.title;

        const action = task.google_event_id ? 'update-event' : 'create-event';
        const body: Record<string, unknown> = {
          action,
          tenant_id: activeTenantId,
          summary,
          description: task.description || '',
          startDateTime,
          allDay,
        };
        if (task.google_event_id) {
          body.eventId = task.google_event_id;
        }

        const data = await invoke<{ event?: { id?: string } }>('google-calendar-sync', body);

        if (!task.google_event_id && data?.event?.id) {
          await supabase
            .from('tasks')
            .update({ google_event_id: data.event.id })
            .eq('id', task.id);
        }
      } catch (err) {
        // invalid_grant: o acesso foi removido do lado do Google. Avisa uma vez
        // e revalida o status — a Function já marcou is_revoked.
        if (precisaReconectar(err)) {
          queryClient.invalidateQueries({ queryKey: ['google-calendar-token'] });
          toast({
            title: 'Reconecte sua conta Google',
            description: 'O acesso do EisenFlow ao seu Google Calendar foi revogado.',
            variant: 'destructive',
          });
          return;
        }
        console.error('Google Calendar sync error:', err);
      }
    },
    [tokenQuery.data, activeTenantId, queryClient, toast]
  );

  return {
    isConnected,
    needsReconnect: !!tokenQuery.data?.is_revoked,
    tenantId: activeTenantId,
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
