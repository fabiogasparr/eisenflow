import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { useLanguage } from '@/i18n/LanguageContext';
import { useTenants, useTenantMembers, useTenantInvites, type Tenant } from '@/hooks/useTenants';
import { useTenantContext } from '@/hooks/useTenantContext';
import { useAuth } from '@/hooks/useAuth';
import { useTeams } from '@/hooks/useTeams';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import {
  Building2, Plus, Users, Crown, Shield, User, Trash2, MoreVertical,
  Mail, UserPlus, Copy, Check, Settings, Upload, FolderKanban, AlertTriangle,
  Image as ImageIcon, Pencil
} from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';

export default function OrganizationPage() {
  const { language } = useLanguage();
  const pt = language === 'pt-BR';
  const { user } = useAuth();
  const { tenants, isLoading, createTenant, deleteTenant } = useTenants();
  const { activeTenant, setActiveTenantId } = useTenantContext();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { acceptInvite } = useTenantInvites(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');

  useEffect(() => {
    const inviteCode = searchParams.get('invite');
    if (inviteCode && user) {
      acceptInvite.mutate(inviteCode, { onSettled: () => setSearchParams({}) });
    }
  }, [searchParams, user]);

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
              {pt ? 'Gerencie suas organizações, membros e configurações' : 'Manage your organizations, members and settings'}
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            {pt ? 'Nova' : 'New'}
          </Button>
        </div>

        <PendingInvitesSection />

        {/* Tenant selector */}
        {tenants.length > 0 && (
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm shrink-0">{pt ? 'Organização ativa:' : 'Active org:'}</Label>
                <Select value={activeTenant?.id ?? ''} onValueChange={setActiveTenantId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={pt ? 'Selecionar' : 'Select'} />
                  </SelectTrigger>
                  <SelectContent>
                    {tenants.map(t => (
                      <SelectItem key={t.id} value={t.id}>
                        <span className="flex items-center gap-2">
                          {t.logo_url && <img src={t.logo_url} className="h-4 w-4 rounded object-cover" />}
                          {t.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : tenants.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Building2 className="h-12 w-12 mb-4 opacity-30" />
              <p className="text-lg font-medium">{pt ? 'Nenhuma organização' : 'No organizations'}</p>
              <p className="text-sm">{pt ? 'Crie uma organização para começar' : 'Create an organization to get started'}</p>
            </CardContent>
          </Card>
        ) : activeTenant ? (
          <TenantManagement tenant={activeTenant} onDelete={() => deleteTenant.mutate(activeTenant.id)} />
        ) : null}

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-display">{pt ? 'Nova Organização' : 'New Organization'}</DialogTitle>
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
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>{pt ? 'Cancelar' : 'Cancel'}</Button>
              <Button onClick={handleCreate} disabled={!newName.trim() || !newSlug.trim()}>{pt ? 'Criar' : 'Create'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}

/* ─── Tenant Management with Tabs ─── */
function TenantManagement({ tenant, onDelete }: { tenant: Tenant; onDelete: () => void }) {
  const { language } = useLanguage();
  const pt = language === 'pt-BR';

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          {tenant.logo_url ? (
            <img src={tenant.logo_url} className="h-10 w-10 rounded-lg object-cover" />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary font-display font-bold">
              {tenant.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <CardTitle className="text-lg font-display">{tenant.name}</CardTitle>
            <CardDescription>{tenant.slug}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="members">
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="members" className="gap-1.5 text-xs">
              <Users className="h-3.5 w-3.5" /> {pt ? 'Membros' : 'Members'}
            </TabsTrigger>
            <TabsTrigger value="teams" className="gap-1.5 text-xs">
              <FolderKanban className="h-3.5 w-3.5" /> {pt ? 'Times' : 'Teams'}
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5 text-xs">
              <Settings className="h-3.5 w-3.5" /> {pt ? 'Configurações' : 'Settings'}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="members" className="mt-4">
            <TenantMembersTab tenant={tenant} />
          </TabsContent>

          <TabsContent value="teams" className="mt-4">
            <TenantTeamsTab tenant={tenant} />
          </TabsContent>

          <TabsContent value="settings" className="mt-4">
            <TenantSettingsTab tenant={tenant} onDelete={onDelete} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

/* ─── Members Tab ─── */
function TenantMembersTab({ tenant }: { tenant: Tenant }) {
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
    navigator.clipboard.writeText(`${window.location.origin}/organization?invite=${code}`);
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
    const map: Record<string, string> = pt
      ? { owner: 'Proprietário', admin: 'Admin', member: 'Membro', guest: 'Convidado' }
      : { owner: 'Owner', admin: 'Admin', member: 'Member', guest: 'Guest' };
    return map[role] || role;
  };

  return (
    <div className="space-y-4">
      {/* Invite form */}
      {canManage && (
        <div className="p-3 rounded-lg border border-dashed border-primary/30 bg-primary/5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <UserPlus className="h-4 w-4" />
            {pt ? 'Convidar membro (cross-tenant)' : 'Invite member (cross-tenant)'}
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
            {pt ? 'Usuários de qualquer organização podem ser convidados.' : 'Users from any organization can be invited.'}
          </p>
        </div>
      )}

      {/* Pending invites */}
      {canManage && invites.length > 0 && (
        <div className="space-y-2">
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
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyInviteLink(invite.invite_code)}>
                {copied === invite.invite_code ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => cancelInvite.mutate(invite.id)}>
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
            <p className="text-sm text-muted-foreground text-center py-4">{pt ? 'Nenhum membro' : 'No members'}</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Teams Tab ─── */
function TenantTeamsTab({ tenant }: { tenant: Tenant }) {
  const { language } = useLanguage();
  const pt = language === 'pt-BR';
  const { teams } = useTeams();
  const tenantTeams = teams.filter((t: any) => t.tenant_id === tenant.id);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {pt ? `${tenantTeams.length} time(s) nesta organização` : `${tenantTeams.length} team(s) in this organization`}
      </p>
      {tenantTeams.length === 0 ? (
        <div className="flex flex-col items-center py-8 text-muted-foreground">
          <Users className="h-8 w-8 mb-2 opacity-30" />
          <p className="text-sm">{pt ? 'Nenhum time associado' : 'No teams associated'}</p>
          <p className="text-xs">{pt ? 'Crie um time na página de Times' : 'Create a team on the Teams page'}</p>
        </div>
      ) : (
        tenantTeams.map((team: any) => (
          <div key={team.id} className="flex items-center gap-3 rounded-lg border p-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-secondary-foreground font-display font-bold text-sm">
              {team.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{team.name}</p>
              {team.description && <p className="text-xs text-muted-foreground truncate">{team.description}</p>}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/* ─── Settings Tab ─── */
function TenantSettingsTab({ tenant, onDelete }: { tenant: Tenant; onDelete: () => void }) {
  const { language } = useLanguage();
  const pt = language === 'pt-BR';
  const { updateTenant } = useTenants();
  const { toast } = useToast();

  const [editName, setEditName] = useState(tenant.name);
  const [editSlug, setEditSlug] = useState(tenant.slug);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { members } = useTenantMembers(tenant.id);
  const { user } = useAuth();
  const myMembership = members.find(m => m.user_id === user?.id);
  const isOwner = myMembership?.role === 'owner';
  const canEdit = isOwner || myMembership?.role === 'admin';

  const handleSave = async () => {
    if (!editName.trim() || !editSlug.trim()) return;
    await updateTenant.mutateAsync({
      id: tenant.id,
      name: editName.trim(),
      slug: editSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    });
    toast({ title: '✅', description: pt ? 'Configurações salvas!' : 'Settings saved!' });
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${tenant.id}/logo.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('tenant-logos')
        .upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage.from('tenant-logos').getPublicUrl(path);
      await updateTenant.mutateAsync({ id: tenant.id, logo_url: urlData.publicUrl + '?t=' + Date.now() });
      toast({ title: '✅', description: pt ? 'Logo atualizado!' : 'Logo updated!' });
    } catch (err: any) {
      toast({ title: pt ? 'Erro' : 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveLogo = async () => {
    await updateTenant.mutateAsync({ id: tenant.id, logo_url: null });
    toast({ title: '✅', description: pt ? 'Logo removido.' : 'Logo removed.' });
  };

  const handleDelete = () => {
    if (deleteConfirmText === tenant.slug) {
      onDelete();
      setConfirmDelete(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Logo */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Logo</Label>
        <div className="flex items-center gap-4">
          <div
            className="relative group cursor-pointer"
            onClick={() => canEdit && fileInputRef.current?.click()}
          >
            {tenant.logo_url ? (
              <img src={tenant.logo_url} className="h-20 w-20 rounded-xl object-cover border" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/30 bg-muted/30">
                <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
              </div>
            )}
            {canEdit && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                <Upload className="h-5 w-5 text-white" />
              </div>
            )}
          </div>
          <div className="space-y-1">
            {canEdit && (
              <>
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                  {uploading ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent mr-1" />
                  ) : (
                    <Upload className="h-3.5 w-3.5 mr-1" />
                  )}
                  {pt ? 'Enviar logo' : 'Upload logo'}
                </Button>
                {tenant.logo_url && (
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={handleRemoveLogo}>
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    {pt ? 'Remover' : 'Remove'}
                  </Button>
                )}
              </>
            )}
            <p className="text-xs text-muted-foreground">PNG, JPG, SVG • {pt ? 'Máx 2MB' : 'Max 2MB'}</p>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
        </div>
      </div>

      <Separator />

      {/* Name & Slug */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>{pt ? 'Nome da organização' : 'Organization name'}</Label>
          <Input value={editName} onChange={e => setEditName(e.target.value)} disabled={!canEdit} />
        </div>
        <div className="space-y-2">
          <Label>Slug</Label>
          <Input
            value={editSlug}
            onChange={e => setEditSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
            disabled={!canEdit}
          />
          <p className="text-xs text-muted-foreground">
            {pt ? 'Identificador único da organização' : 'Unique organization identifier'}
          </p>
        </div>
        {canEdit && (
          <Button
            onClick={handleSave}
            disabled={updateTenant.isPending || (!editName.trim() || !editSlug.trim())}
            size="sm"
          >
            <Pencil className="h-3.5 w-3.5 mr-1" />
            {pt ? 'Salvar alterações' : 'Save changes'}
          </Button>
        )}
      </div>

      <Separator />

      {/* Info */}
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>{pt ? 'Criado em:' : 'Created:'} {new Date(tenant.created_at).toLocaleDateString(pt ? 'pt-BR' : 'en')}</p>
        <p>ID: <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{tenant.id}</code></p>
      </div>

      {/* Danger zone */}
      {isOwner && (
        <>
          <Separator />
          <div className="rounded-lg border border-destructive/30 p-4 space-y-3">
            <div className="flex items-center gap-2 text-destructive font-medium text-sm">
              <AlertTriangle className="h-4 w-4" />
              {pt ? 'Zona de perigo' : 'Danger zone'}
            </div>
            <p className="text-xs text-muted-foreground">
              {pt
                ? 'Excluir a organização removerá todos os dados associados permanentemente.'
                : 'Deleting the organization will permanently remove all associated data.'}
            </p>
            {!confirmDelete ? (
              <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                {pt ? 'Excluir organização' : 'Delete organization'}
              </Button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs">
                  {pt ? `Digite "${tenant.slug}" para confirmar:` : `Type "${tenant.slug}" to confirm:`}
                </p>
                <div className="flex gap-2">
                  <Input
                    value={deleteConfirmText}
                    onChange={e => setDeleteConfirmText(e.target.value)}
                    placeholder={tenant.slug}
                    className="flex-1"
                  />
                  <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleteConfirmText !== tenant.slug}>
                    {pt ? 'Confirmar' : 'Confirm'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setConfirmDelete(false); setDeleteConfirmText(''); }}>
                    {pt ? 'Cancelar' : 'Cancel'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Pending Invites ─── */
function PendingInvitesSection() {
  const { language } = useLanguage();
  const pt = language === 'pt-BR';
  const { user } = useAuth();
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
              <p className="text-xs text-muted-foreground">{pt ? `Papel: ${invite.role}` : `Role: ${invite.role}`}</p>
            </div>
            <Button size="sm" onClick={() => acceptInvite.mutate(invite.invite_code)} disabled={acceptInvite.isPending}>
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
      return (data ?? []).map((inv: any) => ({ ...inv, tenant_name: inv.tenants?.name || null }));
    },
    enabled: !!user,
  });
}
