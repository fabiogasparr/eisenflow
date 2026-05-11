import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useTaskAttachments, type TaskAttachment } from '@/hooks/useTaskAttachments';
import { useSubtasks } from '@/hooks/useSubtasks';
import { useToast } from '@/hooks/use-toast';
import { Image as ImageIcon, Loader2, Sparkles, Trash2, Plus, X, CheckCircle2 } from 'lucide-react';
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

  const { attachments, isLoading, upload, remove, analyze } = useTaskAttachments(taskId);
  const { addSubtask } = useSubtasks(taskId);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      try {
        await upload.mutateAsync(file);
      } catch (e: any) {
        toast({ title: pt ? 'Falha no upload' : 'Upload failed', description: e.message, variant: 'destructive' });
      }
    }
  };

  const handleAnalyze = async (att: TaskAttachment) => {
    setActiveAtt(att);
    setAnalysis(null);
    try {
      const result = await analyze.mutateAsync(att.id);
      setAnalysis(result);
    } catch (e: any) {
      toast({ title: pt ? 'Erro na análise' : 'Analysis error', description: e.message, variant: 'destructive' });
      setActiveAtt(null);
    }
  };

  const handleAddToDescription = () => {
    if (!analysis) return;
    const block = `\n\n📷 ${pt ? 'Texto extraído da imagem' : 'Text extracted from image'}:\n${analysis.ocr_text}`;
    onAppendDescription((taskDescription || '') + block);
    toast({ title: pt ? 'Adicionado à descrição' : 'Added to description' });
  };

  const handleGenerateSubtasks = async () => {
    if (!analysis?.suggested_subtasks?.length) return;
    let pos = 0;
    for (const title of analysis.suggested_subtasks) {
      await addSubtask.mutateAsync({ title, position: pos++ });
    }
    toast({ title: pt ? 'Subtarefas criadas' : 'Subtasks created' });
  };

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
            <button onClick={() => { setActiveAtt(null); setAnalysis(null); }}>
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
          {!analysis ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {pt ? 'Analisando imagem...' : 'Analyzing image...'}
            </div>
          ) : (
            <>
              {analysis.description && (
                <div>
                  <p className="text-[11px] uppercase text-muted-foreground mb-1">
                    {pt ? 'Descrição' : 'Description'}
                  </p>
                  <p className="text-xs">{analysis.description}</p>
                </div>
              )}
              {analysis.ocr_text && (
                <div>
                  <p className="text-[11px] uppercase text-muted-foreground mb-1">
                    {pt ? 'Texto extraído (OCR)' : 'Extracted text (OCR)'}
                  </p>
                  <pre className="text-xs whitespace-pre-wrap bg-background rounded p-2 max-h-40 overflow-auto">
                    {analysis.ocr_text}
                  </pre>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {analysis.ocr_text && (
                  <Button size="sm" variant="outline" onClick={handleAddToDescription}>
                    {pt ? 'Adicionar à descrição' : 'Add to description'}
                  </Button>
                )}
                {analysis.suggested_subtasks?.length > 0 && (
                  <Button size="sm" onClick={handleGenerateSubtasks}>
                    {pt ? `Criar ${analysis.suggested_subtasks.length} subtarefa(s)` : `Create ${analysis.suggested_subtasks.length} subtask(s)`}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
