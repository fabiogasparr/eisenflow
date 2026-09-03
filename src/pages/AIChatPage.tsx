import { useState, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { Send, Bot, User, Loader2, CheckCircle2, Sparkles, Paperclip, X, Image as ImageIcon, Trash2, GripVertical, History } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { TaskPreviewCard, type TaskSuggestion } from '@/components/TaskPreviewCard';
import { EisenhowerTaskGroups } from '@/components/EisenhowerTaskGroups';
import { AppLayout } from '@/components/AppLayout';
import { useTasks } from '@/hooks/useTasks';
import { useTeams, useTeamMembers } from '@/hooks/useTeams';
import { useLanguage } from '@/i18n/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { invoke } from '@/integrations/appwrite/functions';
import { uploadFile, fileViewUrl, fileOwnerPermissions } from '@/integrations/appwrite/files';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type MessageRole = 'user' | 'assistant';

interface ChatMessage {
  role: MessageRole;
  content: string;
  imageUrls?: string[];
  /**
   * No Supabase guardava o caminho no bucket (`{uid}/arquivo.png`). No Appwrite
   * o identificador de um arquivo é o `$id`, então aqui viajam fileIds. O nome
   * do campo foi mantido para não mexer no resto do componente.
   */
  imagePaths?: string[];
  tasks?: TaskSuggestion[];
  tasksCreated?: boolean;
}

interface PendingImage {
  id: string;
  file?: File;
  previewUrl: string;
  reused?: boolean;
  /** fileId do Appwrite (era o caminho do objeto no Storage do Supabase). */
  reusedPath?: string;
}

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic'];
const MAX_IMAGES_PER_MSG = 4;

function SortableThumb({
  item,
  index,
  total,
  pt,
  onPreview,
  onRemove,
}: {
  item: PendingImage;
  index: number;
  total: number;
  pt: boolean;
  onPreview: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'relative group rounded-lg',
        isDragging && 'shadow-lg ring-2 ring-primary opacity-90'
      )}
      aria-label={pt ? `Imagem ${index + 1} de ${total}` : `Image ${index + 1} of ${total}`}
    >
      <button
        type="button"
        onClick={onPreview}
        className="block focus:outline-none focus:ring-2 focus:ring-primary rounded-lg"
        aria-label={pt ? 'Ampliar imagem' : 'Enlarge image'}
      >
        <img
          src={item.previewUrl}
          alt={item.file?.name ?? 'image'}
          draggable={false}
          className="h-20 w-20 rounded-lg object-cover border border-border transition-transform group-hover:scale-[1.02] select-none"
        />
      </button>
      <div className="absolute inset-x-0 bottom-0 rounded-b-lg bg-gradient-to-t from-black/70 to-transparent px-1 py-0.5 text-[10px] text-white truncate pointer-events-none">
        {item.file ? `${(item.file.size / 1024).toFixed(0)} KB` : (pt ? 'reusada' : 'reused')}
      </div>
      {item.reused && (
        <span className="absolute top-1 right-4 text-[9px] bg-secondary text-secondary-foreground px-1 rounded pointer-events-none">
          ↻
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-1 shadow-md hover:scale-110 transition-transform"
        aria-label={pt ? 'Remover imagem' : 'Remove image'}
      >
        <X className="h-3 w-3" />
      </button>
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="absolute -top-1.5 -left-1.5 bg-background border border-border text-muted-foreground rounded-full p-1 shadow-md hover:bg-muted cursor-grab active:cursor-grabbing touch-none"
        aria-label={pt ? 'Arrastar para reordenar' : 'Drag to reorder'}
      >
        <GripVertical className="h-3 w-3" />
      </button>
    </div>
  );
}

export default function AIChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { createTask } = useTasks();
  const { teams } = useTeams();
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const pt = language === 'pt-BR';
  const { toast } = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const firstTeamId = teams[0]?.id ?? null;
  const { members } = useTeamMembers(firstTeamId);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const addImages = (files: File[]) => {
    type RejectReason = 'invalid_type' | 'too_large' | 'empty' | 'over_count';
    const EXT_OK = new Set(['png', 'jpg', 'jpeg', 'webp', 'heic']);
    const isImageFile = (f: File) => {
      if (ALLOWED.includes(f.type)) return true;
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      return EXT_OK.has(ext);
    };
    const fmtMB = (n: number) => (n / (1024 * 1024)).toFixed(1) + ' MB';

    const rejects: Record<RejectReason, string[]> = {
      invalid_type: [], too_large: [], empty: [], over_count: [],
    };
    const accepted: PendingImage[] = [];
    let slotsLeft = MAX_IMAGES_PER_MSG - pending.length;

    for (const file of files) {
      if (!isImageFile(file))    { rejects.invalid_type.push(file.name || (pt ? 'arquivo' : 'file')); continue; }
      if (file.size === 0)       { rejects.empty.push(file.name); continue; }
      if (file.size > MAX_BYTES) { rejects.too_large.push(`${file.name} (${fmtMB(file.size)})`); continue; }
      if (slotsLeft <= 0)        { rejects.over_count.push(file.name); continue; }
      slotsLeft--;
      accepted.push({
        id: (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }

    if (accepted.length) setPending((prev) => [...prev, ...accepted]);

    const showToast = (title: string, list: string[]) => {
      if (!list.length) return;
      const head = list.slice(0, 3).join(', ');
      const desc = list.length > 3 ? `${head} +${list.length - 3}` : head;
      toast({ title, description: desc, variant: 'destructive' });
    };

    showToast(
      pt ? 'Formato não suportado — use PNG, JPG, WEBP ou HEIC'
         : 'Unsupported format — use PNG, JPG, WEBP or HEIC',
      rejects.invalid_type,
    );
    showToast(
      pt ? 'Arquivo muito grande — máx. 10 MB' : 'File too large — max 10 MB',
      rejects.too_large,
    );
    showToast(pt ? 'Arquivo vazio' : 'Empty file', rejects.empty);
    if (rejects.over_count.length) {
      toast({
        title: pt ? 'Limite de anexos atingido' : 'Attachment limit reached',
        description: pt
          ? `${rejects.over_count.length} imagem(ns) ignorada(s). Máx. ${MAX_IMAGES_PER_MSG} por mensagem.`
          : `${rejects.over_count.length} image(s) skipped. Max ${MAX_IMAGES_PER_MSG} per message.`,
        variant: 'destructive',
      });
    }
  };

  const revokeIfBlob = (url: string) => {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  };

  const removePendingById = (id: string) => {
    setPending((prev) => {
      const found = prev.find((p) => p.id === id);
      if (found) revokeIfBlob(found.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const lastUserImages = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'user' && m.imagePaths?.length) {
        return { paths: m.imagePaths, urls: m.imageUrls ?? [] };
      }
    }
    return null;
  }, [messages]);

  const reuseLastImages = async () => {
    if (!lastUserImages) return;
    const remaining = MAX_IMAGES_PER_MSG - pending.length;
    if (remaining <= 0) {
      toast({ title: pt ? 'Limite de anexos atingido' : 'Attachment limit reached' });
      return;
    }
    const slice = lastUserImages.paths.slice(0, remaining);
    const items: PendingImage[] = [];
    for (let i = 0; i < slice.length; i++) {
      const fileId = slice[i];
      // O Appwrite não tem URL assinada com expiração: fileViewUrl devolve uma
      // URL fixa que só abre para quem tem permissão de leitura no arquivo.
      // Como é síncrono, o await do createSignedUrl desapareceu.
      items.push({
        id: crypto.randomUUID(),
        previewUrl: fileViewUrl('chat-attachments', fileId) || lastUserImages.urls[i] || '',
        reused: true,
        reusedPath: fileId,
      });
    }
    setPending((prev) => [...prev, ...items]);
    if (slice.length < lastUserImages.paths.length) {
      toast({
        title: pt
          ? `Adicionadas ${slice.length} de ${lastUserImages.paths.length}`
          : `Added ${slice.length} of ${lastUserImages.paths.length}`,
      });
    }
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setPending((prev) => {
      const oldIdx = prev.findIndex((p) => p.id === active.id);
      const newIdx = prev.findIndex((p) => p.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return prev;
      return arrayMove(prev, oldIdx, newIdx);
    });
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const files: File[] = [];
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      addImages(files);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    addImages(Array.from(e.dataTransfer.files));
  };

  const uploadPendingImages = async (): Promise<{ url: string; path: string }[]> => {
    if (!user || !pending.length) return [];
    const result: { url: string; path: string }[] = [];
    for (const p of pending) {
      if (p.reused && p.reusedPath) {
        // Reaproveitando um arquivo já enviado: só remonta a URL de exibição.
        result.push({ url: fileViewUrl('chat-attachments', p.reusedPath), path: p.reusedPath });
        continue;
      }
      if (!p.file) continue;
      // O caminho `${uid}/${uuid}.${ext}` sumiu: o Appwrite gera o fileId. A
      // separação por usuário que a policy do bucket fazia pelo prefixo do
      // caminho agora é permissão gravada NO ARQUIVO — só quem enviou lê.
      const file = await uploadFile('chat-attachments', p.file, fileOwnerPermissions(user.$id));
      result.push({ url: fileViewUrl('chat-attachments', file.$id), path: file.$id });
    }
    return result;
  };

  const sendMessage = async () => {
    const text = input.trim();
    if ((!text && pending.length === 0) || isLoading) return;

    setIsLoading(true);
    let uploaded: { url: string; path: string }[] = [];
    try {
      uploaded = await uploadPendingImages();
    } catch (e: any) {
      toast({ title: pt ? 'Falha ao enviar imagem' : 'Image upload failed', description: e.message, variant: 'destructive' });
      setIsLoading(false);
      return;
    }
    const imageUrls = uploaded.map((u) => u.url);
    const imagePaths = uploaded.map((u) => u.path);

    const userMsg: ChatMessage = {
      role: 'user',
      content: text || (pt ? '(imagem enviada)' : '(image sent)'),
      imageUrls: imageUrls.length ? imageUrls : undefined,
      imagePaths: imagePaths.length ? imagePaths : undefined,
    };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    pending.forEach((p) => revokeIfBlob(p.previewUrl));
    setPending([]);

    try {
      const apiMessages = newMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const context = {
        teamMembers: members.map((m) => ({
          id: m.user_id,
          name: m.profile?.display_name || 'Membro',
        })),
        projects: [],
      };

      // TODO(migração): `images` continua indo como lista de URLs, mas a URL do
      // Appwrite Storage exige sessão do usuário — a Function `ai-task-chat`,
      // rodando no servidor com API key, não consegue baixá-la como fazia com a
      // signed URL do Supabase. O correto é a Function receber os fileIds
      // (`imagePaths`) e ler o arquivo pelo SDK server-side.
      const data = await invoke<{
        error?: string;
        type?: string;
        summary?: string;
        message?: string;
        tasks?: any[];
      }>('ai-task-chat', { messages: apiMessages, context, images: imageUrls });

      // `invoke` já lança em HTTP >= 400; este `error` é o erro de negócio que a
      // própria function devolve com status 200.
      if (data.error) throw new Error(data.error);

      if (data.type === 'tasks') {
        const tasks: TaskSuggestion[] = (data.tasks ?? []).map((t: any) => ({
          ...t,
          selected: true,
        }));
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.summary ?? '', tasks },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.message ?? '' },
        ]);
      }
    } catch (err: any) {
      console.error('Chat error:', err);
      toast({
        title: 'Erro',
        description: err.message || 'Erro ao processar mensagem',
        variant: 'destructive',
      });
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: pt ? 'Desculpe, ocorreu um erro. Tente novamente.' : 'Sorry, something went wrong.' },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleTask = (msgIndex: number, taskIndex: number) => {
    setMessages((prev) =>
      prev.map((msg, i) => {
        if (i !== msgIndex || !msg.tasks) return msg;
        const tasks = msg.tasks.map((t, j) =>
          j === taskIndex ? { ...t, selected: !t.selected } : t
        );
        return { ...msg, tasks };
      })
    );
  };

  const confirmTasks = async (msgIndex: number) => {
    const msg = messages[msgIndex];
    if (!msg?.tasks || !user) return;

    const selected = msg.tasks.filter((t) => t.selected);
    if (!selected.length) return;

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

    try {
      for (const task of selected) {
        await createTask.mutateAsync({
          title: task.title,
          description: task.description || null,
          quadrant: task.quadrant,
          urgency: task.urgency,
          importance: task.importance,
          estimated_time: task.estimated_time || null,
          assigned_to: isUuid(task.assigned_to_id) ? task.assigned_to_id : null,
          project_id: isUuid(task.project_id) ? task.project_id : null,
          tags: [],
        });
      }

      setMessages((prev) =>
        prev.map((m, i) =>
          i === msgIndex ? { ...m, tasksCreated: true } : m
        )
      );

      toast({
        title: '✅',
        description: `${selected.length} tarefa(s) criada(s) com sucesso!`,
      });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <AppLayout mainClassName="overflow-hidden !pb-0">
      <div
        className="flex flex-col h-[calc(100dvh-7rem)] md:h-full min-h-0 max-w-3xl mx-auto"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {/* Header */}
        <div className="flex items-center gap-3 py-3 px-2 border-b border-border shrink-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">{t('aiChat')}</h1>
            <p className="text-xs text-muted-foreground">{t('aiChatDesc')}</p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 min-h-0 overflow-y-auto px-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]" ref={scrollRef}>
          <div className={cn(
            "py-4",
            messages.length === 0
              ? "flex flex-col items-center justify-center min-h-full"
              : "space-y-4"
          )}>
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center text-center space-y-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                  <Bot className="h-7 w-7 text-primary" />
                </div>
                <h2 className="text-base font-medium">{t('aiChatWelcome')}</h2>
                <p className="text-sm text-muted-foreground max-w-md">
                  {t('aiChatWelcomeDesc')}
                </p>
                <p className="text-xs text-muted-foreground max-w-md flex items-center gap-1">
                  <ImageIcon className="h-3.5 w-3.5" />
                  {pt ? 'Anexe ou cole imagens para extrair tarefas automaticamente' : 'Attach or paste images to extract tasks automatically'}
                </p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                {msg.role === 'assistant' && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 mt-0.5">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] space-y-3 ${
                    msg.role === 'user'
                      ? 'rounded-2xl rounded-tr-md bg-primary text-primary-foreground px-4 py-2.5'
                      : ''
                  }`}
                >
                  {msg.imageUrls && msg.imageUrls.length > 0 && (
                    <div className="grid grid-cols-2 gap-1.5 mb-1">
                      {msg.imageUrls.map((url, k) => (
                        <img
                          key={k}
                          src={url}
                          alt=""
                          className="rounded-lg max-h-40 object-cover w-full"
                        />
                      ))}
                    </div>
                  )}
                  <div className={`text-sm ${msg.role === 'assistant' ? 'prose prose-sm dark:prose-invert max-w-none' : ''}`}>
                    {msg.role === 'assistant' ? (
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    ) : (
                      <p>{msg.content}</p>
                    )}
                  </div>

                  {msg.tasks && msg.tasks.length > 0 && (
                    <div className="space-y-2">
                      <EisenhowerTaskGroups
                        tasks={msg.tasks}
                        onToggle={(idx) => toggleTask(i, idx)}
                        onToggleQuadrant={(quadrant, nextSelected) => {
                          setMessages((prev) =>
                            prev.map((m, mi) => {
                              if (mi !== i || !m.tasks) return m;
                              return {
                                ...m,
                                tasks: m.tasks.map((tk) =>
                                  tk.quadrant === quadrant
                                    ? { ...tk, selected: nextSelected }
                                    : tk,
                                ),
                              };
                            }),
                          );
                        }}
                      />
                      {!msg.tasksCreated ? (
                        <Button
                          size="sm"
                          onClick={() => confirmTasks(i)}
                          disabled={!msg.tasks.some((t) => t.selected)}
                          className="w-full mt-2"
                        >
                          <CheckCircle2 className="h-4 w-4 mr-1.5" />
                          {t('confirmTasks')} ({msg.tasks.filter((t) => t.selected).length})
                        </Button>
                      ) : (
                        <div className="flex items-center gap-1.5 text-xs text-primary mt-1">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {t('tasksCreatedSuccess')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {msg.role === 'user' && (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted mt-0.5">
                    <User className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 mt-0.5">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('aiClassifying')}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-3 shrink-0 space-y-2">
          {pending.length > 0 && (
            <div className="rounded-lg border border-border bg-muted/40 p-2 space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                <span className="font-medium">
                  {pt
                    ? `${pending.length} de ${MAX_IMAGES_PER_MSG} imagem(ns) anexada(s)`
                    : `${pending.length} of ${MAX_IMAGES_PER_MSG} image(s) attached`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    pending.forEach((p) => revokeIfBlob(p.previewUrl));
                    setPending([]);
                  }}
                  className="inline-flex items-center gap-1 text-destructive hover:underline"
                >
                  <Trash2 className="h-3 w-3" />
                  {pt ? 'Limpar tudo' : 'Clear all'}
                </button>
              </div>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={pending.map((p) => p.id)} strategy={rectSortingStrategy}>
                  <div className="flex flex-wrap gap-2">
                    {pending.map((p, i) => (
                      <SortableThumb
                        key={p.id}
                        item={p}
                        index={i}
                        total={pending.length}
                        pt={pt}
                        onPreview={() => setPreviewId(p.id)}
                        onRemove={() => removePendingById(p.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          )}

          <Dialog open={previewId !== null} onOpenChange={(o) => !o && setPreviewId(null)}>
            <DialogContent className="max-w-3xl p-2">
              <DialogTitle className="sr-only">{pt ? 'Pré-visualização' : 'Preview'}</DialogTitle>
              {(() => {
                const current = previewId ? pending.find((p) => p.id === previewId) : null;
                if (!current) return null;
                return (
                  <div className="space-y-2">
                    <img
                      src={current.previewUrl}
                      alt=""
                      className="w-full max-h-[75vh] object-contain rounded-md"
                    />
                    <div className="flex items-center justify-between gap-2 px-1 text-sm text-muted-foreground">
                      <span className="truncate">{current.file?.name ?? (pt ? 'imagem reusada' : 'reused image')}</span>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          const id = current.id;
                          setPreviewId(null);
                          removePendingById(id);
                        }}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        {pt ? 'Remover' : 'Remove'}
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </DialogContent>
          </Dialog>

          {pending.length === 0 && (
            <p className="text-[10px] text-muted-foreground px-1">
              {pt
                ? `Máx. ${MAX_IMAGES_PER_MSG} imagens · 10 MB cada · PNG, JPG, WEBP, HEIC`
                : `Max ${MAX_IMAGES_PER_MSG} images · 10 MB each · PNG, JPG, WEBP, HEIC`}
            </p>
          )}

          <div className="flex gap-2 items-end">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={pending.length >= MAX_IMAGES_PER_MSG || isLoading}
              className="shrink-0 h-[44px] w-[44px]"
              aria-label={pt ? 'Anexar imagem' : 'Attach image'}
              title={
                pending.length >= MAX_IMAGES_PER_MSG
                  ? (pt ? `Limite de ${MAX_IMAGES_PER_MSG} imagens atingido` : `Limit of ${MAX_IMAGES_PER_MSG} images reached`)
                  : (pt ? 'Anexar imagem (PNG, JPG, WEBP, HEIC · máx. 10 MB)' : 'Attach image (PNG, JPG, WEBP, HEIC · max 10 MB)')
              }
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            {lastUserImages && pending.length < MAX_IMAGES_PER_MSG && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={reuseLastImages}
                disabled={isLoading}
                className="shrink-0 h-[44px] gap-1 text-xs"
                aria-label={pt ? 'Reusar últimas imagens' : 'Reuse last images'}
              >
                <History className="h-4 w-4" />
                <span className="hidden sm:inline">
                  {pt ? `Reusar (${lastUserImages.paths.length})` : `Reuse (${lastUserImages.paths.length})`}
                </span>
                <span className="sm:hidden">{lastUserImages.paths.length}</span>
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp,image/heic,.png,.jpg,.jpeg,.webp,.heic"
              multiple
              className="hidden"
              onChange={(e) => {
                addImages(Array.from(e.target.files || []));
                e.target.value = '';
              }}
            />
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={t('aiChatPlaceholder')}
              className="min-h-[44px] max-h-[120px] resize-none"
              rows={1}
            />
            <Button
              size="icon"
              onClick={sendMessage}
              disabled={(!input.trim() && pending.length === 0) || isLoading}
              className="shrink-0 h-[44px] w-[44px]"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
