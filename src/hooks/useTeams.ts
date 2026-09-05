import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

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

export function useTeams() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const teamsQuery = useQuery({
    queryKey: ['teams', user?.id],
    queryFn: async (): Promise<Team[]> => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('teams')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Team[];
    },
    enabled: !!user,
  });

  const createTeam = useMutation({
    mutationFn: async (input: { name: string; description?: string; tenant_id?: string | null }) => {
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('teams')
        .insert({ name: input.name, description: input.description, created_by: user.id, tenant_id: input.tenant_id ?? null } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
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
      const { error } = await supabase.from('teams').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['teams'] }),
    onError: (err: Error) => toast({ title: 'Erro', description: err.message, variant: 'destructive' }),
  });

  const deleteTeam = useMutation({
    mutationFn: async (teamId: string) => {
      const { error } = await supabase.from('teams').delete().eq('id', teamId);
      if (error) throw error;
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
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const membersQuery = useQuery({
    queryKey: ['team_members', teamId],
    queryFn: async (): Promise<TeamMember[]> => {
      if (!teamId) return [];
      const { data, error } = await supabase
        .from('team_members')
        .select('*')
        .eq('team_id', teamId)
        .order('joined_at', { ascending: true });
      if (error) throw error;

      // Fetch profiles for each member
      const userIds = (data ?? []).map((m: any) => m.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name, avatar_url')
        .in('user_id', userIds);

      const profileMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));

      return (data ?? []).map((m: any) => ({
        ...m,
        profile: profileMap.get(m.user_id) || null,
      })) as TeamMember[];
    },
    enabled: !!teamId,
  });

  const updateMemberRole = useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string; role: TeamMember['role'] }) => {
      const { error } = await supabase
        .from('team_members')
        .update({ role })
        .eq('id', memberId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team_members', teamId] }),
    onError: (err: Error) => toast({ title: 'Erro', description: err.message, variant: 'destructive' }),
  });

  const removeMember = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase.from('team_members').delete().eq('id', memberId);
      if (error) throw error;
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
      const { data, error } = await supabase
        .from('team_invites')
        .select('*')
        .eq('team_id', teamId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as TeamInvite[];
    },
    enabled: !!teamId,
  });

  const createInvite = useMutation({
    mutationFn: async (input: { teamId: string; email?: string; role?: TeamMember['role'] }) => {
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('team_invites')
        .insert({
          team_id: input.teamId,
          invited_by: user.id,
          invited_email: input.email || null,
          role: input.role || 'member',
        })
        .select()
        .single();
      if (error) throw error;
      return data as TeamInvite;
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
      // Find the invite
      const { data: invite, error: findErr } = await supabase
        .from('team_invites')
        .select('*')
        .eq('invite_code', inviteCode)
        .eq('status', 'pending')
        .single();
      if (findErr || !invite) throw new Error('Convite inválido ou expirado');

      // Add user to team
      const { error: memberErr } = await supabase
        .from('team_members')
        .insert({
          team_id: (invite as any).team_id,
          user_id: user.id,
          role: (invite as any).role,
        });
      if (memberErr) throw memberErr;

      // Mark invite as accepted
      await supabase
        .from('team_invites')
        .update({ status: 'accepted' })
        .eq('id', (invite as any).id);
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
      const { error } = await supabase
        .from('team_invites')
        .update({ status: 'cancelled' })
        .eq('id', inviteId);
      if (error) throw error;
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
