import { useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Sparkles } from 'lucide-react';
import { type Quadrant, type CreateTaskInput, type RecurrenceRule, QUADRANT_CONFIG } from '@/types/task';
import { useTeams, useTeamMembers } from '@/hooks/useTeams';

interface CreateTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (task: CreateTaskInput) => Promise<void>;
  onClassifyWithAI?: (title: string, description: string) => Promise<{ quadrant: Quadrant; urgency: number; importance: number } | null>;
}

export function CreateTaskDialog({ open, onOpenChange, onSubmit, onClassifyWithAI }: CreateTaskDialogProps) {
  const { t, language } = useLanguage();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [estimatedTime, setEstimatedTime] = useState('');
  const [quadrant, setQuadrant] = useState<Quadrant>('do');
  const [urgency, setUrgency] = useState(3);
  const [importance, setImportance] = useState(3);
  const [tags, setTags] = useState('');
  const [assignedTo, setAssignedTo] = useState<string>('');
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<{ quadrant: Quadrant; urgency: number; importance: number } | null>(null);
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRule | ''>('');

  const { teams } = useTeams();
  const { members } = useTeamMembers(selectedTeamId || null);

  const handleClassify = async () => {
    if (!title || !onClassifyWithAI) return;
    setClassifying(true);
    try {
      const result = await onClassifyWithAI(title, description);
      if (result) {
        setAiSuggestion(result);
      }
    } finally {
      setClassifying(false);
    }
  };

  const acceptAiSuggestion = () => {
    if (aiSuggestion) {
      setQuadrant(aiSuggestion.quadrant);
      setUrgency(aiSuggestion.urgency);
      setImportance(aiSuggestion.importance);
      setAiSuggestion(null);
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setLoading(true);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() || undefined,
        due_date: dueDate || undefined,
        estimated_time: estimatedTime ? parseInt(estimatedTime) : undefined,
        tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : undefined,
        quadrant,
        urgency,
        importance,
        assigned_to: assignedTo || undefined,
        recurrence_rule: recurrenceRule || undefined,
      } as CreateTaskInput);
      // Reset
      setTitle('');
      setDescription('');
      setDueDate('');
      setEstimatedTime('');
      setQuadrant('do');
      setUrgency(3);
      setImportance(3);
      setTags('');
      setAssignedTo('');
      setSelectedTeamId('');
      setAiSuggestion(null);
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">{t('addTask')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('taskTitle')}</Label>
            <div className="flex gap-2">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('taskTitle')} />
              {onClassifyWithAI && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleClassify}
                  disabled={!title || classifying}
                  title={t('aiSuggestion')}
                >
                  {classifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                </Button>
              )}
            </div>
          </div>

          {aiSuggestion && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
              <p className="text-sm font-medium flex items-center gap-1">
                <Sparkles className="h-4 w-4 text-primary" />
                {t('aiSuggestion')}
              </p>
              <p className="text-sm text-muted-foreground">
                {QUADRANT_CONFIG[aiSuggestion.quadrant].emoji} {t(QUADRANT_CONFIG[aiSuggestion.quadrant].labelKey)}
                {' · '}{t('taskUrgency')}: {aiSuggestion.urgency}/5
                {' · '}{t('taskImportance')}: {aiSuggestion.importance}/5
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={acceptAiSuggestion}>{t('acceptSuggestion')}</Button>
                <Button size="sm" variant="ghost" onClick={() => setAiSuggestion(null)}>{t('adjustManually')}</Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>{t('taskDescription')}</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('taskDescription')} rows={3} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('taskDueDate')}</Label>
              <Input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t('taskEstimatedTime')}</Label>
              <Input type="number" value={estimatedTime} onChange={(e) => setEstimatedTime(e.target.value)} min={1} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('taskTags')}</Label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tag1, tag2, tag3" />
          </div>

          {/* Assign to team member */}
          {teams.length > 0 && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{language === 'pt-BR' ? 'Time' : 'Team'}</Label>
                <Select value={selectedTeamId} onValueChange={(v) => { setSelectedTeamId(v); setAssignedTo(''); }}>
                  <SelectTrigger><SelectValue placeholder={language === 'pt-BR' ? 'Selecionar time' : 'Select team'} /></SelectTrigger>
                  <SelectContent>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{language === 'pt-BR' ? 'Atribuir a' : 'Assign to'}</Label>
                <Select value={assignedTo} onValueChange={setAssignedTo} disabled={!selectedTeamId}>
                  <SelectTrigger><SelectValue placeholder={language === 'pt-BR' ? 'Selecionar membro' : 'Select member'} /></SelectTrigger>
                  <SelectContent>
                    {members.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {m.profile?.display_name || (language === 'pt-BR' ? 'Usuário' : 'User')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Quadrant</Label>
              <Select value={quadrant} onValueChange={(v) => setQuadrant(v as Quadrant)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(QUADRANT_CONFIG) as Quadrant[]).map((q) => (
                    <SelectItem key={q} value={q}>
                      {QUADRANT_CONFIG[q].emoji} {q}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('taskUrgency')}</Label>
              <Select value={String(urgency)} onValueChange={(v) => setUrgency(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('taskImportance')}</Label>
              <Select value={String(importance)} onValueChange={(v) => setImportance(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
          <Button onClick={handleSubmit} disabled={loading || !title.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
