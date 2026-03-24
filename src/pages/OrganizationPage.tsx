import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { useLanguage } from '@/i18n/LanguageContext';
import { useTenants, useTenantMembers, useTenantInvites, type Tenant } from '@/hooks/useTenants';
import { useTenantContext } from '@/hooks/useTenantContext';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Building2, Plus, Users, Crown, Shield, User, Trash2, MoreVertical, Mail, UserPlus, Copy, Check, Link } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';

export default function OrganizationPage() {
  const { language } = useLanguage();
  const pt = language === 'pt-BR';
  const { user } = useAuth();
  const { tenants, isLoading, createTenant, deleteTenant } = useTenants();
  const { activeTenant, setActiveTenantId } = useTenantContext();
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);

  const viewingTenant = selectedTenantId ? tenants.find(t => t.id === selectedTenantId) : activeTenant;

  const handleCreate = async () => {
    if (!newName.trim() || !newSlug.trim()) return;
    await createTenant.mutateAsync({ name: newName, slug: newSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-') });
    setNewName('');
    setNewSlug('');
    setCreateOpen(false);
  };

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold">
              {pt ? 'Organização' : 'Organization'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {pt ? 'Gerencie suas organizações e membros' : 'Manage your organizations and members'}
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            {pt ? 'Nova Organização' : 'New Organization'}
          </Button>
        </div>

        {/* Tenant selector */}
        {tenants.length > 0 && (
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm shrink-0">{pt ? 'Organização ativa:' : 'Active org:'}</Label>
                <Select
                  value={activeTenant?.id ?? ''}
                  onValueChange={(v) => setActiveTenantId(v)}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={pt ? 'Selecionar' : 'Select'} />
                  </SelectTrigger>
                  <SelectContent>
                    {tenants.map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Pending invites for current user */}
        <PendingInvitesSection />

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : tenants.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Building2 className="h-12 w-12 mb-4 opacity-30" />
              <p className="text-lg font-medium">
                {pt ? 'Nenhuma organização' : 'No organizations'}
              </p>
              <p className="text-sm">
                {pt ? 'Crie uma organização para gerenciar times e projetos' : 'Create an organization to manage teams and projects'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {tenants.map(tenant => (
              <Card
                key={tenant.id}
                className={`cursor-pointer transition-all hover:shadow-md ${tenant.id === activeTenant?.id ? 'border-primary' : 'hover:border-primary/30'}`}
                onClick={() => setSelectedTenantId(tenant.id)}
              >
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary font-display font-bold text-lg">
                      {tenant.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-display font-semibold truncate">{tenant.name}</h3>
                      <p className="text-xs text-muted-foreground">{tenant.slug}</p>
                      {tenant.id === activeTenant?.id && (
                        <Badge variant="secondary" className="mt-1 text-[10px]">
                          {pt ? 'Ativa' : 'Active'}
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Members + Invites of selected tenant */}
        {viewingTenant && (
          <TenantMembersSection tenant={viewingTenant} />
        )}

        {/* Create dialog */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-display">
                {pt ? 'Nova Organização' : 'New Organization'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{pt ? 'Nome' : 'Name'}</Label>
                <Input
                  value={newName}
                  onChange={e => {
                    setNewName(e.target.value);
                    if (!newSlug || newSlug === newName.toLowerCase().replace(/[^a-z0-9-]/g, '-')) {
                      setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
                    }
                  }}
                  placeholder={pt ? 'Minha Empresa' : 'My Company'}
                />
              </div>
              <div className="space-y-2">
                <Label>Slug</Label>
                <Input
                  value={newSlug}
                  onChange={e => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                  placeholder="minha-empresa"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                {pt ? 'Cancelar' : 'Cancel'}
              </Button>
              <Button onClick={handleCreate} disabled={!newName.trim() || !newSlug.trim()}>
                {pt ? 'Criar' : 'Create'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}

/** Shows pending invites for the current user to accept */
function PendingInvitesSection() {
  const { language } = useLanguage();
  const pt = language === 'pt-BR';
  const { user } = useAuth();
  const { toast } = useToast();

  // We query invites where invited_email matches current user
  const { data: myInvites, isLoading } = useMyPendingInvites();
  const { acceptInvite } = useTenantInvites(null);

  if (isLoading || !myInvites || myInvites.length === 0) return null;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-primary">
          <Mail className="h-4 w-4" />
          {pt ? 'Convites pendentes' : 'Pending invites'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {myInvites.map((invite: any) => (
          <div key={invite.id} className="flex items-center gap-3 rounded-lg border bg-background p-3">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{invite.tenant_name || (pt ? 'Organização' : 'Organization')}</p>
              <p className="text-xs text-muted-foreground">
                {pt ? `Papel: ${invite.role}` : `Role: ${invite.role}`}
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => acceptInvite.mutate(invite.invite_code)}
              disabled={acceptInvite.isPending}
            >
              {pt ? 'Aceitar' : 'Accept'}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function useMyPendingInvites() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-tenant-invites', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('tenant_invites')
        .select('*, tenants(name)')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((inv: any) => ({
        ...inv,
        tenant_name: inv.tenants?.name || null,
      }));
    },
    enabled: !!user,
  });
}

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

function TenantMembersSection({ tenant }: { tenant: Tenant }) {
  const { language } = useLanguage();
  const pt = language === 'pt-BR';
  const { user } = useAuth();
  const { members, isLoading, updateMemberRole, removeMember } = useTenantMembers(tenant.id);
  const { invites, createInvite, cancelInvite } = useTenantInvites(tenant.id);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'guest' | 'admin'>('member');
  const [copied, setCopied] = useState<string | null>(null);

  const myMembership = members.find(m => m.user_id === user?.id);
  const canManage = myMembership?.role === 'owner' || myMembership?.role === 'admin';

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    await createInvite.mutateAsync({ tenantId: tenant.id, email: inviteEmail.trim(), role: inviteRole });
    setInviteEmail('');
  };

  const copyInviteLink = (code: string) => {
    const url = `${window.location.origin}/organization?invite=${code}`;
    navigator.clipboard.writeText(url);
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  };

  const roleIcon = (role: string) => {
    switch (role) {
      case 'owner': return <Crown className="h-3.5 w-3.5 text-yellow-500" />;
      case 'admin': return <Shield className="h-3.5 w-3.5 text-primary" />;
      case 'guest': return <User className="h-3.5 w-3.5 text-muted-foreground/50" />;
      default: return <User className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  const roleLabel = (role: string) => {
    const labels: Record<string, Record<string, string>> = {
      owner: { 'pt-BR': 'Proprietário', en: 'Owner' },
      admin: { 'pt-BR': 'Admin', en: 'Admin' },
      member: { 'pt-BR': 'Membro', en: 'Member' },
      guest: { 'pt-BR': 'Convidado', en: 'Guest' },
    };
    return labels[role]?.[language] || role;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            {pt ? `Membros de ${tenant.name}` : `${tenant.name} Members`}
          </CardTitle>
          <CardDescription>
            {members.length} {pt ? 'membro(s)' : 'member(s)'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Invite form */}
          {canManage && (
            <div className="mb-4 p-3 rounded-lg border border-dashed border-primary/30 bg-primary/5 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                <UserPlus className="h-4 w-4" />
                {pt ? 'Convidar membro' : 'Invite member'}
              </div>
              <div className="flex gap-2">
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder={pt ? 'email@exemplo.com' : 'email@example.com'}
                  className="flex-1"
                  onKeyDown={e => e.key === 'Enter' && handleInvite()}
                />
                <Select value={inviteRole} onValueChange={(v: any) => setInviteRole(v)}>
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">{pt ? 'Membro' : 'Member'}</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="guest">{pt ? 'Convidado' : 'Guest'}</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={handleInvite} disabled={!inviteEmail.trim() || createInvite.isPending} size="sm">
                  <Mail className="h-4 w-4 mr-1" />
                  {pt ? 'Convidar' : 'Invite'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {pt
                  ? 'O convite permite que usuários de qualquer organização ou sem organização se juntem como membro.'
                  : 'The invite allows users from any organization or without one to join as a member.'}
              </p>
            </div>
          )}

          {/* Pending invites */}
          {canManage && invites.length > 0 && (
            <div className="mb-4 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {pt ? 'Convites pendentes' : 'Pending invites'}
              </p>
              {invites.map(invite => (
                <div key={invite.id} className="flex items-center gap-3 rounded-lg border border-dashed p-2.5">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{invite.invited_email}</p>
                    <p className="text-xs text-muted-foreground">{roleLabel(invite.role)}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => copyInviteLink(invite.invite_code)}
                    title={pt ? 'Copiar link de convite' : 'Copy invite link'}
                  >
                    {copied === invite.invite_code ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={() => cancelInvite.mutate(invite.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Members list */}
          {isLoading ? (
            <div className="flex justify-center py-4">
              <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : (
            <div className="space-y-2">
              {members.map(member => (
                <div key={member.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs bg-secondary">
                      {(member.profile?.display_name || '?').charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {member.profile?.display_name || (pt ? 'Usuário' : 'User')}
                    </p>
                    <div className="flex items-center gap-1">
                      {roleIcon(member.role)}
                      <span className="text-xs text-muted-foreground">{roleLabel(member.role)}</span>
                    </div>
                  </div>
                  {canManage && member.user_id !== user?.id && member.role !== 'owner' && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {member.role !== 'admin' && (
                          <DropdownMenuItem onClick={() => updateMemberRole.mutate({ memberId: member.id, role: 'admin' })}>
                            <Shield className="h-4 w-4 mr-2" /> {pt ? 'Tornar Admin' : 'Make Admin'}
                          </DropdownMenuItem>
                        )}
                        {member.role !== 'member' && (
                          <DropdownMenuItem onClick={() => updateMemberRole.mutate({ memberId: member.id, role: 'member' })}>
                            <User className="h-4 w-4 mr-2" /> {pt ? 'Tornar Membro' : 'Make Member'}
                          </DropdownMenuItem>
                        )}
                        {member.role !== 'guest' && (
                          <DropdownMenuItem onClick={() => updateMemberRole.mutate({ memberId: member.id, role: 'guest' })}>
                            <User className="h-4 w-4 mr-2" /> {pt ? 'Tornar Convidado' : 'Make Guest'}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem className="text-destructive" onClick={() => removeMember.mutate(member.id)}>
                          <Trash2 className="h-4 w-4 mr-2" /> {pt ? 'Remover' : 'Remove'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              ))}
              {members.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {pt ? 'Nenhum membro' : 'No members'}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
