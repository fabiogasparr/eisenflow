import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

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

export function useTenants() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const tenantsQuery = useQuery({
    queryKey: ['tenants', user?.id],
    queryFn: async (): Promise<Tenant[]> => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('tenants')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Tenant[];
    },
    enabled: !!user,
  });

  const createTenant = useMutation({
    mutationFn: async (input: { name: string; slug: string; logo_url?: string }) => {
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('tenants')
        .insert({ ...input, created_by: user.id })
        .select()
        .single();
      if (error) throw error;
      return data as Tenant;
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
      const { error } = await supabase.from('tenants').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] });
      queryClient.invalidateQueries({ queryKey: ['my-tenants'] });
    },
    onError: (err: Error) => toast({ title: 'Erro', description: err.message, variant: 'destructive' }),
  });

  const deleteTenant = useMutation({
    mutationFn: async (tenantId: string) => {
      const { error } = await supabase.from('tenants').delete().eq('id', tenantId);
      if (error) throw error;
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
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const membersQuery = useQuery({
    queryKey: ['tenant_members', tenantId],
    queryFn: async (): Promise<TenantMember[]> => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from('tenant_members')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('joined_at', { ascending: true });
      if (error) throw error;

      const userIds = (data ?? []).map((m: any) => m.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name, avatar_url')
        .in('user_id', userIds);

      const profileMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));

      return (data ?? []).map((m: any) => ({
        ...m,
        profile: profileMap.get(m.user_id) || null,
      })) as TenantMember[];
    },
    enabled: !!tenantId,
  });

  const addMember = useMutation({
    mutationFn: async (input: { tenantId: string; userId: string; role?: TenantMember['role'] }) => {
      const { error } = await supabase
        .from('tenant_members')
        .insert({
          tenant_id: input.tenantId,
          user_id: input.userId,
          role: input.role || 'member',
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant_members', tenantId] });
      toast({ title: '✅', description: 'Membro adicionado!' });
    },
    onError: (err: Error) => toast({ title: 'Erro', description: err.message, variant: 'destructive' }),
  });

  const updateMemberRole = useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string; role: TenantMember['role'] }) => {
      const { error } = await supabase
        .from('tenant_members')
        .update({ role })
        .eq('id', memberId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tenant_members', tenantId] }),
    onError: (err: Error) => toast({ title: 'Erro', description: err.message, variant: 'destructive' }),
  });

  const removeMember = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase.from('tenant_members').delete().eq('id', memberId);
      if (error) throw error;
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
