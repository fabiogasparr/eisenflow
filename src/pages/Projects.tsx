import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { useLanguage } from '@/i18n/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { Plus, FolderKanban, Users, Archive, ArchiveRestore, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useTeams } from '@/hooks/useTeams';

export default function Projects() {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { teams } = useTeams();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [teamId, setTeamId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [editProject, setEditProject] = useState<any>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#6366f1');
  const [editTeamId, setEditTeamId] = useState<string | null>(null);
  const [deleteProject, setDeleteProject] = useState<any>(null);

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('projects')
        .select('*, teams(name)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const activeProjects = projects.filter((p: any) => !p.archived);
  const archivedProjects = projects.filter((p: any) => p.archived);
  const displayedProjects = showArchived ? projects : activeProjects;

  const createProject = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Not auth');
      const { error } = await supabase.from('projects').insert({
        name,
        color,
        owner_id: user.id,
        team_id: teamId || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setCreateOpen(false);
      setName('');
      setTeamId(null);
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const archiveProject = useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const { error } = await supabase.from('projects').update({ archived }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const updateProject = useMutation({
    mutationFn: async () => {
      if (!editProject) return;
      const { error } = await supabase.from('projects').update({
        name: editName,
        color: editColor,
        team_id: editTeamId || null,
      }).eq('id', editProject.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setEditProject(null);
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const removeProject = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('projects').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setDeleteProject(null);
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const openEdit = (project: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditProject(project);
    setEditName(project.name);
    setEditColor(project.color);
    setEditTeamId(project.team_id);
  };

  const handleCloseDialog = (open: boolean) => {
    setCreateOpen(open);
    if (!open) {
      setName('');
      setTeamId(null);
      setColor('#6366f1');
    }
  };

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold">{t('projects')}</h1>
          <div className="flex items-center gap-2">
            {archivedProjects.length > 0 && (
              <Button
                variant={showArchived ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setShowArchived(!showArchived)}
                className="gap-1.5"
              >
                <Archive className="h-4 w-4" />
                {language === 'pt-BR' ? `Arquivados (${archivedProjects.length})` : `Archived (${archivedProjects.length})`}
              </Button>
            )}
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              {language === 'pt-BR' ? 'Novo Projeto' : 'New Project'}
            </Button>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayedProjects.map((project: any) => (
            <Card
              key={project.id}
              className={`hover:shadow-md transition-shadow cursor-pointer ${project.archived ? 'opacity-50' : ''}`}
              onClick={() => navigate(`/projects/${project.id}`)}
            >
              <CardHeader className="flex-row items-center gap-3 space-y-0">
                <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: project.color }} />
                <CardTitle className="font-display text-lg truncate">{project.name}</CardTitle>
                {project.archived && (
                  <Badge variant="secondary" className="text-[10px] gap-1 shrink-0">
                    <Archive className="h-3 w-3" />
                    {language === 'pt-BR' ? 'Arquivado' : 'Archived'}
                  </Badge>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" className="ml-auto h-8 w-8 shrink-0">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem onClick={(e) => openEdit(project, e)}>
                      <Pencil className="h-4 w-4 mr-2" />
                      {language === 'pt-BR' ? 'Editar' : 'Edit'}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); archiveProject.mutate({ id: project.id, archived: !project.archived }); }}>
                      {project.archived ? <ArchiveRestore className="h-4 w-4 mr-2" /> : <Archive className="h-4 w-4 mr-2" />}
                      {project.archived
                        ? (language === 'pt-BR' ? 'Desarquivar' : 'Unarchive')
                        : (language === 'pt-BR' ? 'Arquivar' : 'Archive')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteProject(project); }}>
                      <Trash2 className="h-4 w-4 mr-2" />
                      {language === 'pt-BR' ? 'Excluir' : 'Delete'}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FolderKanban className="h-4 w-4" />
                  <span>{new Date(project.created_at).toLocaleDateString()}</span>
                  {project.teams?.name && !project.archived && (
                    <Badge variant="secondary" className="ml-auto gap-1">
                      <Users className="h-3 w-3" />
                      {project.teams.name}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {displayedProjects.length === 0 && (
            <p className="text-muted-foreground col-span-full text-center py-12">
              {showArchived
                ? (language === 'pt-BR' ? 'Nenhum projeto encontrado.' : 'No projects found.')
                : (language === 'pt-BR' ? 'Nenhum projeto ativo.' : 'No active projects.')}
            </p>
          )}
        </div>

        {/* Create Dialog */}
        <Dialog open={createOpen} onOpenChange={handleCloseDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-display">
                {language === 'pt-BR' ? 'Novo Projeto' : 'New Project'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Input
                placeholder={language === 'pt-BR' ? 'Nome do projeto' : 'Project name'}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <div className="flex items-center gap-3">
                <label className="text-sm text-muted-foreground">{language === 'pt-BR' ? 'Cor' : 'Color'}</label>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-8 rounded cursor-pointer" />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">{language === 'pt-BR' ? 'Time (opcional)' : 'Team (optional)'}</label>
                <Select value={teamId ?? '_none'} onValueChange={(v) => setTeamId(v === '_none' ? null : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder={language === 'pt-BR' ? 'Pessoal' : 'Personal'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">{language === 'pt-BR' ? 'Pessoal' : 'Personal'}</SelectItem>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => handleCloseDialog(false)}>{t('cancel')}</Button>
              <Button onClick={() => createProject.mutate()} disabled={!name.trim()}>{t('save')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog open={!!editProject} onOpenChange={(open) => !open && setEditProject(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-display">
                {language === 'pt-BR' ? 'Editar Projeto' : 'Edit Project'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Input
                placeholder={language === 'pt-BR' ? 'Nome do projeto' : 'Project name'}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
              <div className="flex items-center gap-3">
                <label className="text-sm text-muted-foreground">{language === 'pt-BR' ? 'Cor' : 'Color'}</label>
                <input type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)} className="h-8 w-8 rounded cursor-pointer" />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">{language === 'pt-BR' ? 'Time (opcional)' : 'Team (optional)'}</label>
                <Select value={editTeamId ?? '_none'} onValueChange={(v) => setEditTeamId(v === '_none' ? null : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder={language === 'pt-BR' ? 'Pessoal' : 'Personal'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">{language === 'pt-BR' ? 'Pessoal' : 'Personal'}</SelectItem>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditProject(null)}>{t('cancel')}</Button>
              <Button onClick={() => updateProject.mutate()} disabled={!editName.trim()}>{t('save')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteProject} onOpenChange={(open) => !open && setDeleteProject(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {language === 'pt-BR' ? 'Excluir projeto' : 'Delete project'}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {language === 'pt-BR'
                  ? `Tem certeza que deseja excluir "${deleteProject?.name}"? Esta ação não pode ser desfeita.`
                  : `Are you sure you want to delete "${deleteProject?.name}"? This action cannot be undone.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => deleteProject && removeProject.mutate(deleteProject.id)}
              >
                {language === 'pt-BR' ? 'Excluir' : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppLayout>
  );
}
