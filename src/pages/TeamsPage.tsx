import { useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { useLanguage } from '@/i18n/LanguageContext';
import { useTeams, useTeamMembers, useTeamInvites, type Team } from '@/hooks/useTeams';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Users,
  Plus,
  Copy,
  Check,
  UserPlus,
  Crown,
  Shield,
  User,
  Trash2,
  Link,
  Mail,
  MoreVertical,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';

export default function TeamsPage() {
  const { language } = useLanguage();
  const pt = language === 'pt-BR';
  const { teams, isLoading, createTeam } = useTeams();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDesc, setNewTeamDesc] = useState('');

  const handleCreate = async () => {
    if (!newTeamName.trim()) return;
    await createTeam.mutateAsync({ name: newTeamName, description: newTeamDesc || undefined });
    setNewTeamName('');
    setNewTeamDesc('');
    setCreateOpen(false);
  };

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold">
            {pt ? 'Times' : 'Teams'}
          </h1>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                {pt ? 'Novo Time' : 'New Team'}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-display">
                  {pt ? 'Criar Time' : 'Create Team'}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>{pt ? 'Nome do time' : 'Team name'}</Label>
                  <Input
                    value={newTeamName}
                    onChange={(e) => setNewTeamName(e.target.value)}
                    placeholder={pt ? 'Ex: Marketing Digital' : 'Ex: Marketing Team'}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{pt ? 'Descrição' : 'Description'}</Label>
                  <Textarea
                    value={newTeamDesc}
                    onChange={(e) => setNewTeamDesc(e.target.value)}
                    placeholder={pt ? 'Opcional...' : 'Optional...'}
                    rows={3}
                  />
                </div>
                <Button onClick={handleCreate} disabled={!newTeamName.trim()} className="w-full">
                  {pt ? 'Criar Time' : 'Create Team'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Join by invite code */}
        <JoinByCode />

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : teams.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Users className="h-12 w-12 mb-4 opacity-30" />
              <p className="text-lg font-medium">
                {pt ? 'Nenhum time ainda' : 'No teams yet'}
              </p>
              <p className="text-sm">
                {pt ? 'Crie um time para colaborar com sua equipe' : 'Create a team to collaborate with others'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {teams.map((team) => (
              <Card
                key={team.id}
                className="cursor-pointer transition-all hover:shadow-md hover:border-primary/30"
                onClick={() => setSelectedTeam(team)}
              >
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary font-display font-bold text-lg">
                      {team.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-display font-semibold truncate">{team.name}</h3>
                      {team.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">
                          {team.description}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Team detail sheet */}
        <TeamDetailSheet
          team={selectedTeam}
          onClose={() => setSelectedTeam(null)}
        />
      </div>
    </AppLayout>
  );
}

function JoinByCode() {
  const { language } = useLanguage();
  const pt = language === 'pt-BR';
  const { acceptInvite } = useTeamInvites(null);
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);

  const handleJoin = async () => {
    if (!code.trim()) return;
    setJoining(true);
    try {
      await acceptInvite.mutateAsync(code.trim());
      setCode('');
    } finally {
      setJoining(false);
    }
  };

  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-3">
          <Link className="h-4 w-4 text-muted-foreground shrink-0" />
          <p className="text-sm text-muted-foreground shrink-0">
            {pt ? 'Entrar com código:' : 'Join with code:'}
          </p>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={pt ? 'Cole o código de convite' : 'Paste invite code'}
            className="flex-1"
          />
          <Button size="sm" onClick={handleJoin} disabled={!code.trim() || joining}>
            {pt ? 'Entrar' : 'Join'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TeamDetailSheet({ team, onClose }: { team: Team | null; onClose: () => void }) {
  const { language } = useLanguage();
  const pt = language === 'pt-BR';
  const { user } = useAuth();
  const { members, updateMemberRole, removeMember } = useTeamMembers(team?.id ?? null);
  const { invites, createInvite, cancelInvite } = useTeamInvites(team?.id ?? null);
  const { deleteTeam } = useTeams();
  const { toast } = useToast();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'manager' | 'admin'>('member');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const myMembership = members.find((m) => m.user_id === user?.id);
  const isAdmin = myMembership?.role === 'admin';
  const isManager = myMembership?.role === 'manager';
  const canManage = isAdmin || isManager;

  const handleInviteByEmail = async () => {
    if (!team || !inviteEmail.trim()) return;
    await createInvite.mutateAsync({ teamId: team.id, email: inviteEmail, role: inviteRole });
    setInviteEmail('');
  };

  const handleGenerateLink = async () => {
    if (!team) return;
    const invite = await createInvite.mutateAsync({ teamId: team.id, role: inviteRole });
    if (invite) {
      const code = (invite as any).invite_code;
      await navigator.clipboard.writeText(code);
      toast({ title: '📋', description: pt ? 'Código copiado!' : 'Code copied!' });
    }
  };

  const handleCopyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const roleIcon = (role: string) => {
    switch (role) {
      case 'admin': return <Crown className="h-3.5 w-3.5 text-quadrant-schedule" />;
      case 'manager': return <Shield className="h-3.5 w-3.5 text-primary" />;
      default: return <User className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  const roleLabel = (role: string) => {
    const labels: Record<string, Record<string, string>> = {
      admin: { 'pt-BR': 'Admin', en: 'Admin' },
      manager: { 'pt-BR': 'Gerente', en: 'Manager' },
      member: { 'pt-BR': 'Membro', en: 'Member' },
    };
    return labels[role]?.[language] || role;
  };

  return (
    <Sheet open={!!team} onOpenChange={() => onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        {team && (
          <>
            <SheetHeader>
              <SheetTitle className="font-display flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold">
                  {team.name.charAt(0).toUpperCase()}
                </div>
                {team.name}
              </SheetTitle>
              {team.description && (
                <p className="text-sm text-muted-foreground">{team.description}</p>
              )}
            </SheetHeader>

            <div className="mt-6 space-y-6">
              {/* Members */}
              <div>
                <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  {pt ? 'Membros' : 'Members'} ({members.length})
                </h4>
                <div className="space-y-2">
                  {members.map((member) => (
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
                      {isAdmin && member.user_id !== user?.id && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {member.role !== 'admin' && (
                              <DropdownMenuItem onClick={() => updateMemberRole.mutate({ memberId: member.id, role: 'admin' })}>
                                <Crown className="h-4 w-4 mr-2" /> {pt ? 'Promover a Admin' : 'Make Admin'}
                              </DropdownMenuItem>
                            )}
                            {member.role !== 'manager' && (
                              <DropdownMenuItem onClick={() => updateMemberRole.mutate({ memberId: member.id, role: 'manager' })}>
                                <Shield className="h-4 w-4 mr-2" /> {pt ? 'Promover a Gerente' : 'Make Manager'}
                              </DropdownMenuItem>
                            )}
                            {member.role !== 'member' && (
                              <DropdownMenuItem onClick={() => updateMemberRole.mutate({ memberId: member.id, role: 'member' })}>
                                <User className="h-4 w-4 mr-2" /> {pt ? 'Rebaixar a Membro' : 'Make Member'}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => removeMember.mutate(member.id)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" /> {pt ? 'Remover' : 'Remove'}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Invite section */}
              {canManage && (
                <div>
                  <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <UserPlus className="h-4 w-4" />
                    {pt ? 'Convidar' : 'Invite'}
                  </h4>

                  <div className="space-y-3">
                    {/* Role for new invite */}
                    <div className="space-y-1.5">
                      <Label className="text-xs">{pt ? 'Papel' : 'Role'}</Label>
                      <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as any)}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="member">{pt ? 'Membro' : 'Member'}</SelectItem>
                          <SelectItem value="manager">{pt ? 'Gerente' : 'Manager'}</SelectItem>
                          {isAdmin && <SelectItem value="admin">Admin</SelectItem>}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Email invite */}
                    <div className="flex gap-2">
                      <Input
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="email@example.com"
                        className="flex-1"
                      />
                      <Button size="sm" onClick={handleInviteByEmail} disabled={!inviteEmail.trim()}>
                        <Mail className="h-4 w-4 mr-1" />
                        {pt ? 'Enviar' : 'Send'}
                      </Button>
                    </div>

                    {/* Generate link */}
                    <Button variant="outline" size="sm" onClick={handleGenerateLink} className="w-full gap-2">
                      <Link className="h-4 w-4" />
                      {pt ? 'Gerar código de convite' : 'Generate invite code'}
                    </Button>

                    {/* Pending invites */}
                    {invites.length > 0 && (
                      <div className="space-y-2 mt-2">
                        <p className="text-xs text-muted-foreground font-medium">
                          {pt ? 'Convites pendentes:' : 'Pending invites:'}
                        </p>
                        {invites.map((invite) => (
                          <div key={invite.id} className="flex items-center gap-2 rounded border p-2 text-xs">
                            {invite.invited_email ? (
                              <span className="flex-1 truncate">{invite.invited_email}</span>
                            ) : (
                              <code className="flex-1 truncate font-mono text-muted-foreground">
                                {invite.invite_code}
                              </code>
                            )}
                            <Badge variant="outline" className="shrink-0">{roleLabel(invite.role)}</Badge>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0"
                              onClick={() => handleCopyCode(invite.invite_code)}
                            >
                              {copiedCode === invite.invite_code ? (
                                <Check className="h-3 w-3" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0 text-destructive"
                              onClick={() => cancelInvite.mutate(invite.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Delete team */}
              {isAdmin && (
                <div className="pt-4 border-t">
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full"
                    onClick={async () => {
                      await deleteTeam.mutateAsync(team.id);
                      onClose();
                    }}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {pt ? 'Excluir time' : 'Delete team'}
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
