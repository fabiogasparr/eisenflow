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
import { supabase } from '@/integrations/supabase/client';
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
  imagePaths?: string[];
  tasks?: TaskSuggestion[];
  tasksCreated?: boolean;
}

interface PendingImage {
  id: string;
  file?: File;
  previewUrl: string;
  reused?: boolean;
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
    const remaining = MAX_IMAGES_PER_MSG - pending.length;
    const accepted: PendingImage[] = [];
    for (const file of files.slice(0, remaining)) {
      if (!ALLOWED.includes(file.type)) {
        toast({ title: pt ? 'Formato inválido' : 'Invalid format', variant: 'destructive' });
        continue;
      }
      if (file.size > MAX_BYTES) {
        toast({ title: pt ? 'Imagem maior que 10 MB' : 'Image larger than 10 MB', variant: 'destructive' });
        continue;
      }
      accepted.push({
        id: (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }
    if (accepted.length) setPending((prev) => [...prev, ...accepted]);
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
      const path = slice[i];
      const { data } = await supabase.storage
        .from('chat-attachments')
        .createSignedUrl(path, 3600);
      items.push({
        id: crypto.randomUUID(),
        previewUrl: data?.signedUrl ?? lastUserImages.urls[i] ?? '',
        reused: true,
        reusedPath: path,
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

  const uploadPendingImages = async (): Promise<string[]> => {
    if (!user || !pending.length) return [];
    const urls: string[] = [];
    for (const p of pending) {
      const ext = p.file.name.split('.').pop() || 'png';
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('chat-attachments')
        .upload(path, p.file, { contentType: p.file.type, upsert: false });
      if (upErr) throw upErr;
      const { data: signed } = await supabase.storage
        .from('chat-attachments')
        .createSignedUrl(path, 60 * 60);
      if (signed?.signedUrl) urls.push(signed.signedUrl);
    }
    return urls;
  };

  const sendMessage = async () => {
    const text = input.trim();
    if ((!text && pending.length === 0) || isLoading) return;

    setIsLoading(true);
    let imageUrls: string[] = [];
    try {
      imageUrls = await uploadPendingImages();
    } catch (e: any) {
      toast({ title: pt ? 'Falha ao enviar imagem' : 'Image upload failed', description: e.message, variant: 'destructive' });
      setIsLoading(false);
      return;
    }

    const userMsg: ChatMessage = {
      role: 'user',
      content: text || (pt ? '(imagem enviada)' : '(image sent)'),
      imageUrls: imageUrls.length ? imageUrls : undefined,
    };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
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

      const { data, error } = await supabase.functions.invoke('ai-task-chat', {
        body: { messages: apiMessages, context, images: imageUrls },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      if (data.type === 'tasks') {
        const tasks: TaskSuggestion[] = data.tasks.map((t: any) => ({
          ...t,
          selected: true,
        }));
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.summary, tasks },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.message },
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

    try {
      for (const task of selected) {
        await createTask.mutateAsync({
          title: task.title,
          description: task.description || null,
          quadrant: task.quadrant,
          urgency: task.urgency,
          importance: task.importance,
          estimated_time: task.estimated_time || null,
          assigned_to: task.assigned_to_id || null,
          project_id: task.project_id || null,
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
                    pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
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
                      <span className="truncate">{current.file.name}</span>
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

          <div className="flex gap-2 items-end">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={pending.length >= MAX_IMAGES_PER_MSG || isLoading}
              className="shrink-0 h-[44px] w-[44px]"
              aria-label={pt ? 'Anexar imagem' : 'Attach image'}
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/heic"
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
