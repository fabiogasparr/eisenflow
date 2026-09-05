import { useState, useEffect, useCallback, useRef } from 'react';
import { useTasks } from './useTasks';
import { useLanguage } from '@/i18n/LanguageContext';
import { useToast } from './use-toast';
import { supabase } from '@/integrations/supabase/client';

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

  const sendWhatsAppReminder = useCallback(async (label: string, taskTitle: string) => {
    try {
      // Check if user has WhatsApp connected with reminders enabled
      const { data: conn } = await (supabase as any)
        .from('whatsapp_connections')
        .select('instance_name, phone_number, reminders_enabled, status')
        .maybeSingle();
      
      if (!conn || conn.status !== 'connected' || !conn.reminders_enabled || !conn.phone_number) return;

      await supabase.functions.invoke('whatsapp-send', {
        body: {
          instance_name: conn.instance_name,
          phone_number: conn.phone_number,
          message: `⏰ *${label}*\n${taskTitle}`,
        },
      });
    } catch {
      // Silent fail - WhatsApp is optional
    }
  }, []);

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

          // WhatsApp notification (fire and forget)
          sendWhatsAppReminder(label, task.title);
        }
      });
    });
  }, [tasks, language, toast, sendBrowserNotification, sendWhatsAppReminder]);

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
