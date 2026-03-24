import { useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { useLanguage } from '@/i18n/LanguageContext';
import { useTenants, useTenantMembers, type Tenant } from '@/hooks/useTenants';
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
import { Building2, Plus, Users, Crown, Shield, User, Trash2, MoreVertical } from 'lucide-react';
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

        {/* Members of selected tenant */}
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

function TenantMembersSection({ tenant }: { tenant: Tenant }) {
  const { language } = useLanguage();
  const pt = language === 'pt-BR';
  const { user } = useAuth();
  const { members, isLoading, updateMemberRole, removeMember } = useTenantMembers(tenant.id);

  const myMembership = members.find(m => m.user_id === user?.id);
  const canManage = myMembership?.role === 'owner' || myMembership?.role === 'admin';

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
  );
}
