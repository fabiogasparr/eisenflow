import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useTaskAttachments, type TaskAttachment } from '@/hooks/useTaskAttachments';
import { useSubtasks } from '@/hooks/useSubtasks';
import { useToast } from '@/hooks/use-toast';
import { Image as ImageIcon, Loader2, Sparkles, Trash2, Plus, X, CheckCircle2, RotateCcw, Save, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/i18n/LanguageContext';

interface Props {
  taskId: string;
  taskTitle: string;
  taskDescription?: string | null;
  onAppendDescription: (text: string) => void;
}

export function TaskAttachments({ taskId, taskTitle, taskDescription, onAppendDescription }: Props) {
  const { t, language } = useLanguage();
  const pt = language === 'pt-BR';
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeAtt, setActiveAtt] = useState<TaskAttachment | null>(null);
  const [analysis, setAnalysis] = useState<{ ocr_text: string; description: string; suggested_subtasks: string[] } | null>(null);
  const [draftSubtasks, setDraftSubtasks] = useState<{ title: string; selected: boolean }[]>([]);
  const [savingSubtasks, setSavingSubtasks] = useState(false);
  const [editedOcr, setEditedOcr] = useState('');
  const [originalOcr, setOriginalOcr] = useState('');
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // Reset/seed draft list whenever a new analysis arrives
  useEffect(() => {
    if (analysis?.suggested_subtasks?.length) {
      setDraftSubtasks(analysis.suggested_subtasks.map((title) => ({ title, selected: true })));
    } else {
      setDraftSubtasks([]);
    }
    const txt = analysis?.ocr_text ?? '';
    setEditedOcr(txt);
    setOriginalOcr(txt);
  }, [analysis]);

  const { attachments, isLoading, upload, remove, analyze, updateOcr } = useTaskAttachments(taskId);
  const { addSubtask } = useSubtasks(taskId);

  const runAnalyze = async (att: TaskAttachment) => {
    setActiveAtt(att);
    setAnalysis(null);
    setAnalyzeError(null);
    try {
      const result = await analyze.mutateAsync(att.id);
      setAnalysis(result);
    } catch (e: any) {
      setAnalyzeError(e?.message || (pt ? 'Falha na análise' : 'Analysis failed'));
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      try {
        const att = await upload.mutateAsync(file);
        // auto-trigger OCR preview right after upload
        await runAnalyze(att);
      } catch (e: any) {
        toast({ title: pt ? 'Falha no upload' : 'Upload failed', description: e.message, variant: 'destructive' });
      }
    }
  };

  const handleAnalyze = (att: TaskAttachment) => {
    void runAnalyze(att);
  };

  const ocrDirty = editedOcr !== originalOcr;

  const handleSaveOcr = async () => {
    if (!activeAtt || !ocrDirty) return;
    try {
      await updateOcr.mutateAsync({ id: activeAtt.id, ocr_text: editedOcr });
      setOriginalOcr(editedOcr);
      setAnalysis((prev) => (prev ? { ...prev, ocr_text: editedOcr } : prev));
      toast({ title: pt ? 'Texto salvo' : 'Text saved' });
    } catch (e: any) {
      toast({ title: pt ? 'Erro ao salvar' : 'Save failed', description: e.message, variant: 'destructive' });
    }
  };

  const handleAddToDescription = async () => {
    if (!analysis || !activeAtt) return;
    const text = editedOcr;
    // auto-save edits before appending so DB stays in sync
    if (ocrDirty) {
      try {
        await updateOcr.mutateAsync({ id: activeAtt.id, ocr_text: text });
        setOriginalOcr(text);
        setAnalysis((prev) => (prev ? { ...prev, ocr_text: text } : prev));
      } catch (e: any) {
        toast({ title: pt ? 'Erro ao salvar' : 'Save failed', description: e.message, variant: 'destructive' });
        return;
      }
    }
    const block = `\n\n📷 ${pt ? 'Texto extraído da imagem' : 'Text extracted from image'}:\n${text}`;
    onAppendDescription((taskDescription || '') + block);
    toast({ title: pt ? 'Adicionado à descrição' : 'Added to description' });
  };

  const handleConfirmSubtasks = async () => {
    const selected = draftSubtasks.filter((d) => d.selected && d.title.trim());
    if (!selected.length) return;
    setSavingSubtasks(true);
    try {
      let pos = 0;
      for (const item of selected) {
        await addSubtask.mutateAsync({ title: item.title.trim(), position: pos++ });
      }
      toast({
        title: pt ? 'Subtarefas criadas' : 'Subtasks created',
        description: pt
          ? `${selected.length} subtarefa(s) adicionada(s)`
          : `${selected.length} subtask(s) added`,
      });
      setDraftSubtasks([]);
      setActiveAtt(null);
      setAnalysis(null);
    } catch (e: any) {
      toast({
        title: pt ? 'Erro ao criar subtarefas' : 'Error creating subtasks',
        description: e.message,
        variant: 'destructive',
      });
    } finally {
      setSavingSubtasks(false);
    }
  };

  const allSelected = draftSubtasks.length > 0 && draftSubtasks.every((d) => d.selected);
  const selectedCount = draftSubtasks.filter((d) => d.selected).length;

  return (
    <div className="space-y-3 pt-3 border-t">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold flex items-center gap-2">
          <ImageIcon className="h-4 w-4" />
          {pt ? 'Anexos' : 'Attachments'}
          {attachments.length > 0 && <span className="text-xs text-muted-foreground">({attachments.length})</span>}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={upload.isPending}
        >
          {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          <span className="ml-1">{pt ? 'Anexar imagem' : 'Attach image'}</span>
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/heic"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {isLoading && <Skeleton className="h-20 w-full" />}

      {attachments.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {attachments.map((att) => (
            <div key={att.id} className="relative group rounded-lg overflow-hidden border bg-muted">
              {att.signed_url ? (
                <img
                  src={att.signed_url}
                  alt=""
                  className="w-full h-24 object-cover cursor-pointer"
                  onClick={() => handleAnalyze(att)}
                />
              ) : (
                <Skeleton className="w-full h-24" />
              )}
              <div className="absolute inset-x-0 bottom-0 flex justify-between p-1 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition">
                <button
                  className="text-white text-xs flex items-center gap-1 hover:underline"
                  onClick={() => handleAnalyze(att)}
                >
                  <Sparkles className="h-3 w-3" />
                  {analyze.isPending && activeAtt?.id === att.id ? '...' : pt ? 'Analisar' : 'Analyze'}
                </button>
                <button
                  className="text-white"
                  onClick={() => remove.mutate(att)}
                  aria-label="delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {att.ai_analyzed_at && (
                <span className="absolute top-1 left-1 text-[10px] bg-primary text-primary-foreground px-1 rounded">
                  ✓ IA
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {activeAtt && (
        <div className="rounded-lg border p-3 space-y-3 bg-muted/50">
          <div className="flex items-start justify-between">
            <p className="text-xs font-semibold">{pt ? 'Resultado da análise' : 'Analysis result'}</p>
            <button onClick={() => { setActiveAtt(null); setAnalysis(null); setAnalyzeError(null); }}>
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
          {!analysis && !analyzeError ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {pt ? 'Analisando automaticamente...' : 'Auto-analyzing...'}
            </div>
          ) : analyzeError ? (
            <div className="space-y-2">
              <div className="flex items-start gap-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{analyzeError}</span>
              </div>
              <Button size="sm" variant="outline" onClick={() => activeAtt && runAnalyze(activeAtt)}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                {pt ? 'Tentar novamente' : 'Retry'}
              </Button>
            </div>
          ) : (
            <>
              {analysis!.description && (
                <div>
                  <p className="text-[11px] uppercase text-muted-foreground mb-1">
                    {pt ? 'Descrição' : 'Description'}
                  </p>
                  <p className="text-xs">{analysis!.description}</p>
                </div>
              )}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] uppercase text-muted-foreground flex items-center gap-2">
                    {pt ? 'Texto extraído (OCR)' : 'Extracted text (OCR)'}
                    {ocrDirty && (
                      <Badge variant="secondary" className="text-[9px] py-0 h-4">
                        {pt ? 'Editado' : 'Edited'}
                      </Badge>
                    )}
                  </p>
                  <span className="text-[10px] text-muted-foreground">{editedOcr.length}</span>
                </div>
                <Textarea
                  value={editedOcr}
                  onChange={(e) => setEditedOcr(e.target.value)}
                  rows={6}
                  placeholder={pt ? 'Nenhum texto detectado. Você pode escrever aqui.' : 'No text detected. You can type here.'}
                  className="text-xs font-mono bg-background"
                />
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={handleSaveOcr}
                    disabled={!ocrDirty || updateOcr.isPending}
                  >
                    {updateOcr.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5 mr-1" />
                    )}
                    {pt ? 'Salvar alterações' : 'Save changes'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditedOcr(originalOcr)}
                    disabled={!ocrDirty}
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-1" />
                    {pt ? 'Desfazer' : 'Reset'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleAddToDescription} disabled={!editedOcr.trim()}>
                    {pt ? 'Adicionar à descrição' : 'Add to description'}
                  </Button>
                </div>
              </div>
            </>
          )}

              {draftSubtasks.length > 0 && (
                <div className="rounded-md border bg-background p-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] uppercase text-muted-foreground">
                      {pt ? 'Subtarefas sugeridas' : 'Suggested subtasks'}{' '}
                      <span className="normal-case">({selectedCount}/{draftSubtasks.length})</span>
                    </p>
                    <button
                      type="button"
                      className="text-[11px] text-primary hover:underline"
                      onClick={() =>
                        setDraftSubtasks((prev) => prev.map((d) => ({ ...d, selected: !allSelected })))
                      }
                    >
                      {allSelected ? (pt ? 'Desmarcar tudo' : 'Unselect all') : (pt ? 'Selecionar tudo' : 'Select all')}
                    </button>
                  </div>

                  <ul className="space-y-1.5 max-h-56 overflow-auto pr-1">
                    {draftSubtasks.map((d, idx) => (
                      <li key={idx} className="flex items-center gap-2">
                        <Checkbox
                          checked={d.selected}
                          onCheckedChange={(v) =>
                            setDraftSubtasks((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, selected: !!v } : item)),
                            )
                          }
                        />
                        <Input
                          value={d.title}
                          onChange={(e) =>
                            setDraftSubtasks((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, title: e.target.value } : item)),
                            )
                          }
                          className="h-7 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setDraftSubtasks((prev) => prev.filter((_, i) => i !== idx))
                          }
                          aria-label={pt ? 'Remover' : 'Remove'}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDraftSubtasks([])}
                      disabled={savingSubtasks}
                    >
                      {pt ? 'Cancelar' : 'Cancel'}
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleConfirmSubtasks}
                      disabled={selectedCount === 0 || savingSubtasks}
                    >
                      {savingSubtasks ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                      )}
                      {pt
                        ? `Confirmar e criar ${selectedCount}`
                        : `Confirm & create ${selectedCount}`}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
