import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { create, update, remove, listDocs, findOne, Query } from '@/integrations/appwrite/database';
import { ownerOnly } from '@/integrations/appwrite/permissions';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface TenantMember {
  id: string;
  tenant_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member' | 'guest';
  joined_at: string;
  profile?: {
    display_name: string | null;
    avatar_url: string | null;
  };
}

/** Substitui o DEFAULT generate_invite_code() da tabela tenant_invites. */
function generateInviteCode() {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12).toUpperCase();
}

export function useTenants() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const tenantsQuery = useQuery({
    queryKey: ['tenants', user?.$id],
    queryFn: async (): Promise<Tenant[]> => {
      if (!user) return [];
      // Sem `.eq(...)`: chegam só os tenants cuja permissão de documento inclui
      // este usuário — substitui a policy "Tenant members can view their tenant".
      const docs = await listDocs('tenants', [Query.orderDesc('created_at')]);
      return docs as unknown as Tenant[];
    },
    enabled: !!user,
  });

  const createTenant = useMutation({
    mutationFn: async (input: { name: string; slug: string; logo_url?: string }) => {
      if (!user) throw new Error('Not authenticated');

      // TODO(migração): um tenant DEVERIA nascer junto com um Team nativo do
      // Appwrite (teams.create + membership do criador), porque é o Team que
      // dá o Role.team(...) usado em taskPermissions/projectPermissions para
      // recortar o que o tenant inteiro enxerga. Criar Team exige API key de
      // servidor — o SDK web não faz isso. Enquanto não existir a Function
      // 'create-tenant', o documento fica SEM appwrite_team_id e os demais
      // membros não herdam leitura por Role.team.
      const tenant = await create(
        'tenants',
        { ...input, created_by: user.$id },
        // PERMISSÕES DO DOCUMENTO — substitui a RLS de `tenants`:
        //   "Tenant owners can update/delete their tenant" -> ownerOnly(criador)
        // A parte "Tenant members can view their tenant" só volta quando a
        // Function acima acrescentar Permission.read(Role.team(<teamId>)).
        ownerOnly(user.$id),
      );

      // Substitui o trigger handle_new_tenant, que inseria o criador em
      // tenant_members como 'owner'. O Postgres fazia isso dentro da mesma
      // transação; aqui são duas escritas independentes.
      // TODO(migração): `tenant_members` é server-doc (só a API key cria), então
      // esta linha pertence à mesma Function 'create-tenant'. Fica aqui para o
      // fluxo não sumir da tela enquanto a Function não existe.
      await create('tenant_members', {
        tenant_id: tenant.id,
        user_id: user.$id,
        role: 'owner',
        joined_at: new Date().toISOString(),
      });

      return tenant as unknown as Tenant;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      queryClient.invalidateQueries({ queryKey: ['my-tenants'] });
      queryClient.invalidateQueries({ queryKey: ['my-tenant-memberships'] });
      toast({ title: '✅', description: 'Organização criada com sucesso!' });
    },
    onError: (err: Error) => {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    },
  });

  const updateTenant = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Tenant> & { id: string }) => {
      // Nome, slug e logo não mexem em titularidade: as permissões gravadas na
      // criação continuam valendo, então não passamos o terceiro argumento.
      await update('tenants', id, updates as never);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      queryClient.invalidateQueries({ queryKey: ['my-tenants'] });
    },
    onError: (err: Error) => toast({ title: 'Erro', description: err.message, variant: 'destructive' }),
  });

  const deleteTenant = useMutation({
    mutationFn: async (tenantId: string) => {
      // TODO(migração): sem ON DELETE CASCADE. tenant_members, tenant_invites e
      // as configurações de MCP do tenant são server-doc/server e continuam de
      // pé; a limpeza (e a remoção do Team nativo) precisa de uma Function.
      await remove('tenants', tenantId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      queryClient.invalidateQueries({ queryKey: ['my-tenants'] });
    },
  });

  return {
    tenants: tenantsQuery.data ?? [],
    isLoading: tenantsQuery.isLoading,
    createTenant,
    updateTenant,
    deleteTenant,
  };
}

export function useTenantMembers(tenantId: string | null) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const membersQuery = useQuery({
    queryKey: ['tenant_members', tenantId],
    queryFn: async (): Promise<TenantMember[]> => {
      if (!tenantId) return [];
      const members = await listDocs('tenant_members', [
        Query.equal('tenant_id', tenantId),
        Query.orderAsc('joined_at'),
      ]);

      // Sem join embutido: perfis em segunda query, junção em memória.
      // `profiles.user_id` não é o $id do documento, por isso Query.equal e
      // não loadRelated().
      const userIds = [...new Set(members.map((m) => m.user_id))];
      const profiles = userIds.length
        ? await listDocs('profiles', [Query.equal('user_id', userIds), Query.limit(100)])
        : [];
      const profileMap = new Map(profiles.map((p) => [p.user_id, p]));

      return members.map((m) => ({
        ...m,
        profile: profileMap.get(m.user_id) ?? null,
      })) as unknown as TenantMember[];
    },
    enabled: !!tenantId,
  });

  const addMember = useMutation({
    mutationFn: async (input: { tenantId: string; userId: string; role?: TenantMember['role'] }) => {
      // TODO(migração): `tenant_members` é server-doc. Entrar um membro envolve
      // duas coisas que o cliente não pode fazer: criar a linha e adicionar a
      // pessoa ao Team nativo do Appwrite (é a membership do Team que faz o
      // Role.team valer nas tarefas e projetos do tenant). Vira Function.
      await create('tenant_members', {
        tenant_id: input.tenantId,
        user_id: input.userId,
        role: input.role || 'member',
        joined_at: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant_members', tenantId] });
      toast({ title: '✅', description: 'Membro adicionado!' });
    },
    onError: (err: Error) => toast({ title: 'Erro', description: err.message, variant: 'destructive' }),
  });

  const updateMemberRole = useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string; role: TenantMember['role'] }) => {
      // TODO(migração): server-doc. E trocar o papel de um membro também muda o
      // role dele DENTRO do Team nativo (owner/admin/member), o que altera quem
      // pode editar e apagar via tenantPermissions() — só a Function faz os dois.
      await update('tenant_members', memberId, { role });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenant_members', tenantId] }),
    onError: (err: Error) => toast({ title: 'Erro', description: err.message, variant: 'destructive' }),
  });

  const removeMember = useMutation({
    mutationFn: async (memberId: string) => {
      // TODO(migração): server-doc. Além da linha, a Function precisa tirar a
      // pessoa do Team nativo — enquanto ela for membro do Team, continua lendo
      // tudo que tem Permission.read(Role.team(...)).
      await remove('tenant_members', memberId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant_members', tenantId] });
      toast({ title: '✅', description: 'Membro removido.' });
    },
  });

  return {
    members: membersQuery.data ?? [],
    isLoading: membersQuery.isLoading,
    addMember,
    updateMemberRole,
    removeMember,
  };
}

export interface TenantInvite {
  id: string;
  tenant_id: string;
  invited_by: string;
  invited_email: string | null;
  invite_code: string;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  role: 'owner' | 'admin' | 'member' | 'guest';
  created_at: string;
  expires_at: string;
}

export function useTenantInvites(tenantId: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invitesQuery = useQuery({
    queryKey: ['tenant_invites', tenantId],
    queryFn: async (): Promise<TenantInvite[]> => {
      if (!tenantId) return [];
      const docs = await listDocs('tenant_invites', [
        Query.equal('tenant_id', tenantId),
        Query.equal('status', 'pending'),
        Query.orderDesc('created_at'),
      ]);
      return docs as unknown as TenantInvite[];
    },
    enabled: !!tenantId,
  });

  const createInvite = useMutation({
    mutationFn: async (input: { tenantId: string; email: string; role?: TenantInvite['role'] }) => {
      if (!user) throw new Error('Not authenticated');
      // TODO(migração): `tenant_invites` é server-doc — o create só passa por
      // Function, que é também quem deve mandar o e-mail e gravar o documento
      // com leitura para os admins do tenant.
      const doc = await create('tenant_invites', {
        tenant_id: input.tenantId,
        invited_by: user.$id,
        invited_email: input.email,
        role: input.role || 'member',
        // Defaults que eram do Postgres e agora nascem no cliente.
        invite_code: generateInviteCode(),
        status: 'pending',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
      return doc as unknown as TenantInvite;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant_invites', tenantId] });
      toast({ title: '✅', description: 'Convite enviado!' });
    },
    onError: (err: Error) => toast({ title: 'Erro', description: err.message, variant: 'destructive' }),
  });

  const acceptInvite = useMutation({
    mutationFn: async (inviteCode: string) => {
      if (!user) throw new Error('Not authenticated');

      const invite = await findOne('tenant_invites', [
        Query.equal('invite_code', inviteCode),
        Query.equal('status', 'pending'),
      ]);
      if (!invite) throw new Error('Convite inválido ou expirado');

      // TODO(migração): mesmo caso do addMember — a linha em tenant_members e a
      // entrada no Team nativo do Appwrite são escrita de servidor. Sem a
      // Function ('accept-tenant-invite'), o convidado entra na tabela mas não
      // no Team, e continua sem enxergar o que depende de Role.team(tenant).
      await create('tenant_members', {
        tenant_id: invite.tenant_id,
        user_id: user.$id,
        role: invite.role ?? 'member',
        joined_at: new Date().toISOString(),
      });

      await update('tenant_invites', invite.id, { status: 'accepted' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-tenants'] });
      queryClient.invalidateQueries({ queryKey: ['my-tenant-memberships'] });
      queryClient.invalidateQueries({ queryKey: ['tenant_members'] });
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      toast({ title: '🎉', description: 'Você entrou na organização!' });
    },
    onError: (err: Error) => toast({ title: 'Erro', description: err.message, variant: 'destructive' }),
  });

  const cancelInvite = useMutation({
    mutationFn: async (inviteId: string) => {
      // TODO(migração): server-doc — precisa da mesma Function do createInvite.
      await update('tenant_invites', inviteId, { status: 'cancelled' });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenant_invites', tenantId] }),
  });

  return {
    invites: invitesQuery.data ?? [],
    isLoading: invitesQuery.isLoading,
    createInvite,
    acceptInvite,
    cancelInvite,
  };
}
