import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Check, X, Loader2, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/i18n/LanguageContext';
import { QUADRANT_CONFIG } from '@/types/task';
import type { Quadrant } from '@/types/task';
import { translations } from '@/i18n/translations';

type Suggestion = {
  id: string;
  task_id: string;
  current_quadrant: Quadrant;
  suggested_quadrant: Quadrant;
  current_importance: number;
  suggested_importance: number;
  current_urgency: number;
  applied_urgency: number;
  reason: string | null;
  tasks?: { title: string } | null;
};

export function AISuggestionsSheet() {
  const { language } = useLanguage();
  const isPt = language === 'pt-BR';
  const t = (pt: string, en: string) => (isPt ? pt : en);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);

  const { data: suggestions = [], isLoading } = useQuery({
    queryKey: ['ai-reclassification-suggestions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_reclassification_suggestions')
        .select('*, tasks(title)')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Suggestion[];
    },
    refetchInterval: 60_000,
  });

  const resolve = useMutation({
    mutationFn: async ({ id, accept }: { id: string; accept: boolean }) => {
      const s = suggestions.find((x) => x.id === id);
      if (!s) return;
      if (accept) {
        await supabase.from('tasks').update({
          importance: s.suggested_importance,
          urgency: s.applied_urgency,
          quadrant: s.suggested_quadrant,
        }).eq('id', s.task_id);
      }
      await supabase.from('task_reclassification_suggestions')
        .update({ status: accept ? 'accepted' : 'rejected', resolved_at: new Date().toISOString() })
        .eq('id', id);
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['ai-reclassification-suggestions'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      toast({ title: vars.accept ? t('Sugestão aplicada', 'Suggestion applied') : t('Sugestão descartada', 'Suggestion dismissed') });
    },
  });

  const acceptAll = async () => {
    for (const s of suggestions) await resolve.mutateAsync({ id: s.id, accept: true });
  };

  const reevaluate = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('reevaluate-deadlines', { body: {} });
      if (error) throw error;
      toast({
        title: t('Reavaliação concluída', 'Reevaluation done'),
        description: t(
          `${data?.suggestionsCreated ?? 0} sugestões · ${data?.urgencyApplied ?? 0} urgências aplicadas`,
          `${data?.suggestionsCreated ?? 0} suggestions · ${data?.urgencyApplied ?? 0} urgencies applied`
        ),
      });
      qc.invalidateQueries({ queryKey: ['ai-reclassification-suggestions'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    } catch (e: any) {
      toast({ title: t('Erro', 'Error'), description: e.message, variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  const count = suggestions.length;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 relative">
          <Sparkles className="h-4 w-4" />
          <span className="hidden sm:inline">{t('Sugestões IA', 'AI Suggestions')}</span>
          {count > 0 && (
            <span className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
              {count}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {t('Sugestões da IA', 'AI Suggestions')}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 flex items-center gap-2">
          <Button onClick={reevaluate} disabled={running} size="sm" className="gap-2">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {t('Reavaliar agora', 'Reevaluate now')}
          </Button>
          {count > 0 && (
            <Button onClick={acceptAll} variant="secondary" size="sm" className="gap-2">
              <Check className="h-4 w-4" /> {t('Aceitar todas', 'Accept all')}
            </Button>
          )}
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          {t(
            'A IA analisa tarefas próximas do prazo e sugere ajustar a importância. Você decide se aplica.',
            'AI analyzes tasks near their deadline and suggests importance adjustments. You decide whether to apply.'
          )}
        </p>

        <div className="mt-4 space-y-3">
          {isLoading && <p className="text-sm text-muted-foreground">{t('Carregando…', 'Loading…')}</p>}
          {!isLoading && count === 0 && (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t('Sem sugestões pendentes.', 'No pending suggestions.')}
            </div>
          )}
          {suggestions.map((s) => {
            const fromCfg = QUADRANT_CONFIG[s.current_quadrant];
            const toCfg = QUADRANT_CONFIG[s.suggested_quadrant];
            const tr = translations[language] as Record<string, string>;
            return (
              <div key={s.id} className="rounded-lg border bg-card p-3 space-y-2">
                <p className="font-medium text-sm leading-tight">{s.tasks?.title ?? '—'}</p>
                <div className="flex items-center gap-2 text-xs">
                  <Badge variant="outline" className="gap-1">
                    <span>{fromCfg.emoji}</span>
                    {tr[fromCfg.labelKey]}
                  </Badge>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <Badge className="gap-1">
                    <span>{toCfg.emoji}</span>
                    {tr[toCfg.labelKey]}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('Importância', 'Importance')}: {s.current_importance} → <strong>{s.suggested_importance}</strong>
                  {' · '}
                  {t('Urgência', 'Urgency')}: {s.current_urgency} → <strong>{s.applied_urgency}</strong>
                </div>
                {s.reason && <p className="text-xs italic text-muted-foreground">"{s.reason}"</p>}
                <div className="flex gap-2 pt-1">
                  <Button size="sm" className="flex-1 gap-1" onClick={() => resolve.mutate({ id: s.id, accept: true })}>
                    <Check className="h-3.5 w-3.5" /> {t('Aceitar', 'Accept')}
                  </Button>
                  <Button size="sm" variant="ghost" className="flex-1 gap-1" onClick={() => resolve.mutate({ id: s.id, accept: false })}>
                    <X className="h-3.5 w-3.5" /> {t('Descartar', 'Dismiss')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
