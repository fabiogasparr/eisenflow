import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useCallback, useEffect, useRef } from 'react';
import { findOne, Query } from '@/integrations/appwrite/database';
import { invoke } from '@/integrations/appwrite/functions';

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
  weekly_report_time: string;
  accept_messages_from: 'self_only' | 'all';
  reminder_times: string;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export type WhatsAppSettings = {
  reminders_enabled?: boolean;
  daily_report_enabled?: boolean;
  weekly_report_enabled?: boolean;
  weekly_report_day?: number;
  report_time?: string;
  weekly_report_time?: string;
  accept_messages_from?: 'self_only' | 'all';
  reminder_times?: string;
  timezone?: string;
};

/**
 * `whatsapp_connections` é server-doc: quem CRIA e ATUALIZA o registro é sempre
 * uma Function (whatsapp-connect / whatsapp-disconnect / whatsapp-status), que
 * concede leitura do documento ao dono. Por isso aqui só existe leitura direta;
 * toda escrita vira chamada de Function.
 */
export function useWhatsApp() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const connectionQuery = useQuery({
    queryKey: ['whatsapp-connection', user?.$id],
    queryFn: async (): Promise<WhatsAppConnection | null> => {
      if (!user) return null;
      const doc = await findOne('whatsapp_connections', [Query.equal('user_id', user.$id)]);
      return (doc as unknown as WhatsAppConnection) ?? null;
    },
    enabled: !!user,
  });

  const connect = useMutation({
    mutationFn: async () => {
      // O fuso do navegador vai junto na criação: o cliente não pode gravar em
      // whatsapp_connections depois, então não dá para "corrigir" o campo com
      // um UPDATE logo após o connect, como era feito no backend antigo.
      // TODO(migração): whatsapp-connect precisa aceitar este `timezone`
      // opcional no corpo (o scaffold hoje descreve a function como "sem corpo").
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
      return invoke<{ status?: string; qr_code?: string; webhook_registered?: boolean }>(
        'whatsapp-connect',
        { timezone },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-connection'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    },
  });

  const disconnect = useMutation({
    mutationFn: async () => invoke<{ status?: string }>('whatsapp-disconnect'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-connection'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    },
  });

  const updateSettings = useMutation({
    mutationFn: async (settings: WhatsAppSettings) => {
      if (!user) throw new Error('Not authenticated');
      // TODO(migração): não existe Function equivalente ao UPDATE que o cliente
      // fazia em whatsapp_connections. A collection é server-doc (só a API key
      // escreve) e as três Functions previstas — whatsapp-connect,
      // whatsapp-disconnect e whatsapp-status — não expõem edição de
      // preferências. Falta criar uma Function `whatsapp-settings` (ou uma
      // action de settings em whatsapp-status) que valide a sessão e grave só
      // estes campos. Até lá a chamada falha alto em vez de fingir que salvou.
      throw new Error(
        'Preferências do WhatsApp ainda não migradas: whatsapp_connections é server-doc e ' +
          'falta a Function que grava estas configurações. Campos pedidos: ' +
          `${Object.keys(settings).join(', ') || '(nenhum)'}.`,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-connection'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    },
  });

  // Enquanto o QR está pendente, whatsapp-status consulta a Evolution e
  // atualiza o documento no servidor; aqui só reagimos ao resultado.
  const checkStatus = useCallback(async () => {
    try {
      const data = await invoke<{ status?: string }>('whatsapp-status');
      if (data?.status === 'connected') {
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
    mutationFn: async () => invoke<{ webhook_reregistered?: boolean }>('whatsapp-status'),
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
