import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { useAdminGuard } from '@/hooks/useAdminGuard';
import { list, listAll, Query } from '@/integrations/appwrite/database';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Users, ListTodo, Trophy, CreditCard, ChevronDown, ChevronUp, Flame, Target, Clock, Zap, Building2 } from 'lucide-react';
import { useLanguage } from '@/i18n/LanguageContext';
import { useToast } from '@/hooks/use-toast';

interface UserProfile {
  user_id: string;
  display_name: string | null;
  created_at: string;
  preferred_language: string;
  disabled: boolean;
}

interface UserGamification {
  user_id: string;
  xp: number;
  level: number;
  life_score: number;
  current_streak: number;
  longest_streak: number;
  total_tasks_completed: number;
  total_tasks_eliminated: number;
  total_tasks_delegated: number;
  total_focus_minutes: number;
  total_pomodoros: number;
}

interface TeamInfo {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  created_by: string;
}

interface TeamMemberInfo {
  user_id: string;
  role: string;
  joined_at: string;
  display_name: string | null;
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
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [gamificationMap, setGamificationMap] = useState<Record<string, UserGamification>>({});
  const [taskCountMap, setTaskCountMap] = useState<Record<string, { pending: number; in_progress: number; completed: number; eliminated: number }>>({});
  const [stats, setStats] = useState<OverviewStats>({ totalUsers: 0, totalTasks: 0, completedTasks: 0, activeUsers7d: 0 });
  const [loadingData, setLoadingData] = useState(true);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);
  const [togglingUser, setTogglingUser] = useState<string | null>(null);
  const [teamsData, setTeamsData] = useState<TeamInfo[]>([]);
  const [teamMembersMap, setTeamMembersMap] = useState<Record<string, TeamMemberInfo[]>>({});
  const [tenantsData, setTenantsData] = useState<any[]>([]);
  const [tenantMembersData, setTenantMembersData] = useState<Record<string, any[]>>({});

  useEffect(() => {
    if (!isSuperAdmin) return;

    const fetchData = async () => {
      // TODO(migração): no Postgres as policies "Super admins can view all ..."
      // davam ao super admin leitura global a cada query. No Appwrite a
      // permissão está gravada em cada documento e a sessão do admin não
      // aparece nelas: estas leituras só devolvem o que ESTE usuário já podia
      // ver. Um painel administrativo de verdade precisa de uma Appwrite
      // Function com API key (Role de servidor) devolvendo os agregados
      // prontos. Nada aqui é falseado — os números simplesmente ficam
      // limitados ao que a sessão enxerga até essa Function existir.
      const [profilesDocs, tasksTotal, completedTotal, gamificationDocs, allTasksDocs, teamsDocs, teamMembersDocs, tenantsDocs, tenantMembersDocs] = await Promise.all([
        // Não existe projeção de colunas (`select('user_id, display_name, ...')`):
        // o Appwrite devolve o documento inteiro.
        listAll('profiles'),
        // `select('id', { count: 'exact', head: true })` -> list() devolve o
        // `total` do servidor; Query.limit(1) evita trazer os documentos.
        list('tasks', [Query.limit(1)]),
        list('tasks', [Query.equal('status', 'completed'), Query.limit(1)]),
        listAll('gamification'),
        // listAll pagina com cursor: o teto é 100 documentos por request e a
        // contagem por usuário precisa varrer tudo.
        listAll('tasks'),
        listAll('teams'),
        listAll('team_members'),
        listAll('tenants'),
        listAll('tenant_members'),
      ]);

      setProfiles(profilesDocs as unknown as UserProfile[]);

      // Build gamification map
      const gMap: Record<string, UserGamification> = {};
      gamificationDocs.forEach((g: any) => {
        gMap[g.user_id] = g;
      });
      setGamificationMap(gMap);

      // Build task count map per user
      // O `count(*) group by` que faria isso em SQL não existe no Appwrite:
      // a contagem por usuário é feita em memória sobre o listAll acima.
      const tMap: Record<string, { pending: number; in_progress: number; completed: number; eliminated: number }> = {};
      allTasksDocs.forEach((t: any) => {
        if (!tMap[t.created_by]) {
          tMap[t.created_by] = { pending: 0, in_progress: 0, completed: 0, eliminated: 0 };
        }
        // `status` tinha DEFAULT 'pending' no Postgres; no Appwrite é opcional.
        const st = t.status ?? 'pending';
        if (st in tMap[t.created_by]) {
          tMap[t.created_by][st as keyof typeof tMap[string]]++;
        }
      });
      setTaskCountMap(tMap);

      // Build teams data
      setTeamsData(teamsDocs as unknown as TeamInfo[]);

      // Build team members map with profile names
      const profileMap: Record<string, string | null> = {};
      profilesDocs.forEach((p: any) => { profileMap[p.user_id] = p.display_name; });

      const tmMap: Record<string, TeamMemberInfo[]> = {};
      teamMembersDocs.forEach((m: any) => {
        if (!tmMap[m.team_id]) tmMap[m.team_id] = [];
        tmMap[m.team_id].push({
          user_id: m.user_id,
          role: m.role,
          joined_at: m.joined_at,
          display_name: profileMap[m.user_id] || null,
        });
      });
      setTeamMembersMap(tmMap);

      // Build tenants data
      setTenantsData(tenantsDocs as any[]);
      const tmemMap: Record<string, any[]> = {};
      tenantMembersDocs.forEach((m: any) => {
        if (!tmemMap[m.tenant_id]) tmemMap[m.tenant_id] = [];
        tmemMap[m.tenant_id].push({
          ...m,
          display_name: profileMap[m.user_id] || null,
        });
      });
      setTenantMembersData(tmemMap);

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const activeUsers = gamificationDocs.filter(
        (g: any) => g.last_active_date && new Date(g.last_active_date) >= sevenDaysAgo
      ).length;

      setStats({
        totalUsers: profilesDocs.length,
        totalTasks: tasksTotal.total,
        completedTasks: completedTotal.total,
        activeUsers7d: activeUsers,
      });
      setLoadingData(false);
    };

    fetchData();
  }, [isSuperAdmin]);

  // TODO(migração): ativar/desativar OUTRO usuário era permitido pela policy
  // "Super admins can update any profile", avaliada no banco. No Appwrite a
  // permissão de update do documento `profiles` é do próprio dono — a sessão do
  // admin não consegue escrever no perfil alheio, e um update daqui falharia
  // com 401 depois de já ter mexido no estado da tela. Esta operação precisa de
  // uma Appwrite Function com API key (que também deve bloquear a sessão do
  // usuário desativado, coisa que o `disabled` sozinho não faz).
  const toggleUserDisabled = async (userId: string, currentDisabled: boolean) => {
    const mensagem =
      'Ativar/desativar usuário não é possível pelo cliente: a escrita em perfis de terceiros ' +
      'exige uma Appwrite Function com API key de servidor (admin-toggle-user), que ainda não existe.';
    toast({ title: 'Operação indisponível', description: mensagem, variant: 'destructive' });
    throw new Error(mensagem);
  };

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
            <TabsTrigger value="tenants" className="gap-2">
              <Building2 className="h-4 w-4" />
              Tenants
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
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Detalhes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {profiles.map(profile => {
                        const isExpanded = expandedUser === profile.user_id;
                        const gam = gamificationMap[profile.user_id];
                        const tasks = taskCountMap[profile.user_id] || { pending: 0, in_progress: 0, completed: 0, eliminated: 0 };

                        return (
                          <>
                            <TableRow key={profile.user_id} className="cursor-pointer" onClick={() => setExpandedUser(isExpanded ? null : profile.user_id)}>
                              <TableCell className="font-medium">{profile.display_name || '—'}</TableCell>
                              <TableCell>
                                <Badge variant="outline">{profile.preferred_language}</Badge>
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {new Date(profile.created_at).toLocaleDateString('pt-BR')}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                  <Switch
                                    checked={!profile.disabled}
                                    onCheckedChange={() => toggleUserDisabled(profile.user_id, profile.disabled)}
                                    disabled={togglingUser === profile.user_id}
                                  />
                                  <span className={`text-xs ${profile.disabled ? 'text-destructive' : 'text-muted-foreground'}`}>
                                    {profile.disabled ? 'Desativado' : 'Ativo'}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button variant="ghost" size="icon">
                                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                </Button>
                              </TableCell>
                            </TableRow>
                            {isExpanded && (
                              <TableRow key={`${profile.user_id}-detail`}>
                                <TableCell colSpan={5} className="bg-muted/30 p-4">
                                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                                    <MetricCard icon={<Zap className="h-4 w-4 text-primary" />} label="XP" value={gam?.xp ?? 0} />
                                    <MetricCard icon={<Target className="h-4 w-4 text-primary" />} label="Nível" value={gam?.level ?? 1} />
                                    <MetricCard icon={<Trophy className="h-4 w-4 text-primary" />} label="Life Score" value={gam?.life_score ?? 0} />
                                    <MetricCard icon={<Flame className="h-4 w-4 text-primary" />} label="Streak Atual" value={gam?.current_streak ?? 0} />
                                    <MetricCard icon={<Flame className="h-4 w-4 text-muted-foreground" />} label="Maior Streak" value={gam?.longest_streak ?? 0} />
                                    <MetricCard icon={<Clock className="h-4 w-4 text-primary" />} label="Min. Foco" value={gam?.total_focus_minutes ?? 0} />
                                    <MetricCard icon={<ListTodo className="h-4 w-4 text-primary" />} label="Pomodoros" value={gam?.total_pomodoros ?? 0} />
                                  </div>
                                  <div className="mt-3 grid gap-2 md:grid-cols-4">
                                    <TaskStatusBadge label="Pendentes" count={tasks.pending} variant="outline" />
                                    <TaskStatusBadge label="Em Andamento" count={tasks.in_progress} variant="secondary" />
                                    <TaskStatusBadge label="Concluídas" count={tasks.completed} variant="default" />
                                    <TaskStatusBadge label="Eliminadas" count={tasks.eliminated} variant="destructive" />
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="tenants">
            {loadingData ? (
              <div className="flex justify-center py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">Organizações (Tenants)</h2>
                    <p className="text-sm text-muted-foreground">{tenantsData.length} organização(ões) cadastrada(s)</p>
                  </div>
                </div>
                {tenantsData.length === 0 ? (
                  <Card>
                    <CardContent className="flex items-center justify-center py-12 text-muted-foreground">
                      Nenhuma organização encontrada.
                    </CardContent>
                  </Card>
                ) : (
                  tenantsData.map((tenant: any) => {
                    const members = tenantMembersData[tenant.id] || [];
                    const isExpanded = expandedTeam === tenant.id;
                    return (
                      <Card key={tenant.id}>
                        <CardHeader className="cursor-pointer" onClick={() => setExpandedTeam(isExpanded ? null : tenant.id)}>
                          <div className="flex items-center justify-between">
                            <div>
                              <CardTitle className="text-base flex items-center gap-2">
                                <Building2 className="h-4 w-4" />
                                {tenant.name}
                              </CardTitle>
                              <CardDescription>{tenant.slug}</CardDescription>
                            </div>
                            <div className="flex items-center gap-3">
                              <Badge variant="secondary">
                                <Users className="h-3 w-3 mr-1" />
                                {members.length} membro(s)
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                Criado em {new Date(tenant.created_at).toLocaleDateString('pt-BR')}
                              </span>
                              <Button variant="ghost" size="icon">
                                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                        {isExpanded && (
                          <CardContent>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Membro</TableHead>
                                  <TableHead>Papel</TableHead>
                                  <TableHead>Entrada</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {members.map((m: any) => (
                                  <TableRow key={m.user_id}>
                                    <TableCell className="font-medium">{m.display_name || '—'}</TableCell>
                                    <TableCell>
                                      <Badge variant={m.role === 'owner' ? 'default' : m.role === 'admin' ? 'secondary' : 'outline'}>
                                        {m.role}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                      {new Date(m.joined_at).toLocaleDateString('pt-BR')}
                                    </TableCell>
                                  </TableRow>
                                ))}
                                {members.length === 0 && (
                                  <TableRow>
                                    <TableCell colSpan={3} className="text-center text-muted-foreground">Nenhum membro</TableCell>
                                  </TableRow>
                                )}
                              </TableBody>
                            </Table>
                          </CardContent>
                        )}
                      </Card>
                    );
                  })
                )}
              </div>
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

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-background p-3">
      {icon}
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold">{value}</p>
      </div>
    </div>
  );
}

function TaskStatusBadge({ label, count, variant }: { label: string; count: number; variant: 'default' | 'secondary' | 'destructive' | 'outline' }) {
  return (
    <div className="flex items-center justify-between rounded-md border p-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Badge variant={variant}>{count}</Badge>
    </div>
  );
}
