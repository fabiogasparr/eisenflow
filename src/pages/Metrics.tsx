import { useMemo } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { useLanguage } from '@/i18n/LanguageContext';
import { useTasks } from '@/hooks/useTasks';
import { useGamification } from '@/hooks/useGamification';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { CheckCircle, Trash2, Users, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';
import { QUADRANT_CONFIG, type Quadrant } from '@/types/task';

export default function Metrics() {
  const { t, language } = useLanguage();
  const { tasks } = useTasks();
  const { stats: gamStats } = useGamification();

  const stats = useMemo(() => {
    const completed = tasks.filter(t => t.status === 'completed').length;
    const eliminated = tasks.filter(t => t.status === 'eliminated').length;
    const delegated = tasks.filter(t => t.quadrant === 'delegate').length;
    const importantTime = tasks
      .filter(t => t.quadrant === 'do' || t.quadrant === 'schedule')
      .reduce((acc, t) => acc + (t.estimated_time ?? 0), 0);

    return { completed, eliminated, delegated, importantTime };
  }, [tasks]);

  const quadrantData = useMemo(() => {
    return (['do', 'schedule', 'delegate', 'eliminate'] as Quadrant[]).map(q => ({
      name: t(QUADRANT_CONFIG[q].labelKey),
      value: tasks.filter(t => t.quadrant === q).length,
      quadrant: q,
    }));
  }, [tasks, t]);

  const totalPomodoros = gamStats?.total_pomodoros ?? 0;
  const totalFocusMinutes = gamStats?.total_focus_minutes ?? 0;

  // Estimate weekly pomodoros (simple: total / weeks since first use, or just show total)
  const pomodoroEstimate = useMemo(() => {
    const focusHours = Math.floor(totalFocusMinutes / 60);
    const focusMins = totalFocusMinutes % 60;
    return { focusHours, focusMins };
  }, [totalFocusMinutes]);

  const COLORS = [
    'hsl(80, 61%, 50%)',
    'hsl(33, 100%, 50%)',
    'hsl(195, 53%, 60%)',
    'hsl(348, 83%, 47%)',
  ];

  const statCards = [
    { label: t('tasksCompleted'), value: stats.completed, icon: CheckCircle, color: 'text-quadrant-do' },
    { label: t('tasksEliminated'), value: stats.eliminated, icon: Trash2, color: 'text-quadrant-eliminate' },
    { label: t('tasksDelegated'), value: stats.delegated, icon: Users, color: 'text-quadrant-delegate' },
    { label: t('timeInImportant'), value: `${stats.importantTime} ${t('minutes')}`, icon: Clock, color: 'text-quadrant-schedule' },
  ];

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6">
        <h1 className="font-display text-2xl font-bold">{t('metrics')}</h1>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {statCards.map((stat) => (
            <Card key={stat.label}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <stat.icon className={`h-8 w-8 ${stat.color}`} />
                  <div>
                    <p className="text-2xl font-bold font-display">{stat.value}</p>
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Pomodoro Stats */}
        <Card className="border-destructive/20">
          <CardHeader>
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <span>🍅</span> Pomodoro
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
              <div className="text-center space-y-1">
                <p className="text-4xl font-bold font-display text-destructive">{totalPomodoros}</p>
                <p className="text-xs text-muted-foreground">
                  {language === 'pt-BR' ? 'Pomodoros completados' : 'Pomodoros completed'}
                </p>
              </div>
              <div className="text-center space-y-1">
                <p className="text-4xl font-bold font-display text-quadrant-schedule">
                  {pomodoroEstimate.focusHours > 0
                    ? `${pomodoroEstimate.focusHours}h${pomodoroEstimate.focusMins > 0 ? ` ${pomodoroEstimate.focusMins}m` : ''}`
                    : `${pomodoroEstimate.focusMins}m`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {language === 'pt-BR' ? 'Tempo total em foco' : 'Total focus time'}
                </p>
              </div>
              <div className="text-center space-y-1">
                <p className="text-4xl font-bold font-display text-primary">
                  {totalPomodoros > 0 ? Math.round((totalFocusMinutes / totalPomodoros)) : 0}
                </p>
                <p className="text-xs text-muted-foreground">
                  {language === 'pt-BR' ? 'Min médio por pomodoro' : 'Avg min per pomodoro'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-lg">{t('byQuadrant')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={quadrantData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" className="text-xs" />
                  <YAxis className="text-xs" />
                  <Tooltip />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {quadrantData.map((_, index) => (
                      <Cell key={index} fill={COLORS[index]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-display text-lg">{t('productivityScore')}</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-center">
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={quadrantData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    {quadrantData.map((_, index) => (
                      <Cell key={index} fill={COLORS[index]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
