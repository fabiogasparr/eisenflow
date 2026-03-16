import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Send, Bot, User, Loader2, CheckCircle2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TaskPreviewCard, type TaskSuggestion } from '@/components/TaskPreviewCard';
import { AppLayout } from '@/components/AppLayout';
import { useTasks } from '@/hooks/useTasks';
import { useTeams, useTeamMembers } from '@/hooks/useTeams';
import { useLanguage } from '@/i18n/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

type MessageRole = 'user' | 'assistant';

interface ChatMessage {
  role: MessageRole;
  content: string;
  tasks?: TaskSuggestion[];
  tasksCreated?: boolean;
}

export default function AIChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { createTask } = useTasks();
  const { teams } = useTeams();
  const { user } = useAuth();
  const { t } = useLanguage();
  const { toast } = useToast();

  // Get members from first team as context
  const firstTeamId = teams[0]?.id ?? null;
  const { members } = useTeamMembers(firstTeamId);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: ChatMessage = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const apiMessages = [...messages, userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const context = {
        teamMembers: members.map(m => ({
          id: m.user_id,
          name: m.profile?.display_name || 'Membro',
        })),
        projects: [], // Could fetch projects here
      };

      const { data, error } = await supabase.functions.invoke('ai-task-chat', {
        body: { messages: apiMessages, context },
      });

      if (error) throw error;

      if (data.error) {
        throw new Error(data.error);
      }

      if (data.type === 'tasks') {
        const tasks: TaskSuggestion[] = data.tasks.map((t: any) => ({
          ...t,
          selected: true,
        }));
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: data.summary, tasks },
        ]);
      } else {
        setMessages(prev => [
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
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Desculpe, ocorreu um erro. Tente novamente.' },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleTask = (msgIndex: number, taskIndex: number) => {
    setMessages(prev =>
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

    const selected = msg.tasks.filter(t => t.selected);
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

      setMessages(prev =>
        prev.map((m, i) =>
          i === msgIndex ? { ...m, tasksCreated: true } : m
        )
      );

      toast({
        title: '✅',
        description: `${selected.length} tarefa(s) criada(s) com sucesso!`,
      });
    } catch (err: any) {
      toast({
        title: 'Erro',
        description: err.message,
        variant: 'destructive',
      });
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
      <div className="flex flex-col h-[calc(100dvh-7rem)] md:h-full min-h-0 max-w-3xl mx-auto">
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
                  <div className={`text-sm ${msg.role === 'assistant' ? 'prose prose-sm dark:prose-invert max-w-none' : ''}`}>
                    {msg.role === 'assistant' ? (
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    ) : (
                      <p>{msg.content}</p>
                    )}
                  </div>

                  {msg.tasks && msg.tasks.length > 0 && (
                    <div className="space-y-2">
                      {msg.tasks.map((task, j) => (
                        <TaskPreviewCard
                          key={j}
                          task={task}
                          index={j}
                          onToggle={(idx) => toggleTask(i, idx)}
                        />
                      ))}
                      {!msg.tasksCreated ? (
                        <Button
                          size="sm"
                          onClick={() => confirmTasks(i)}
                          disabled={!msg.tasks.some(t => t.selected)}
                          className="w-full mt-2"
                        >
                          <CheckCircle2 className="h-4 w-4 mr-1.5" />
                          {t('confirmTasks')} ({msg.tasks.filter(t => t.selected).length})
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
        <div className="border-t border-border p-3 pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-3 shrink-0">
          <div className="flex gap-2 items-end">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('aiChatPlaceholder')}
              className="min-h-[44px] max-h-[120px] resize-none"
              rows={1}
            />
            <Button
              size="icon"
              onClick={sendMessage}
              disabled={!input.trim() || isLoading}
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
