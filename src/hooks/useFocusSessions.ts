import { useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useQuery } from '@tanstack/react-query';

export function useFocusSessions() {
  const { user } = useAuth();
  const activeSessionId = useRef<string | null>(null);
  const sessionStartTime = useRef<number>(0);

  const startSession = useCallback(async (taskId: string, phase: string = 'focus') => {
    if (!user) return;
    // End any existing session first
    await endSession();

    sessionStartTime.current = Date.now();

    const { data } = await supabase
      .from('task_focus_sessions' as any)
      .insert({
        task_id: taskId,
        user_id: user.id,
        phase,
        started_at: new Date().toISOString(),
        duration_seconds: 0,
      } as any)
      .select('id')
      .single();

    if (data) {
      activeSessionId.current = (data as any).id;
    }
  }, [user]);

  const endSession = useCallback(async () => {
    if (!activeSessionId.current || !user) return;

    const durationSeconds = Math.floor((Date.now() - sessionStartTime.current) / 1000);
    if (durationSeconds < 1) {
      activeSessionId.current = null;
      return;
    }

    await supabase
      .from('task_focus_sessions' as any)
      .update({
        ended_at: new Date().toISOString(),
        duration_seconds: durationSeconds,
      } as any)
      .eq('id', activeSessionId.current);

    activeSessionId.current = null;
    sessionStartTime.current = 0;
  }, [user]);

  const pauseSession = useCallback(async () => {
    await endSession();
  }, [endSession]);

  const resumeSession = useCallback(async (taskId: string, phase: string = 'focus') => {
    await startSession(taskId, phase);
  }, [startSession]);

  return { startSession, endSession, pauseSession, resumeSession };
}

export function useTaskFocusTime(taskId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['task-focus-time', taskId],
    queryFn: async () => {
      if (!taskId || !user) return 0;
      const { data } = await supabase
        .from('task_focus_sessions' as any)
        .select('duration_seconds')
        .eq('task_id', taskId)
        .eq('user_id', user.id);

      if (!data) return 0;
      return (data as any[]).reduce((sum: number, s: any) => sum + (s.duration_seconds || 0), 0) as number;
    },
    enabled: !!taskId && !!user,
  });
}
