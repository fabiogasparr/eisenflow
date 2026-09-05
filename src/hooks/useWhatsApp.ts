import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { invoke } from '@/integrations/supabase/functions';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useCallback, useEffect, useRef } from 'react';

export interface WhatsAppConnection {
  id: string;
  user_id: string;
  instance_name: string;
  phone_number: string | null;
  status: 'disconnected' | 'connecting' | 'qr_pending' | 'connected';
  qr_code: string | null;
  reminders_enabled: boolean;
  daily_report_enabled: boolean;
  weekly_report_enabled: boolean;
  weekly_report_day: number;
  report_time: string;
  weekly_report_time: string;
  accept_messages_from: 'self_only' | 'all';
  reminder_times: string;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export function useWhatsApp() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const connectionQuery = useQuery({
    queryKey: ['whatsapp-connection', user?.id],
    queryFn: async (): Promise<WhatsAppConnection | null> => {
      if (!user) return null;
      const { data, error } = await (supabase as any)
        .from('whatsapp_connections')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data as WhatsAppConnection | null;
    },
    enabled: !!user,
  });

  const connect = useMutation({
    mutationFn: async () => {
      return await invoke('whatsapp-connect');
    },
    onSuccess: async () => {
      // Auto-detect browser timezone on first connection
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz && user) {
        await (supabase as any)
          .from('whatsapp_connections')
          .update({ timezone: tz })
          .eq('user_id', user.id);
      }
      queryClient.invalidateQueries({ queryKey: ['whatsapp-connection'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    },
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      return await invoke('whatsapp-disconnect');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-connection'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    },
  });

  const updateSettings = useMutation({
    mutationFn: async (settings: { reminders_enabled?: boolean; daily_report_enabled?: boolean; weekly_report_enabled?: boolean; weekly_report_day?: number; report_time?: string; weekly_report_time?: string; accept_messages_from?: 'self_only' | 'all'; reminder_times?: string; timezone?: string }) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await (supabase as any)
        .from('whatsapp_connections')
        .update(settings)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-connection'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    },
  });

  // Poll while the pairing is in flight. whatsapp-status refaz o GET /instance/qr
  // e regrava qr_code, então o polling também é o que traz o QR quando ele não
  // veio na primeira chamada — por isso invalidamos a query a cada resposta, e
  // não só quando o status vira 'connected'.
  const checkStatus = useCallback(async () => {
    try {
      await invoke<{ status?: string }>('whatsapp-status');
      queryClient.invalidateQueries({ queryKey: ['whatsapp-connection'] });
    } catch (e) {
      console.error('Status check failed:', e);
    }
  }, [queryClient]);

  const startPolling = useCallback(() => {
    if (pollingRef.current) return;
    pollingRef.current = setInterval(() => {
      checkStatus();
    }, 4000);
  }, [checkStatus]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  useEffect(() => {
    const emAndamento = connectionQuery.data?.status;
    if (emAndamento === 'qr_pending' || emAndamento === 'connecting') {
      startPolling();
    } else {
      stopPolling();
    }
    return stopPolling;
  }, [connectionQuery.data?.status, startPolling, stopPolling]);

  const reregisterWebhook = useMutation({
    mutationFn: async () => {
      return await invoke<{ webhook_reregistered?: boolean }>('whatsapp-status');
    },
    onSuccess: (data) => {
      if (data?.webhook_reregistered) {
        toast({ title: '✅', description: 'Webhook reconnected' });
      }
    },
    onError: (err: Error) => {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    },
  });

  return {
    connection: connectionQuery.data ?? null,
    isLoading: connectionQuery.isLoading,
    connect,
    disconnect,
    updateSettings,
    reregisterWebhook,
  };
}
