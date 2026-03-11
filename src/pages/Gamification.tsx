import { useMemo } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { useLanguage } from '@/i18n/LanguageContext';
import { useGamification } from '@/hooks/useGamification';
import { BADGES, xpForNextLevel, currentLevelXp } from '@/lib/gamification';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Flame, Trophy, Target, Zap, Star, TrendingUp } from 'lucide-react';

export default function Gamification() {
  const { language } = useLanguage();
  const { stats, earnedBadgeIds, isLoading } = useGamification();
  const pt = language === 'pt-BR';

  const levelProgress = useMemo(() => {
    if (!stats) return 0;
    const current = currentLevelXp(stats.xp, stats.level);
    const needed = xpForNextLevel(stats.level);
    return Math.round((current / needed) * 100);
  }, [stats]);

  const currentXpInLevel = useMemo(() => {
    if (!stats) return 0;
    return currentLevelXp(stats.xp, stats.level);
  }, [stats]);

  if (isLoading || !stats) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-full">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </AppLayout>
    );
  }

  const scoreColor = stats.life_score >= 70 ? 'text-quadrant-do' : stats.life_score >= 40 ? 'text-quadrant-schedule' : 'text-quadrant-eliminate';
  const scoreLabel = stats.life_score >= 80 ? (pt ? 'Excelente' : 'Excellent') 
    : stats.life_score >= 60 ? (pt ? 'Bom' : 'Good')
    : stats.life_score >= 40 ? (pt ? 'Regular' : 'Average')
    : (pt ? 'Precisa melhorar' : 'Needs improvement');

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
        <h1 className="font-display text-2xl font-bold">
          {pt ? 'Gamificação' : 'Gamification'}
        </h1>

        {/* Top stats row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Level & XP */}
          <Card className="col-span-2 border-primary/20">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
                  <Star className="h-8 w-8 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-muted-foreground">{pt ? 'Nível' : 'Level'}</p>
                  <p className="font-display text-3xl font-bold">{stats.level}</p>
                  <div className="mt-2 space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{currentXpInLevel} XP</span>
                      <span>{xpForNextLevel(stats.level)} XP</span>
                    </div>
                    <Progress value={levelProgress} className="h-2" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Streak */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Flame className={`h-8 w-8 ${stats.current_streak > 0 ? 'text-quadrant-schedule' : 'text-muted-foreground'}`} />
                <div>
                  <p className="font-display text-3xl font-bold">{stats.current_streak}</p>
                  <p className="text-xs text-muted-foreground">{pt ? 'Dias seguidos' : 'Day streak'}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {pt ? 'Recorde' : 'Best'}: {stats.longest_streak} {pt ? 'dias' : 'days'}
              </p>
            </CardContent>
          </Card>

          {/* Total XP */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Zap className="h-8 w-8 text-primary" />
                <div>
                  <p className="font-display text-3xl font-bold">{stats.xp}</p>
                  <p className="text-xs text-muted-foreground">XP {pt ? 'total' : 'Total'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Life Score */}
        <Card>
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              {pt ? 'Score de Vida Produtiva' : 'Productive Life Score'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-8">
              <div className="text-center">
                <p className={`font-display text-6xl font-bold ${scoreColor}`}>{stats.life_score}</p>
                <p className="text-sm text-muted-foreground mt-1">{scoreLabel}</p>
              </div>
              <div className="flex-1 space-y-3">
                <ScoreBar
                  label={pt ? 'Tarefas concluídas' : 'Tasks completed'}
                  value={Math.min(stats.total_tasks_completed * 2, 30)}
                  max={30}
                  color="bg-quadrant-do"
                />
                <ScoreBar
                  label={pt ? 'Streak' : 'Streak'}
                  value={Math.min(stats.current_streak * 5, 25)}
                  max={25}
                  color="bg-quadrant-schedule"
                />
                <ScoreBar
                  label={pt ? 'Eliminadas' : 'Eliminated'}
                  value={Math.min(stats.total_tasks_eliminated * 3, 15)}
                  max={15}
                  color="bg-quadrant-eliminate"
                />
                <ScoreBar
                  label={pt ? 'Delegadas' : 'Delegated'}
                  value={Math.min(stats.total_tasks_delegated * 3, 15)}
                  max={15}
                  color="bg-quadrant-delegate"
                />
                <ScoreBar
                  label={pt ? 'Foco' : 'Focus'}
                  value={Math.min(stats.total_focus_minutes / 10, 15)}
                  max={15}
                  color="bg-primary"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Activity stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatMini icon="✅" value={stats.total_tasks_completed} label={pt ? 'Concluídas' : 'Completed'} />
          <StatMini icon="🗑️" value={stats.total_tasks_eliminated} label={pt ? 'Eliminadas' : 'Eliminated'} />
          <StatMini icon="🤝" value={stats.total_tasks_delegated} label={pt ? 'Delegadas' : 'Delegated'} />
          <StatMini icon="🧘" value={`${stats.total_focus_minutes}m`} label={pt ? 'Minutos foco' : 'Focus minutes'} />
        </div>

        {/* Badges */}
        <Card>
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              {pt ? 'Conquistas' : 'Achievements'}
              <Badge variant="secondary" className="ml-2">{earnedBadgeIds.length}/{BADGES.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {BADGES.map((badge) => {
                const earned = earnedBadgeIds.includes(badge.id);
                return (
                  <div
                    key={badge.id}
                    className={`rounded-xl border-2 p-4 text-center transition-all ${
                      earned
                        ? 'border-primary/30 bg-primary/5 shadow-sm'
                        : 'border-border bg-muted/30 opacity-40 grayscale'
                    }`}
                  >
                    <span className="text-3xl block mb-2">{badge.icon}</span>
                    <p className="text-xs font-semibold truncate">
                      {pt ? badge.labelPt : badge.labelEn}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                      {pt ? badge.descPt : badge.descEn}
                    </p>
                    {earned && (
                      <Badge variant="outline" className="mt-2 text-[9px] h-4 px-1.5 text-primary border-primary/30">
                        ✓ {pt ? 'Conquistado' : 'Earned'}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

function ScoreBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{Math.round(value)}/{max}</span>
      </div>
      <div className="h-2 rounded-full bg-secondary overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StatMini({ icon, value, label }: { icon: string; value: number | string; label: string }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4 text-center">
        <span className="text-2xl">{icon}</span>
        <p className="font-display text-xl font-bold mt-1">{value}</p>
        <p className="text-[10px] text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
