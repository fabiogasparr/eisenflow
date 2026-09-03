import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import {
  calculateLevel,
  calculateLifeScore,
  XP_REWARDS,
  type GamificationStats,
} from '@/lib/gamification';
import { useToast } from '@/hooks/use-toast';
import { create, upsert, findOne, listDocs, Query } from '@/integrations/appwrite/database';
import { ownerOnly } from '@/integrations/appwrite/permissions';

export function useGamification() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const statsQuery = useQuery({
    queryKey: ['gamification', user?.$id],
    queryFn: async (): Promise<GamificationStats | null> => {
      if (!user) return null;
      const existing = await findOne('gamification', [Query.equal('user_id', user.$id)]);
      if (existing) return existing as unknown as GamificationStats;

      // Primeiro acesso: cria o registro inicial. PERMISSÕES DO DOCUMENTO —
      // substitui as policies "Users can view/insert/update their own
      // gamification": ownerOnly grava ler/editar/apagar só para o dono.
      // Sem isto o próprio usuário não enxergaria o registro na próxima query.
      const created = await create('gamification', { user_id: user.$id }, ownerOnly(user.$id));
      return created as unknown as GamificationStats;
    },
    enabled: !!user,
  });

  const badgesQuery = useQuery({
    queryKey: ['user_badges', user?.$id],
    queryFn: async (): Promise<string[]> => {
      if (!user) return [];
      // `user_badges` é server-doc: o cliente SÓ LÊ. O Query.equal acha as
      // linhas; quem garante que são as do próprio usuário é a permissão de
      // leitura que o servidor gravou no documento ao conceder a badge.
      const docs = await listDocs('user_badges', [Query.equal('user_id', user.$id)]);
      return docs.map((b) => b.badge_id);
    },
    enabled: !!user,
  });

  const recordAction = useMutation({
    mutationFn: async (action: 'complete' | 'eliminate' | 'delegate' | 'focus_minutes' | 'pomodoro') => {
      if (!user || !statsQuery.data) return;
      const stats = statsQuery.data;
      const today = new Date().toISOString().split('T')[0];

      let xpGain = 0;
      const updates: Record<string, unknown> = {};

      switch (action) {
        case 'complete':
          updates.total_tasks_completed = stats.total_tasks_completed + 1;
          xpGain = XP_REWARDS.TASK_COMPLETED;
          break;
        case 'eliminate':
          updates.total_tasks_eliminated = stats.total_tasks_eliminated + 1;
          xpGain = XP_REWARDS.TASK_ELIMINATED;
          break;
        case 'delegate':
          updates.total_tasks_delegated = stats.total_tasks_delegated + 1;
          xpGain = XP_REWARDS.TASK_DELEGATED;
          break;
        case 'focus_minutes':
          updates.total_focus_minutes = stats.total_focus_minutes + 1;
          xpGain = XP_REWARDS.FOCUS_MINUTE;
          break;
        case 'pomodoro':
          updates.total_pomodoros = (stats.total_pomodoros ?? 0) + 1;
          xpGain = XP_REWARDS.POMODORO_COMPLETED;
          break;
      }

      // Streak logic
      const lastActive = stats.last_active_date;
      if (lastActive !== today) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        if (lastActive === yesterdayStr) {
          updates.current_streak = stats.current_streak + 1;
          xpGain += XP_REWARDS.STREAK_DAY;
        } else if (lastActive !== today) {
          updates.current_streak = 1;
        }
        updates.last_active_date = today;
      }

      const newStreak = (updates.current_streak as number) ?? stats.current_streak;
      if (newStreak > stats.longest_streak) {
        updates.longest_streak = newStreak;
      }

      const newXp = stats.xp + xpGain;
      updates.xp = newXp;
      updates.level = calculateLevel(newXp);

      // Compute new stats for life score
      const newStats = { ...stats, ...updates };
      updates.life_score = calculateLifeScore(newStats as GamificationStats);

      // Era `.upsert({ user_id }, { onConflict: 'user_id' })`: o helper procura
      // pelo mesmo filtro lógico, atualiza se achar e cria se não achar.
      // As permissões vão junto porque, no caminho de CRIAÇÃO, é o único momento
      // em que a regra de acesso é gravada no documento (ownerOnly = as policies
      // "own gamification" do Postgres).
      await upsert(
        'gamification',
        [Query.equal('user_id', user.$id)],
        { user_id: user.$id, ...updates } as never,
        ownerOnly(user.$id),
      );

      // BADGES — no Postgres a concessão era `rpc('award_badge_if_earned')`, uma
      // função SECURITY DEFINER: ela rodava com privilégio elevado justamente
      // porque o usuário não podia escrever em user_badges por conta própria.
      // No Appwrite o equivalente é uma Appwrite Function: `user_badges` é
      // server-doc, então o cliente não concede badge — ele só lê o que já
      // ganhou (badgesQuery acima).
      // TODO(migração): criar a Function 'award-badges' que recebe o user_id,
      // reavalia BADGES contra o registro de gamification, grava as novas linhas
      // com Permission.read(Role.user(uid)) e devolve as concedidas — para o
      // cliente poder exibir o toast de conquista como fazia antes.
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gamification'] });
      queryClient.invalidateQueries({ queryKey: ['user_badges'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    },
  });

  return {
    stats: statsQuery.data,
    earnedBadgeIds: badgesQuery.data ?? [],
    isLoading: statsQuery.isLoading,
    recordAction,
  };
}
