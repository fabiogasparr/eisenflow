import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type ReminderKind = 'due_d1' | 'due_1h' | 'due_now' | 'start_now' | 'start_5min' | 'custom';
export type ReminderChannel = 'in_app' | 'browser' | 'whatsapp_personal' | 'whatsapp_tenant' | 'email';
export type ReminderRecipient = 'creator' | 'assignee' | 'shared';

export interface TaskReminder {
  id: string;
  task_id: string;
  created_by: string;
  kind: ReminderKind;
  scheduled_at: string | null;
  recipients: ReminderRecipient[];
  channels: ReminderChannel[];
  enabled: boolean;
  auto_generated: boolean;
  created_at: string;
  updated_at: string;
}

export function useTaskReminders(taskId: string | undefined) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['task-reminders', taskId],
    queryFn: async (): Promise<TaskReminder[]> => {
      if (!taskId) return [];
      const { data, error } = await (supabase as any)
        .from('task_reminders')
        .select('*')
        .eq('task_id', taskId)
        .order('scheduled_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as TaskReminder[];
    },
    enabled: !!taskId,
  });

  const upsert = useMutation({
    mutationFn: async (r: Partial<TaskReminder> & { task_id: string; kind: ReminderKind }) => {
      const { data: user } = await supabase.auth.getUser();
      const payload: any = {
        task_id: r.task_id,
        kind: r.kind,
        scheduled_at: r.scheduled_at ?? null,
        recipients: r.recipients ?? ['creator', 'assignee'],
        channels: r.channels ?? ['in_app', 'browser'],
        enabled: r.enabled ?? true,
        auto_generated: false,
        created_by: user.user?.id,
      };
      if (r.id) {
        const { error } = await (supabase as any).from('task_reminders').update(payload).eq('id', r.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from('task_reminders').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-reminders', taskId] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('task_reminders').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-reminders', taskId] }),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await (supabase as any).from('task_reminders').update({ enabled }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-reminders', taskId] }),
  });

  return { reminders: query.data ?? [], isLoading: query.isLoading, upsert, remove, toggle };
}

export interface UserReminderPrefs {
  id: string;
  user_id: string;
  auto_due_d1: boolean;
  auto_due_1h: boolean;
  auto_due_now: boolean;
  auto_start: boolean;
  default_channels: ReminderChannel[];
  default_recipients: ReminderRecipient[];
  timezone: string;
}

export function useReminderPreferences() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['reminder-prefs'],
    queryFn: async (): Promise<UserReminderPrefs | null> => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return null;
      const { data } = await (supabase as any)
        .from('user_reminder_preferences').select('*').eq('user_id', user.user.id).maybeSingle();
      return data as UserReminderPrefs | null;
    },
  });

  const save = useMutation({
    mutationFn: async (prefs: Partial<UserReminderPrefs>) => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error('unauth');
      const payload = { ...prefs, user_id: user.user.id };
      const { error } = await (supabase as any).from('user_reminder_preferences').upsert(payload, { onConflict: 'user_id' });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminder-prefs'] }),
  });

  return { prefs: query.data ?? null, isLoading: query.isLoading, save };
}

export interface RecurringSchedule {
  id: string;
  user_id: string;
  tenant_id: string | null;
  kind: 'daily_summary' | 'weekly_plan' | 'custom';
  cron_local: string;
  weekday: number | null;
  timezone: string;
  channels: ReminderChannel[];
  enabled: boolean;
  last_run_at: string | null;
}

export function useRecurringSchedules() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['recurring-schedules'],
    queryFn: async (): Promise<RecurringSchedule[]> => {
      const { data, error } = await (supabase as any)
        .from('recurring_schedules').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as RecurringSchedule[];
    },
  });

  const upsert = useMutation({
    mutationFn: async (s: Partial<RecurringSchedule>) => {
      const { data: user } = await supabase.auth.getUser();
      const payload: any = { ...s, user_id: user.user?.id };
      if (s.id) {
        const { error } = await (supabase as any).from('recurring_schedules').update(payload).eq('id', s.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from('recurring_schedules').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring-schedules'] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('recurring_schedules').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring-schedules'] }),
  });

  return { schedules: query.data ?? [], isLoading: query.isLoading, upsert, remove };
}
