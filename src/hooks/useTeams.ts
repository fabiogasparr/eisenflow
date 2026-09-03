import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { create, update, remove, listDocs, findOne, Query } from '@/integrations/appwrite/database';
import { projectPermissions } from '@/integrations/appwrite/permissions';

export interface Team {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  role: 'admin' | 'manager' | 'member';
  joined_at: string;
  profile?: {
    display_name: string | null;
    avatar_url: string | null;
  };
}

export interface TeamInvite {
  id: string;
  team_id: string;
  invited_by: string;
  invited_email: string | null;
  invite_code: string;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  role: 'admin' | 'manager' | 'member';
  created_at: string;
  expires_at: string;
}

/**
 * Substitui o DEFAULT generate_invite_code() da tabela team_invites.
 * O Appwrite não tem função de default no servidor: o código nasce no cliente.
 */
function generateInviteCode() {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12).toUpperCase();
}

export function useTeams() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const teamsQuery = useQuery({
    queryKey: ['teams', user?.$id],
    queryFn: async (): Promise<Team[]> => {
      if (!user) return [];
      // Sem `.eq(...)`: só chegam os times cuja permissão de documento inclui
      // este usuário — é o que substitui a policy "Users can view their teams".
      const docs = await listDocs('teams', [Query.orderDesc('created_at')]);
      return docs as unknown as Team[];
    },
    enabled: !!user,
  });

  const createTeam = useMutation({
    mutationFn: async (input: { name: string; description?: string; tenant_id?: string | null }) => {
      if (!user) throw new Error('Not authenticated');
      return create(
        'teams',
        {
          name: input.name,
          description: input.description,
          created_by: user.$id,
          tenant_id: input.tenant_id ?? null,
        },
        // PERMISSÕES DO DOCUMENTO — no Postgres isto era a RLS de `teams`:
        //   "Team creators can manage their team"  -> criador lê/edita/apaga (ownerOnly)
        //   "Tenant members can view tenant teams" -> Role.team(tenant) lê
        // projectPermissions faz exatamente esse par (dono + leitura do tenant).
        // TODO(migração): a policy "Team members can view their team" (que lia
        // team_members) não tem equivalente aqui — o membro só passará a enxergar
        // o documento quando a Function que insere em `team_members` também
        // acrescentar Permission.read(Role.user(<membro>)) neste documento.
        projectPermissions({ ownerId: user.$id, tenantTeamId: input.tenant_id ?? null }),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      toast({ title: '✅', description: 'Time criado com sucesso!' });
    },
    onError: (err: Error) => {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    },
  });

  const updateTeam = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Team> & { id: string }) => {
      // Sem terceiro argumento: nada aqui muda a titularidade do documento,
      // então as permissões gravadas na criação continuam valendo.
      await update('teams', id, updates as never);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['teams'] }),
    onError: (err: Error) => toast({ title: 'Erro', description: err.message, variant: 'destructive' }),
  });

  const deleteTeam = useMutation({
    mutationFn: async (teamId: string) => {
      // TODO(migração): o Appwrite não tem ON DELETE CASCADE e `team_members` /
      // `team_invites` são server-doc (o cliente não apaga). Os filhos precisam
      // ser removidos por uma Function; aqui só sai o time.
      await remove('teams', teamId);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['teams'] }),
  });

  return {
    teams: teamsQuery.data ?? [],
    isLoading: teamsQuery.isLoading,
    createTeam,
    updateTeam,
    deleteTeam,
  };
}

export function useTeamMembers(teamId: string | null) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const membersQuery = useQuery({
    queryKey: ['team_members', teamId],
    queryFn: async (): Promise<TeamMember[]> => {
      if (!teamId) return [];
      const members = await listDocs('team_members', [
        Query.equal('team_id', teamId),
        Query.orderAsc('joined_at'),
      ]);

      // Sem join embutido do PostgREST: os perfis vêm em uma segunda query e a
      // junção é feita em memória. `profiles.user_id` não é o $id do documento,
      // então é Query.equal em vez de loadRelated().
      const userIds = [...new Set(members.map((m) => m.user_id))];
      const profiles = userIds.length
        ? await listDocs('profiles', [Query.equal('user_id', userIds), Query.limit(100)])
        : [];
      const profileMap = new Map(profiles.map((p) => [p.user_id, p]));

      return members.map((m) => ({
        ...m,
        profile: profileMap.get(m.user_id) ?? null,
      })) as unknown as TeamMember[];
    },
    enabled: !!teamId,
  });

  const updateMemberRole = useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string; role: TeamMember['role'] }) => {
      // TODO(migração): `team_members` é server-doc — o servidor concede leitura
      // por documento, não escrita. Esta chamada falha até existir uma Function
      // que valide quem manda (o antigo `is_team_admin`) e faça o update.
      await update('team_members', memberId, { role });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team_members', teamId] }),
    onError: (err: Error) => toast({ title: 'Erro', description: err.message, variant: 'destructive' }),
  });

  const removeMember = useMutation({
    mutationFn: async (memberId: string) => {
      // TODO(migração): mesma limitação do updateMemberRole — server-doc.
      // Além do documento, a Function precisa REVOGAR as permissões que o
      // membro tinha nos documentos do time (o Postgres não guardava isso:
      // a RLS recalculava a cada query).
      await remove('team_members', memberId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team_members', teamId] });
      toast({ title: '✅', description: 'Membro removido.' });
    },
  });

  return {
    members: membersQuery.data ?? [],
    isLoading: membersQuery.isLoading,
    updateMemberRole,
    removeMember,
  };
}

export function useTeamInvites(teamId: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invitesQuery = useQuery({
    queryKey: ['team_invites', teamId],
    queryFn: async (): Promise<TeamInvite[]> => {
      if (!teamId) return [];
      const docs = await listDocs('team_invites', [
        Query.equal('team_id', teamId),
        Query.equal('status', 'pending'),
        Query.orderDesc('created_at'),
      ]);
      return docs as unknown as TeamInvite[];
    },
    enabled: !!teamId,
  });

  const createInvite = useMutation({
    mutationFn: async (input: { teamId: string; email?: string; role?: TeamMember['role'] }) => {
      if (!user) throw new Error('Not authenticated');
      // TODO(migração): `team_invites` é server-doc. Este create só passa quando
      // virar uma Function — que também deve mandar o e-mail e gravar o convite
      // com Permission.read para os admins do time.
      const doc = await create('team_invites', {
        team_id: input.teamId,
        invited_by: user.$id,
        invited_email: input.email || null,
        role: input.role || 'member',
        // Defaults que eram do Postgres e agora nascem no cliente.
        invite_code: generateInviteCode(),
        status: 'pending',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
      return doc as unknown as TeamInvite;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team_invites', teamId] });
      toast({ title: '✅', description: 'Convite criado!' });
    },
    onError: (err: Error) => toast({ title: 'Erro', description: err.message, variant: 'destructive' }),
  });

  const acceptInvite = useMutation({
    mutationFn: async (inviteCode: string) => {
      if (!user) throw new Error('Not authenticated');

      const invite = await findOne('team_invites', [
        Query.equal('invite_code', inviteCode),
        Query.equal('status', 'pending'),
      ]);
      if (!invite) throw new Error('Convite inválido ou expirado');

      // TODO(migração): aceitar convite é justamente o caso em que o cliente NÃO
      // pode escrever — `team_members` é server-doc e, além da linha, é preciso
      // acrescentar Permission.read(Role.user(<novo membro>)) no documento do
      // time e nos documentos dele. Isso é trabalho de uma Function
      // ('accept-team-invite'), que substitui a policy
      // "Users can join teams via invite" + o trigger de aceite.
      await create('team_members', {
        team_id: invite.team_id,
        user_id: user.$id,
        role: invite.role ?? 'member',
        joined_at: new Date().toISOString(),
      });

      await update('team_invites', invite.id, { status: 'accepted' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      queryClient.invalidateQueries({ queryKey: ['team_members'] });
      toast({ title: '🎉', description: 'Você entrou no time!' });
    },
    onError: (err: Error) => toast({ title: 'Erro', description: err.message, variant: 'destructive' }),
  });

  const cancelInvite = useMutation({
    mutationFn: async (inviteId: string) => {
      // TODO(migração): server-doc — precisa da mesma Function do createInvite.
      await update('team_invites', inviteId, { status: 'cancelled' });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team_invites', teamId] }),
  });

  return {
    invites: invitesQuery.data ?? [],
    isLoading: invitesQuery.isLoading,
    createInvite,
    acceptInvite,
    cancelInvite,
  };
}
