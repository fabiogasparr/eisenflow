import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useCallback, useEffect, useRef } from 'react';

export interface WhatsAppConnection {
  id: string;
  user_id: string;
  instance_name: string;
  phone_number: string | null;
  status: 'disconnected' | 'qr_pending' | 'connected';
  qr_code: string | null;
  reminders_enabled: boolean;
  daily_report_enabled: boolean;
  weekly_report_enabled: boolean;
  weekly_report_day: number;
  report_time: string;
  accept_messages_from: 'self_only' | 'all';
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
      const { data, error } = await supabase.functions.invoke('whatsapp-connect');
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-connection'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    },
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('whatsapp-disconnect');
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-connection'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    },
  });

  const updateSettings = useMutation({
    mutationFn: async (settings: { reminders_enabled?: boolean; daily_report_enabled?: boolean; weekly_report_enabled?: boolean; weekly_report_day?: number; report_time?: string; accept_messages_from?: 'self_only' | 'all' }) => {
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

  // Poll for status changes when QR is pending - calls whatsapp-status to check Evolution API
  const checkStatus = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('whatsapp-status');
      if (!error && data?.status === 'connected') {
        queryClient.invalidateQueries({ queryKey: ['whatsapp-connection'] });
      }
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
    if (connectionQuery.data?.status === 'qr_pending') {
      startPolling();
    } else {
      stopPolling();
    }
    return stopPolling;
  }, [connectionQuery.data?.status, startPolling, stopPolling]);

  const reregisterWebhook = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('whatsapp-status');
      if (error) throw error;
      return data;
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
