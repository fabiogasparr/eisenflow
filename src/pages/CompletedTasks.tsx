import { useMemo, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { useTasks } from '@/hooks/useTasks';
import { useLanguage } from '@/i18n/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle2, Clock, Timer, RotateCcw, Trophy } from 'lucide-react';
import { QUADRANT_CONFIG, type Quadrant, type Task } from '@/types/task';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

type Period = 'today' | '7d' | '30d' | 'all';

function formatDuration(ms: number, lang: string): string {
  if (ms <= 0) return '—';
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const min = totalMin % 60;
  const dLabel = lang === 'pt-BR' ? 'd' : 'd';
  const hLabel = lang === 'pt-BR' ? 'h' : 'h';
  const mLabel = lang === 'pt-BR' ? 'min' : 'm';
  if (days > 0) return `${days}${dLabel} ${hours}${hLabel}`;
  if (hours > 0) return `${hours}${hLabel} ${min}${mLabel}`;
  return `${min}${mLabel}`;
}

function periodStart(period: Period): number | null {
  const now = Date.now();
  if (period === 'today') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (period === '7d') return now - 7 * 86400000;
  if (period === '30d') return now - 30 * 86400000;
  return null;
}

const QUADRANT_BORDER: Record<Quadrant, string> = {
  do: 'border-l-quadrant-do',
  schedule: 'border-l-quadrant-schedule',
  delegate: 'border-l-quadrant-delegate',
  eliminate: 'border-l-quadrant-eliminate',
};

const QUADRANT_BADGE: Record<Quadrant, string> = {
  do: 'bg-quadrant-do/20 text-quadrant-do border-quadrant-do/40',
  schedule: 'bg-quadrant-schedule/20 text-quadrant-schedule border-quadrant-schedule/40',
  delegate: 'bg-quadrant-delegate/20 text-quadrant-delegate border-quadrant-delegate/40',
  eliminate: 'bg-quadrant-eliminate/20 text-quadrant-eliminate border-quadrant-eliminate/40',
};

export default function CompletedTasks() {
  const { language, t } = useLanguage();
  const { tasks, updateTask } = useTasks();
  const [period, setPeriod] = useState<Period>('30d');
  const [quadrantFilter, setQuadrantFilter] = useState<Quadrant | 'all'>('all');
  const [search, setSearch] = useState('');

  const isPt = language === 'pt-BR';

  const completed = useMemo(() => {
    const start = periodStart(period);
    return tasks
      .filter((task) => task.status === 'completed' && task.completed_at)
      .filter((task) => (start ? new Date(task.completed_at!).getTime() >= start : true))
      .filter((task) => (quadrantFilter === 'all' ? true : task.quadrant === quadrantFilter))
      .filter((task) =>
        search ? task.title.toLowerCase().includes(search.toLowerCase()) : true
      )
      .sort(
        (a, b) =>
          new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime()
      );
  }, [tasks, period, quadrantFilter, search]);

  const stats = useMemo(() => {
    const total = completed.length;
    const withDuration = completed.filter((t) => t.started_at && t.completed_at);
    const durations = withDuration.map(
      (t) => new Date(t.completed_at!).getTime() - new Date(t.started_at!).getTime()
    );
    const totalMs = durations.reduce((a, b) => a + b, 0);
    const avgMs = durations.length ? totalMs / durations.length : 0;

    const byQuadrant: Record<Quadrant, number> = { do: 0, schedule: 0, delegate: 0, eliminate: 0 };
    for (const task of completed) byQuadrant[task.quadrant] += 1;

    // last 14 days bar chart
    const days: { date: string; label: string; count: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      const count = completed.filter((t) => {
        const ts = new Date(t.completed_at!).getTime();
        return ts >= d.getTime() && ts < next.getTime();
      }).length;
      days.push({
        date: d.toISOString().slice(0, 10),
        label: `${d.getDate()}/${d.getMonth() + 1}`,
        count,
      });
    }

    return { total, totalMs, avgMs, byQuadrant, days, withDurationCount: withDuration.length };
  }, [completed]);

  const handleReopen = async (task: Task) => {
    await updateTask.mutateAsync({
      id: task.id,
      status: 'pending',
      completed_at: null,
    });
  };

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-5 overflow-auto h-full">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2">
              <CheckCircle2 className="h-7 w-7 text-primary" />
              {t('completed')}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {isPt
                ? 'Histórico de tarefas concluídas e estatísticas de execução.'
                : 'History of completed tasks and execution stats.'}
            </p>
          </div>
        </header>

        {/* Stats cards */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Trophy className="h-3.5 w-3.5" />
                {isPt ? 'Total concluídas' : 'Total completed'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Timer className="h-3.5 w-3.5" />
                {isPt ? 'Tempo médio' : 'Avg time'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{formatDuration(stats.avgMs, language)}</div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {stats.withDurationCount}{' '}
                {isPt ? 'com tempo medido' : 'with measured time'}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {isPt ? 'Tempo total' : 'Total time'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{formatDuration(stats.totalMs, language)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {isPt ? 'Por quadrante' : 'By quadrant'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {(['do', 'schedule', 'delegate', 'eliminate'] as Quadrant[]).map((q) => {
                const cfg = QUADRANT_CONFIG[q];
                return (
                  <div key={q} className="flex items-center gap-2 text-xs">
                    <span>{cfg.emoji}</span>
                    <span className="flex-1 truncate text-muted-foreground">
                      {t(cfg.labelKey as any)}
                    </span>
                    <span className="font-semibold">{stats.byQuadrant[q]}</span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        {/* Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              {isPt ? 'Concluídas por dia (últimos 14 dias)' : 'Completed per day (last 14 days)'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.days} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <TabsList>
              <TabsTrigger value="today">{isPt ? 'Hoje' : 'Today'}</TabsTrigger>
              <TabsTrigger value="7d">{isPt ? '7 dias' : '7 days'}</TabsTrigger>
              <TabsTrigger value="30d">{isPt ? '30 dias' : '30 days'}</TabsTrigger>
              <TabsTrigger value="all">{isPt ? 'Tudo' : 'All'}</TabsTrigger>
            </TabsList>
          </Tabs>
          <Select
            value={quadrantFilter}
            onValueChange={(v) => setQuadrantFilter(v as Quadrant | 'all')}
          >
            <SelectTrigger className="sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{isPt ? 'Todos quadrantes' : 'All quadrants'}</SelectItem>
              {(['do', 'schedule', 'delegate', 'eliminate'] as Quadrant[]).map((q) => (
                <SelectItem key={q} value={q}>
                  {QUADRANT_CONFIG[q].emoji} {t(QUADRANT_CONFIG[q].labelKey as any)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isPt ? 'Buscar por título...' : 'Search by title...'}
            className="sm:flex-1"
          />
        </div>

        {/* List */}
        <Card>
          <CardContent className="p-0">
            {completed.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <CheckCircle2 className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">
                  {isPt
                    ? 'Nenhuma tarefa concluída no período.'
                    : 'No completed tasks in this period.'}
                </p>
              </div>
            ) : (
              <ScrollArea className="max-h-[60vh]">
                <ul className="divide-y">
                  {completed.map((task) => {
                    const cfg = QUADRANT_CONFIG[task.quadrant];
                    const dur =
                      task.started_at && task.completed_at
                        ? new Date(task.completed_at).getTime() -
                          new Date(task.started_at).getTime()
                        : 0;
                    return (
                      <li
                        key={task.id}
                        className={`flex items-center gap-3 p-3 border-l-4 ${QUADRANT_BORDER[task.quadrant]}`}
                      >
                        <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{task.title}</p>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 ${QUADRANT_BADGE[task.quadrant]}`}
                            >
                              {cfg.emoji} {t(cfg.labelKey as any)}
                            </Badge>
                            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              {new Date(task.completed_at!).toLocaleString(
                                isPt ? 'pt-BR' : 'en-US',
                                { dateStyle: 'short', timeStyle: 'short' }
                              )}
                            </span>
                            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                              <Timer className="h-3 w-3" />
                              {dur > 0 ? formatDuration(dur, language) : '—'}
                            </span>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleReopen(task)}
                          className="shrink-0"
                          title={isPt ? 'Reabrir' : 'Reopen'}
                        >
                          <RotateCcw className="h-4 w-4 mr-1" />
                          <span className="hidden sm:inline">{isPt ? 'Reabrir' : 'Reopen'}</span>
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
