import { useQuery } from '@tanstack/react-query';
import { invoke } from '@/integrations/supabase/functions';
import { useGoogleCalendar } from '@/hooks/useGoogleCalendar';

export interface GoogleEvent {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  htmlLink: string;
}

export type CalendarItem =
  | { type: 'task'; data: import('@/types/task').Task }
  | { type: 'google-event'; data: GoogleEvent };

export function useGoogleCalendarEvents(timeMin: string | null, timeMax: string | null) {
  const { isConnected, tokenData, tenantId } = useGoogleCalendar();
  const enabled = isConnected && !!tenantId && !!tokenData?.sync_enabled && !!timeMin && !!timeMax;

  return useQuery({
    // O tenant entra na chave: cada organização tem a própria conta Google.
    queryKey: ['google-calendar-events', tenantId, timeMin, timeMax],
    queryFn: async () => {
      // Os eventos vêm da Function: o token do Google fica no servidor e o
      // cliente nunca fala direto com a API do Google.
      const data = await invoke<{ events?: GoogleEvent[] }>('google-calendar-sync', {
        action: 'list-events',
        tenant_id: tenantId,
        timeMin,
        timeMax,
      });
      return data?.events ?? [];
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
