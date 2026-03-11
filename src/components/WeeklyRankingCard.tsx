import { useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/LanguageContext';
import { useGamification } from '@/hooks/useGamification';
import { useTasks } from '@/hooks/useTasks';
import { BADGES } from '@/lib/gamification';
import { Share2, Twitter, Linkedin, Copy, Check } from 'lucide-react';
import { useState, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

function getWeekRange(): { start: Date; end: Date; label: string; labelPt: string } {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const start = new Date(now);
  start.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  const fmt = (d: Date) => `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
  return {
    start,
    end,
    label: `${fmt(start)} – ${fmt(end)}`,
    labelPt: `${fmt(start)} – ${fmt(end)}`,
  };
}

export function WeeklyRankingCard() {
  const { language } = useLanguage();
  const { stats, earnedBadgeIds } = useGamification();
  const { tasks } = useTasks();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const pt = language === 'pt-BR';
  const week = getWeekRange();

  const weeklyStats = useMemo(() => {
    const weekStart = week.start.toISOString();
    const weekEnd = week.end.toISOString();

    const weekTasks = tasks.filter(
      (t) => t.created_at >= weekStart && t.created_at <= weekEnd
    );
    const completed = weekTasks.filter((t) => t.status === 'completed').length;
    const eliminated = weekTasks.filter((t) => t.status === 'eliminated').length;
    const total = weekTasks.length;

    return { completed, eliminated, total };
  }, [tasks, week]);

  const recentBadges = useMemo(() => {
    return BADGES.filter((b) => earnedBadgeIds.includes(b.id)).slice(0, 5);
  }, [earnedBadgeIds]);

  if (!stats) return null;

  const shareText = pt
    ? `🎯 Minha semana em foco no EisenFlow!\n\n🏆 Nível ${stats.level} | 🔥 ${stats.current_streak} dias de streak\n✅ ${weeklyStats.completed} tarefas concluídas\n📊 Score: ${stats.life_score}/100\n${recentBadges.map((b) => b.icon).join(' ')}\n\n#EisenFlow #Produtividade`
    : `🎯 My week in focus on EisenFlow!\n\n🏆 Level ${stats.level} | 🔥 ${stats.current_streak} day streak\n✅ ${weeklyStats.completed} tasks completed\n📊 Score: ${stats.life_score}/100\n${recentBadges.map((b) => b.icon).join(' ')}\n\n#EisenFlow #Productivity`;

  const shareUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(shareText);
    setCopied(true);
    toast({ title: pt ? 'Copiado!' : 'Copied!', description: pt ? 'Texto copiado para a área de transferência' : 'Text copied to clipboard' });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTwitter = () => {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;
    window.open(url, '_blank', 'width=600,height=400');
  };

  const handleLinkedin = () => {
    const url = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;
    window.open(url, '_blank', 'width=600,height=400');
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'EisenFlow', text: shareText, url: shareUrl });
      } catch {
        // User cancelled
      }
    }
  };

  const scoreGradient = stats.life_score >= 70
    ? 'from-quadrant-do/20 to-quadrant-do/5'
    : stats.life_score >= 40
    ? 'from-quadrant-schedule/20 to-quadrant-schedule/5'
    : 'from-quadrant-eliminate/20 to-quadrant-eliminate/5';

  const scoreColor = stats.life_score >= 70
    ? 'text-quadrant-do'
    : stats.life_score >= 40
    ? 'text-quadrant-schedule'
    : 'text-quadrant-eliminate';

  return (
    <Card className="overflow-hidden">
      {/* Shareable card visual */}
      <div className={`bg-gradient-to-br ${scoreGradient} p-6`}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-display text-lg font-bold">
              {pt ? '📊 Minha Semana em Foco' : '📊 My Week in Focus'}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">{week.label}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">EisenFlow</p>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="rounded-xl bg-card/60 backdrop-blur-sm p-3 text-center">
            <p className="font-display text-2xl font-bold">{stats.level}</p>
            <p className="text-[10px] text-muted-foreground">{pt ? 'Nível' : 'Level'}</p>
          </div>
          <div className="rounded-xl bg-card/60 backdrop-blur-sm p-3 text-center">
            <p className="font-display text-2xl font-bold">{stats.current_streak}</p>
            <p className="text-[10px] text-muted-foreground">🔥 Streak</p>
          </div>
          <div className="rounded-xl bg-card/60 backdrop-blur-sm p-3 text-center">
            <p className="font-display text-2xl font-bold">{weeklyStats.completed}</p>
            <p className="text-[10px] text-muted-foreground">{pt ? 'Concluídas' : 'Done'}</p>
          </div>
          <div className="rounded-xl bg-card/60 backdrop-blur-sm p-3 text-center">
            <p className={`font-display text-2xl font-bold ${scoreColor}`}>{stats.life_score}</p>
            <p className="text-[10px] text-muted-foreground">Score</p>
          </div>
        </div>

        {/* Recent badges */}
        {recentBadges.length > 0 && (
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-muted-foreground">
              {pt ? 'Conquistas:' : 'Badges:'}
            </span>
            <div className="flex gap-1">
              {recentBadges.map((badge) => (
                <span key={badge.id} className="text-lg" title={pt ? badge.labelPt : badge.labelEn}>
                  {badge.icon}
                </span>
              ))}
            </div>
            {earnedBadgeIds.length > 5 && (
              <span className="text-xs text-muted-foreground">
                +{earnedBadgeIds.length - 5}
              </span>
            )}
          </div>
        )}

        {/* XP bar */}
        <div className="rounded-full bg-card/40 h-2 overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.min((stats.xp % (stats.level * 100)) / (stats.level * 100) * 100, 100)}%` }}
          />
        </div>
        <p className="text-[10px] text-muted-foreground mt-1 text-right">{stats.xp} XP</p>
      </div>

      {/* Share actions */}
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-muted-foreground flex-1">
            {pt ? 'Compartilhe seu progresso:' : 'Share your progress:'}
          </p>

          <Button
            variant="outline"
            size="sm"
            onClick={handleTwitter}
            className="gap-1.5"
          >
            <Twitter className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">X</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleLinkedin}
            className="gap-1.5"
          >
            <Linkedin className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">LinkedIn</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="gap-1.5"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{pt ? 'Copiar' : 'Copy'}</span>
          </Button>

          {'share' in navigator && (
            <Button
              variant="default"
              size="sm"
              onClick={handleNativeShare}
              className="gap-1.5"
            >
              <Share2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{pt ? 'Mais' : 'More'}</span>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
