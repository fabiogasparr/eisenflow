import { useQuery } from '@tanstack/react-query';
import { listDocs, listAll, Query } from '@/integrations/appwrite/database';
import { useLanguage } from '@/i18n/LanguageContext';
import { useTeamMembers } from '@/hooks/useTeams';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Clock, ListTodo, TrendingUp, Target, Zap, Calendar, Trash2 } from 'lucide-react';
import type { Task } from '@/types/task';

interface TeamDashboardProps {
  teamId: string;
}

export function TeamDashboard({ teamId }: TeamDashboardProps) {
  const { t } = useLanguage();
  const { members } = useTeamMembers(teamId);

  const { data: teamTasks = [], isLoading } = useQuery({
    queryKey: ['team_tasks', teamId],
    queryFn: async (): Promise<Task[]> => {
      // Projetos do time. Só chegam os que a permissão do documento libera para
      // esta sessão — o recorte que a RLS fazia a cada query.
      const projects = await listDocs('projects', [
        Query.equal('team_id', teamId),
        Query.limit(100),
      ]);
      if (projects.length === 0) return [];

      // `.in('project_id', ids)` vira Query.equal com array. listAll pagina com
      // cursor: um time pode passar bem do teto de 100 tarefas por request.
      const projectIds = projects.map((p) => p.id);
      const tasks = await listAll('tasks', [Query.equal('project_id', projectIds)]);
      return tasks as unknown as Task[];
    },
    enabled: !!teamId,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const total = teamTasks.length;
  const completed = teamTasks.filter((t) => t.status === 'completed').length;
  const inProgress = teamTasks.filter((t) => t.status === 'in_progress').length;
  const pending = teamTasks.filter((t) => t.status === 'pending').length;
  const eliminated = teamTasks.filter((t) => t.status === 'eliminated').length;
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  const quadrantCounts = {
    do: teamTasks.filter((t) => t.quadrant === 'do').length,
    schedule: teamTasks.filter((t) => t.quadrant === 'schedule').length,
    delegate: teamTasks.filter((t) => t.quadrant === 'delegate').length,
    eliminate: teamTasks.filter((t) => t.quadrant === 'eliminate').length,
  };

  // Aggregate per member
  const memberStats = members.map((member) => {
    const memberTasks = teamTasks.filter(
      (t) => t.created_by === member.user_id || t.assigned_to === member.user_id
    );
    const mCompleted = memberTasks.filter((t) => t.status === 'completed').length;
    const mTotal = memberTasks.length;
    return {
      ...member,
      total: mTotal,
      completed: mCompleted,
      inProgress: memberTasks.filter((t) => t.status === 'in_progress').length,
      pending: memberTasks.filter((t) => t.status === 'pending').length,
      rate: mTotal > 0 ? Math.round((mCompleted / mTotal) * 100) : 0,
    };
  });

  const quadrantConfig = [
    { key: 'do' as const, label: t('doNow'), color: 'bg-destructive', icon: Zap },
    { key: 'schedule' as const, label: t('schedule'), color: 'bg-primary', icon: Calendar },
    { key: 'delegate' as const, label: t('delegate'), color: 'bg-accent', icon: Target },
    { key: 'eliminate' as const, label: t('eliminate'), color: 'bg-muted-foreground', icon: Trash2 },
  ];

  return (
    <div className="space-y-5">
      {/* Overview Cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <ListTodo className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">{t('teamOverview')}</span>
            </div>
            <p className="text-2xl font-bold font-display">{total}</p>
            <p className="text-xs text-muted-foreground">{t('totalTasks')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <TrendingUp className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">{t('completionRate')}</span>
            </div>
            <p className="text-2xl font-bold font-display">{completionRate}%</p>
            <Progress value={completionRate} className="h-1.5 mt-1" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">{t('tasksCompleted')}</span>
            </div>
            <p className="text-2xl font-bold font-display text-primary">{completed}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Clock className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">{t('inProgress')}</span>
            </div>
            <p className="text-2xl font-bold font-display">{inProgress}</p>
          </CardContent>
        </Card>
      </div>

      {/* Quadrant Distribution */}
      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="text-sm font-semibold">{t('quadrantDistribution')}</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="space-y-2">
            {quadrantConfig.map(({ key, label, color, icon: Icon }) => {
              const count = quadrantCounts[key];
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <div key={key} className="flex items-center gap-3">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs w-20 truncate">{label}</span>
                  <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                    <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground w-8 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Member Performance */}
      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="text-sm font-semibold">{t('memberPerformance')}</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {memberStats.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t('noTasks')}
            </p>
          ) : (
            <div className="space-y-3">
              {memberStats.map((m) => (
                <div key={m.id} className="flex items-center gap-3">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="text-[10px] bg-secondary">
                      {(m.profile?.display_name || '?').charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium truncate">
                        {m.profile?.display_name || '—'}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                          {m.completed}/{m.total}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground w-7 text-right">{m.rate}%</span>
                      </div>
                    </div>
                    <Progress value={m.rate} className="h-1" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
