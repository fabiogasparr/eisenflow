import { useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { useLanguage } from '@/i18n/LanguageContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, FolderKanban } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

export default function Projects() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6366f1');

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const createProject = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Not auth');
      const { error } = await supabase.from('projects').insert({ name, color, owner_id: user.id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setCreateOpen(false);
      setName('');
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold">{t('projects')}</h1>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            {t('addTask').replace('Tarefa', 'Projeto').replace('Task', 'Project')}
          </Button>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project: any) => (
            <Card key={project.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="flex-row items-center gap-3 space-y-0">
                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: project.color }} />
                <CardTitle className="font-display text-lg">{project.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FolderKanban className="h-4 w-4" />
                  <span>{new Date(project.created_at).toLocaleDateString()}</span>
                </div>
              </CardContent>
            </Card>
          ))}
          {projects.length === 0 && (
            <p className="text-muted-foreground col-span-full text-center py-12">
              {t('noTasks')}
            </p>
          )}
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-display">New Project</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
              <div className="flex items-center gap-3">
                <label className="text-sm text-muted-foreground">Color</label>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-8 rounded cursor-pointer" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>{t('cancel')}</Button>
              <Button onClick={() => createProject.mutate()} disabled={!name.trim()}>{t('save')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
