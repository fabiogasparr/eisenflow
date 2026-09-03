import { useState, useEffect, useCallback, useRef } from 'react';
import { useTasks } from './useTasks';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/i18n/LanguageContext';
import { useToast } from './use-toast';
import type { Task } from '@/types/task';
import { create, findOne, getById, Query } from '@/integrations/appwrite/database';
import { inheritFrom, ownerOnly } from '@/integrations/appwrite/permissions';

export interface Reminder {
  id: string;
  taskId: string;
  taskTitle: string;
  type: 'at_deadline' | '1h_before' | '1d_before';
  triggeredAt: Date;
  read: boolean;
}

const REMINDER_THRESHOLDS = [
  { type: '1d_before' as const, ms: 24 * 60 * 60 * 1000 },
  { type: '1h_before' as const, ms: 60 * 60 * 1000 },
  { type: 'at_deadline' as const, ms: 0 },
];

/** Os tipos locais deste hook nos `kind` da collection task_reminders. */
const KIND_BY_TYPE = {
  '1d_before': 'due_d1',
  '1h_before': 'due_1h',
  at_deadline: 'due_now',
} as const;

function getReminderLabel(type: Reminder['type'], lang: string): string {
  const labels: Record<Reminder['type'], Record<string, string>> = {
    '1d_before': { 'pt-BR': 'Prazo amanhã', en: 'Due tomorrow' },
    '1h_before': { 'pt-BR': 'Prazo em 1 hora', en: 'Due in 1 hour' },
    at_deadline: { 'pt-BR': 'Prazo agora!', en: 'Due now!' },
  };
  return labels[type][lang] || labels[type].en;
}

export function useReminders() {
  const { tasks } = useTasks();
  const { user } = useAuth();
  const { language } = useLanguage();
  const { toast } = useToast();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const firedRef = useRef<Set<string>>(new Set());

  const requestPermission = useCallback(async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  }, []);

  const sendBrowserNotification = useCallback((title: string, body: string) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, { body, icon: '/favicon.ico' });
      } catch {
        // Silent fail on environments that don't support Notification constructor
      }
    }
  }, []);

  /**
   * Antes o cliente chamava a function `whatsapp-send` direto. Isso deixou de
   * existir: aquele endpoint agora é interno (exige INTERNAL_FUNCTION_SECRET) —
   * era, aliás, a falha de segurança de qualquer um disparar mensagem por
   * qualquer instância. O caminho suportado passa a ser a FILA: o cliente grava
   * um `task_reminders`, o servidor materializa em `scheduled_reminders` e a
   * Function `dispatch-reminders` (cron de 5 em 5 min) entrega no canal.
   *
   * TODO(migração): a entrega deixa de ser imediata (até ~5 min de atraso) e
   * pode duplicar com a cron `whatsapp-deadline-reminders`, que já varre prazos
   * no servidor. Se a duplicação aparecer, o certo é APAGAR este enfileiramento
   * e deixar tudo com a cron — não dá para decidir isso do cliente.
   */
  const enqueueWhatsAppReminder = useCallback(async (task: Task, type: Reminder['type']) => {
    if (!user) return;
    try {
      // whatsapp_connections é server-write: o cliente só lê para saber se o
      // canal está ligado.
      const conn = await findOne('whatsapp_connections', [Query.equal('user_id', user.$id)]);
      if (!conn || conn.status !== 'connected' || !conn.reminders_enabled || !conn.phone_number) return;

      // PERMISSÕES: no Postgres a policy "task reminders insert/select" resolvia
      // o acesso com um EXISTS na tarefa a cada query. Aqui a regra é gravada no
      // documento: o lembrete herda as permissões da tarefa (para que
      // responsável, tenant e compartilhados também o enxerguem) e quem criou
      // ganha read/update/delete explícitos.
      const parent = await getById('tasks', task.id);
      await create(
        'task_reminders',
        {
          task_id: task.id,
          created_by: user.$id,
          kind: KIND_BY_TYPE[type],
          scheduled_at: new Date().toISOString(),
          // Arrays não têm default no schema do Appwrite — o padrão vem daqui.
          channels: ['whatsapp_personal'],
          recipients: ['creator', 'assignee'],
          enabled: true,
          auto_generated: true,
        },
        [...new Set([...inheritFrom(parent.$permissions), ...ownerOnly(user.$id)])],
      );
    } catch {
      // Silent fail - WhatsApp is optional
    }
  }, [user]);

  const checkTasks = useCallback(() => {
    const now = Date.now();
    const pendingTasks = tasks.filter(
      (t) => t.due_date && t.status !== 'completed' && t.status !== 'eliminated'
    );

    pendingTasks.forEach((task) => {
      const dueTime = new Date(task.due_date!).getTime();
      const timeUntilDue = dueTime - now;

      REMINDER_THRESHOLDS.forEach(({ type, ms }) => {
        const key = `${task.id}-${type}`;
        if (firedRef.current.has(key)) return;

        // Fire if within 10-minute window of the threshold
        const diff = timeUntilDue - ms;
        if (diff <= 0 && diff > -(10 * 60 * 1000)) {
          firedRef.current.add(key);

          const label = getReminderLabel(type, language);
          const newReminder: Reminder = {
            id: key,
            taskId: task.id,
            taskTitle: task.title,
            type,
            triggeredAt: new Date(),
            read: false,
          };

          setReminders((prev) => [newReminder, ...prev]);

          // In-app toast
          toast({
            title: `⏰ ${label}`,
            description: task.title,
          });

          // Browser notification
          sendBrowserNotification(label, task.title);

          // WhatsApp: enfileira e esquece — quem entrega é o dispatch-reminders.
          enqueueWhatsAppReminder(task, type);
        }
      });
    });
  }, [tasks, language, toast, sendBrowserNotification, enqueueWhatsAppReminder]);

  useEffect(() => {
    requestPermission();
  }, [requestPermission]);

  useEffect(() => {
    checkTasks();
    const interval = setInterval(checkTasks, 30_000);
    return () => clearInterval(interval);
  }, [checkTasks]);



  const markAsRead = useCallback((id: string) => {
    setReminders((prev) =>
      prev.map((r) => (r.id === id ? { ...r, read: true } : r))
    );
  }, []);

  const markAllAsRead = useCallback(() => {
    setReminders((prev) => prev.map((r) => ({ ...r, read: true })));
  }, []);

  const clearAll = useCallback(() => {
    setReminders([]);
  }, []);

  const unreadCount = reminders.filter((r) => !r.read).length;

  return { reminders, unreadCount, markAsRead, markAllAsRead, clearAll };
}
