import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
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
  const { isConnected, tokenData } = useGoogleCalendar();
  const enabled = isConnected && !!tokenData?.sync_enabled && !!timeMin && !!timeMax;

  return useQuery({
    queryKey: ['google-calendar-events', timeMin, timeMax],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('google-calendar-sync', {
        body: { action: 'list-events', timeMin, timeMax },
      });
      if (error) throw error;
      return (data?.events ?? []) as GoogleEvent[];
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
