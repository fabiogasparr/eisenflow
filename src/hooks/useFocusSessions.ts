import { useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { create, update, listAll, Query } from '@/integrations/appwrite/database';
import { ownerOnly } from '@/integrations/appwrite/permissions';

export function useFocusSessions() {
  const { user } = useAuth();
  const activeSessionId = useRef<string | null>(null);
  const sessionStartTime = useRef<number>(0);

  const endSession = useCallback(async () => {
    if (!activeSessionId.current || !user) return;

    const durationSeconds = Math.floor((Date.now() - sessionStartTime.current) / 1000);
    if (durationSeconds < 1) {
      activeSessionId.current = null;
      return;
    }

    // Fechar a sessão não muda o dono: as permissões gravadas na criação seguem
    // valendo, então não passamos o 3º argumento de update().
    await update('task_focus_sessions', activeSessionId.current, {
      ended_at: new Date().toISOString(),
      duration_seconds: durationSeconds,
    });

    activeSessionId.current = null;
    sessionStartTime.current = 0;
  }, [user]);

  const startSession = useCallback(async (taskId: string, phase: string = 'focus') => {
    if (!user) return;
    // End any existing session first
    await endSession();

    sessionStartTime.current = Date.now();

    // PERMISSÕES: as policies "Users can view/insert/update their own focus
    // sessions" eram todas `auth.uid() = user_id` — ninguém além do dono via a
    // sessão, nem o criador da tarefa. É o ownerOnly. Repare que aqui NÃO se
    // herda as permissões da tarefa: tempo de foco é dado privado de quem
    // trabalhou, e herdar abriria isso para o time do tenant.
    const doc = await create(
      'task_focus_sessions',
      {
        task_id: taskId,
        user_id: user.$id,
        phase,
        started_at: new Date().toISOString(),
        duration_seconds: 0,
      },
      ownerOnly(user.$id),
    );

    activeSessionId.current = doc.id;
  }, [user, endSession]);

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
      // Uma tarefa longa acumula muitas sessões: listAll pagina com cursor
      // (o Appwrite devolve no máximo 100 por request).
      // O filtro por user_id é redundante com a permissão do documento, mas
      // mantido por ser o mesmo recorte da policy antiga.
      const docs = await listAll('task_focus_sessions', [
        Query.equal('task_id', taskId),
        Query.equal('user_id', user.$id),
      ]);
      return docs.reduce((sum, s) => sum + (s.duration_seconds || 0), 0);
    },
    enabled: !!taskId && !!user,
  });
}
