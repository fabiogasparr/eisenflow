import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  create, update, remove, upsert as upsertDoc, findOne, listDocs, getById, Query,
} from '@/integrations/appwrite/database';
import { subscribeCollection } from '@/integrations/appwrite/realtime';
import { inheritFrom, ownerOnly } from '@/integrations/appwrite/permissions';
import { getCurrentUser } from '@/integrations/appwrite/auth';

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
      const docs = await listDocs('task_reminders', [
        Query.equal('task_id', taskId),
        Query.orderAsc('scheduled_at'),
      ]);
      return docs as unknown as TaskReminder[];
    },
    enabled: !!taskId,
  });

  const upsert = useMutation({
    mutationFn: async (r: Partial<TaskReminder> & { task_id: string; kind: ReminderKind }) => {
      const user = await getCurrentUser();
      if (!user) throw new Error('Not authenticated');

      const payload = {
        task_id: r.task_id,
        kind: r.kind,
        scheduled_at: r.scheduled_at ?? null,
        // `recipients` e `channels` são ARRAYS e no Appwrite atributo array não
        // aceita default no schema — o DEFAULT do Postgres passa a ser aplicado
        // aqui, no código, na criação.
        recipients: r.recipients ?? ['creator', 'assignee'],
        channels: r.channels ?? ['in_app'],
        enabled: r.enabled ?? true,
        auto_generated: false,
        created_by: user.$id,
      };

      if (r.id) {
        // Editar canal/horário não muda quem enxerga o lembrete: as permissões
        // gravadas na criação seguem valendo.
        await update('task_reminders', r.id, payload);
        return;
      }

      // PERMISSÕES: a policy "task reminders select" (e as de insert/update/
      // delete) faziam um EXISTS em `tasks` a cada query — criador, responsável,
      // membro do tenant, membro do time do projeto ou usuário com share viam o
      // lembrete. No Appwrite isso vira permissão gravada no documento: o
      // lembrete HERDA as permissões da tarefa pai, e quem criou ganha
      // read/update/delete explícitos (pode ser um convidado com edit, que não
      // aparece na permissão de delete da tarefa).
      const parent = await getById('tasks', r.task_id);
      await create(
        'task_reminders',
        payload,
        [...new Set([...inheritFrom(parent.$permissions), ...ownerOnly(user.$id)])],
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-reminders', taskId] }),
  });

  const remove_ = useMutation({
    mutationFn: async (id: string) => {
      await remove('task_reminders', id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-reminders', taskId] }),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      await update('task_reminders', id, { enabled });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-reminders', taskId] }),
  });

  // Realtime. O `filter: task_id=eq.<id>` do Supabase não existe no Appwrite: a
  // assinatura é por collection e só chegam eventos de documentos que a sessão
  // pode LER — o recorte de segurança já vem da permissão. O recorte por tarefa
  // fica com o refetch, que refaz a query filtrada.
  useEffect(() => {
    if (!taskId) return undefined;
    const unsubs = [
      subscribeCollection('task_reminders', () => {
        qc.invalidateQueries({ queryKey: ['task-reminders', taskId] });
      }),
      subscribeCollection('scheduled_reminders', () => {
        qc.invalidateQueries({ queryKey: ['scheduled-reminders', taskId] });
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [taskId, qc]);

  return { reminders: query.data ?? [], isLoading: query.isLoading, upsert, remove: remove_, toggle };
}

export interface ScheduledReminderRow {
  id: string;
  task_reminder_id: string | null;
  task_id: string | null;
  user_id: string;
  channel: ReminderChannel;
  kind: ReminderKind;
  scheduled_at: string;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
}

/**
 * `scheduled_reminders` é SERVER-ONLY (access: 'server-doc'): a fila é escrita e
 * drenada pela Function `dispatch-reminders` (e enfileirada por
 * `process-recurring-schedules`). Aqui o cliente SÓ LÊ — e só enxerga as
 * próprias linhas, porque a permissão de leitura é gravada em cada documento
 * pelo servidor, no lugar da policy "own scheduled select".
 */
export function useTaskScheduledReminders(taskId: string | undefined) {
  const query = useQuery({
    queryKey: ['scheduled-reminders', taskId],
    queryFn: async (): Promise<ScheduledReminderRow[]> => {
      if (!taskId) return [];
      const docs = await listDocs('scheduled_reminders', [
        Query.equal('task_id', taskId),
        Query.orderAsc('scheduled_at'),
      ]);
      return docs as unknown as ScheduledReminderRow[];
    },
    enabled: !!taskId,
  });
  return { rows: query.data ?? [], isLoading: query.isLoading };
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
      const user = await getCurrentUser();
      if (!user) return null;
      const doc = await findOne('user_reminder_preferences', [Query.equal('user_id', user.$id)]);
      return doc as unknown as UserReminderPrefs | null;
    },
  });

  const save = useMutation({
    mutationFn: async (prefs: Partial<UserReminderPrefs>) => {
      const user = await getCurrentUser();
      if (!user) throw new Error('unauth');

      // PERMISSÕES: as quatro policies "own prefs select/insert/update/delete"
      // eram todas `auth.uid() = user_id` — dono exclusivo. É exatamente o
      // ownerOnly. O upsert por `onConflict: 'user_id'` vira busca pelo mesmo
      // filtro: atualiza se achar, cria se não achar.
      await upsertDoc(
        'user_reminder_preferences',
        [Query.equal('user_id', user.$id)],
        {
          ...prefs,
          user_id: user.$id,
          // Arrays não têm default no schema do Appwrite: aplicado aqui.
          // Atenção: o default do Postgres nesta tabela era {in_app,browser} —
          // diferente de task_reminders.channels, que era só {in_app}.
          default_channels: prefs.default_channels ?? ['in_app', 'browser'],
          default_recipients: prefs.default_recipients ?? ['creator', 'assignee'],
        } as never,
        ownerOnly(user.$id),
      );
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
      // A policy "own recurring select" filtrava por user_id; agora o recorte
      // vem da permissão gravada no documento, então a query não precisa filtrar.
      const docs = await listDocs('recurring_schedules', [Query.orderDesc('created_at')]);
      return docs as unknown as RecurringSchedule[];
    },
  });

  const upsert = useMutation({
    mutationFn: async (s: Partial<RecurringSchedule>) => {
      const user = await getCurrentUser();
      if (!user) throw new Error('unauth');

      if (s.id) {
        // Só campos; o dono não muda, então as permissões seguem as da criação.
        const { id: _id, ...campos } = s;
        await update('recurring_schedules', s.id, campos as never);
        return;
      }

      // PERMISSÕES: "own recurring select/insert/update/delete" eram
      // `auth.uid() = user_id` — dono exclusivo, ownerOnly.
      await create(
        'recurring_schedules',
        {
          ...s,
          user_id: user.$id,
          kind: s.kind ?? 'daily_summary',
          // Array sem default no schema: o padrão vem daqui.
          channels: s.channels ?? ['in_app'],
        } as never,
        ownerOnly(user.$id),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring-schedules'] }),
  });

  const remove_ = useMutation({
    mutationFn: async (id: string) => {
      await remove('recurring_schedules', id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring-schedules'] }),
  });

  return { schedules: query.data ?? [], isLoading: query.isLoading, upsert, remove: remove_ };
}
