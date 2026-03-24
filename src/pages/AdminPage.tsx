import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { useAdminGuard } from '@/hooks/useAdminGuard';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Users, ListTodo, Trophy, CreditCard } from 'lucide-react';
import { useLanguage } from '@/i18n/LanguageContext';

interface UserProfile {
  user_id: string;
  display_name: string | null;
  created_at: string;
  preferred_language: string;
}

interface OverviewStats {
  totalUsers: number;
  totalTasks: number;
  completedTasks: number;
  activeUsers7d: number;
}

export default function AdminPage() {
  const { isSuperAdmin, loading } = useAdminGuard();
  const { t } = useLanguage();
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [stats, setStats] = useState<OverviewStats>({ totalUsers: 0, totalTasks: 0, completedTasks: 0, activeUsers7d: 0 });
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!isSuperAdmin) return;

    const fetchData = async () => {
      const [profilesRes, tasksRes, completedRes, gamificationRes] = await Promise.all([
        supabase.from('profiles').select('user_id, display_name, created_at, preferred_language'),
        supabase.from('tasks').select('id', { count: 'exact', head: true }),
        supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
        supabase.from('gamification').select('user_id, last_active_date'),
      ]);

      setProfiles(profilesRes.data || []);

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const activeUsers = (gamificationRes.data || []).filter(
        g => g.last_active_date && new Date(g.last_active_date) >= sevenDaysAgo
      ).length;

      setStats({
        totalUsers: (profilesRes.data || []).length,
        totalTasks: tasksRes.count || 0,
        completedTasks: completedRes.count || 0,
        activeUsers7d: activeUsers,
      });
      setLoadingData(false);
    };

    fetchData();
  }, [isSuperAdmin]);

  if (loading || !isSuperAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Administração</h1>
          <p className="text-muted-foreground">Gerencie usuários, métricas e planos.</p>
        </div>

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview" className="gap-2">
              <Trophy className="h-4 w-4" />
              Visão Geral
            </TabsTrigger>
            <TabsTrigger value="users" className="gap-2">
              <Users className="h-4 w-4" />
              Usuários
            </TabsTrigger>
            <TabsTrigger value="plans" className="gap-2">
              <CreditCard className="h-4 w-4" />
              Planos
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <StatCard title="Total de Usuários" value={stats.totalUsers} icon={<Users className="h-4 w-4 text-muted-foreground" />} />
              <StatCard title="Usuários Ativos (7d)" value={stats.activeUsers7d} icon={<Users className="h-4 w-4 text-muted-foreground" />} />
              <StatCard title="Total de Tarefas" value={stats.totalTasks} icon={<ListTodo className="h-4 w-4 text-muted-foreground" />} />
              <StatCard title="Tarefas Concluídas" value={stats.completedTasks} icon={<Trophy className="h-4 w-4 text-muted-foreground" />} />
            </div>
          </TabsContent>

          <TabsContent value="users">
            {loadingData ? (
              <div className="flex justify-center py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Usuários Cadastrados</CardTitle>
                  <CardDescription>{profiles.length} usuário(s) no sistema</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome</TableHead>
                        <TableHead>Idioma</TableHead>
                        <TableHead>Cadastro</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {profiles.map(profile => (
                        <TableRow key={profile.user_id}>
                          <TableCell className="font-medium">{profile.display_name || '—'}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{profile.preferred_language}</Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(profile.created_at).toLocaleDateString('pt-BR')}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="plans">
            <Card>
              <CardHeader>
                <CardTitle>Gestão de Planos</CardTitle>
                <CardDescription>Em breve você poderá gerenciar planos e assinaturas dos tenants.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Badge variant="secondary" className="text-base px-4 py-2">Em breve</Badge>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

function StatCard({ title, value, icon }: { title: string; value: number; icon: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
