import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  BADGES,
  calculateLevel,
  calculateLifeScore,
  XP_REWARDS,
  type GamificationStats,
} from '@/lib/gamification';
import { useToast } from '@/hooks/use-toast';

export function useGamification() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const statsQuery = useQuery({
    queryKey: ['gamification', user?.id],
    queryFn: async (): Promise<GamificationStats | null> => {
      if (!user) return null;
      const { data, error } = await supabase
        .from('gamification')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        // Create initial record
        const { data: newData, error: insertErr } = await supabase
          .from('gamification')
          .insert({ user_id: user.id })
          .select()
          .single();
        if (insertErr) throw insertErr;
        return newData as unknown as GamificationStats;
      }
      return data as unknown as GamificationStats;
    },
    enabled: !!user,
  });

  const badgesQuery = useQuery({
    queryKey: ['user_badges', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('user_badges')
        .select('*')
        .eq('user_id', user.id);
      if (error) throw error;
      return data.map((b: any) => b.badge_id as string);
    },
    enabled: !!user,
  });

  const recordAction = useMutation({
    mutationFn: async (action: 'complete' | 'eliminate' | 'delegate' | 'focus_minutes') => {
      if (!user || !statsQuery.data) return;
      const stats = statsQuery.data;
      const today = new Date().toISOString().split('T')[0];

      let xpGain = 0;
      const updates: Record<string, any> = {};

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

      const newStreak = updates.current_streak ?? stats.current_streak;
      if (newStreak > stats.longest_streak) {
        updates.longest_streak = newStreak;
      }

      const newXp = stats.xp + xpGain;
      updates.xp = newXp;
      updates.level = calculateLevel(newXp);

      // Compute new stats for life score
      const newStats = { ...stats, ...updates };
      updates.life_score = calculateLifeScore(newStats as GamificationStats);

      const { error } = await supabase
        .from('gamification')
        .update(updates)
        .eq('user_id', user.id);
      if (error) throw error;

      // Check for new badges
      const earnedBadges = badgesQuery.data ?? [];
      const fullStats = { ...stats, ...updates } as GamificationStats;

      for (const badge of BADGES) {
        if (!earnedBadges.includes(badge.id) && badge.condition(fullStats)) {
          await supabase
            .from('user_badges')
            .insert({ user_id: user.id, badge_id: badge.id });
          // Toast for new badge
          toast({
            title: `${badge.icon} ${badge.labelPt}`,
            description: badge.descPt,
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gamification'] });
      queryClient.invalidateQueries({ queryKey: ['user_badges'] });
    },
  });

  return {
    stats: statsQuery.data,
    earnedBadgeIds: badgesQuery.data ?? [],
    isLoading: statsQuery.isLoading,
    recordAction,
  };
}
