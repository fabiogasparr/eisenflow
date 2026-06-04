import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Bell, Plus, X, Smartphone, MessageCircle, Mail, Monitor, Building2, CalendarClock, BellOff } from 'lucide-react';
import {
  useTaskReminders,
  useTaskScheduledReminders,
  type ReminderChannel,
  type ReminderRecipient,
  type ReminderKind,
  type TaskReminder,
  type ScheduledReminderRow,
} from '@/hooks/useTaskReminders';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface Props { taskId: string; }

const KIND_LABELS: Record<ReminderKind, string> = {
  due_d1: 'D-1 (1 dia antes)',
  due_1h: '1 hora antes',
  due_now: 'No vencimento',
  start_now: 'No início',
  start_5min: '5 min antes do início',
  custom: 'Personalizado',
};

const CHANNEL_META: { key: ReminderChannel; icon: any; label: string }[] = [
  { key: 'in_app', icon: Bell, label: 'No app' },
  { key: 'browser', icon: Monitor, label: 'Navegador' },
  { key: 'whatsapp_personal', icon: Smartphone, label: 'WhatsApp pessoal' },
  { key: 'whatsapp_tenant', icon: Building2, label: 'WhatsApp do workspace' },
  { key: 'email', icon: Mail, label: 'E-mail' },
];

const RECIPIENT_LABELS: Record<ReminderRecipient, string> = {
  creator: 'Criador',
  assignee: 'Responsável',
  shared: 'Compartilhados',
};

function ReschedulePopover({ reminder, onSave }: { reminder: TaskReminder; onSave: (iso: string) => void }) {
  const initial = reminder.scheduled_at ? new Date(reminder.scheduled_at) : new Date();
  const [date, setDate] = useState<Date | undefined>(initial);
  const [time, setTime] = useState(format(initial, 'HH:mm'));
  const [open, setOpen] = useState(false);

  const save = () => {
    if (!date) return;
    const [hh, mm] = time.split(':').map(Number);
    const dt = new Date(date);
    dt.setHours(hh, mm || 0, 0, 0);
    onSave(dt.toISOString());
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Reprogramar">
          <CalendarClock className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3 space-y-2">
        <Calendar mode="single" selected={date} onSelect={setDate} initialFocus />
        <div className="flex items-center gap-2">
          <Label className="text-xs">Hora</Label>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="flex h-8 w-28 rounded-md border border-input bg-background px-2 text-sm"
          />
        </div>
        <Button size="sm" className="w-full" disabled={!date} onClick={save}>
          Reprogramar
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function StatusBadges({ rows }: { rows: ScheduledReminderRow[] }) {
  if (!rows.length) return null;
  const counts = rows.reduce(
    (acc, r) => { acc[r.status] = (acc[r.status] ?? 0) + 1; return acc; },
    {} as Record<string, number>
  );
  const meta: Record<string, { label: string; cls: string }> = {
    pending: { label: 'agendado', cls: 'bg-blue-500/15 text-blue-600 border-blue-500/30' },
    sent: { label: 'enviado', cls: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' },
    failed: { label: 'falhou', cls: 'bg-destructive/15 text-destructive border-destructive/30' },
    cancelled: { label: 'cancelado', cls: 'bg-muted text-muted-foreground border-border' },
  };
  return (
    <div className="flex flex-wrap gap-1">
      {Object.entries(counts).map(([s, n]) => (
        <Badge key={s} variant="outline" className={`text-[10px] px-1.5 py-0 ${meta[s]?.cls ?? ''}`}>
          {meta[s]?.label ?? s} {n > 1 ? `×${n}` : ''}
        </Badge>
      ))}
    </div>
  );
}

export function TaskRemindersEditor({ taskId }: Props) {
  const { reminders, upsert, remove, toggle } = useTaskReminders(taskId);
  const { rows: scheduled } = useTaskScheduledReminders(taskId);
  const [customDate, setCustomDate] = useState<Date | undefined>();
  const [customTime, setCustomTime] = useState('09:00');

  const scheduledByReminder = scheduled.reduce((acc, row) => {
    if (!row.task_reminder_id) return acc;
    (acc[row.task_reminder_id] ||= []).push(row);
    return acc;
  }, {} as Record<string, ScheduledReminderRow[]>);

  const autoKinds: ReminderKind[] = ['due_d1', 'due_1h', 'due_now', 'start_now'];

  const addCustom = () => {
    if (!customDate) return;
    const [hh, mm] = customTime.split(':').map(Number);
    const dt = new Date(customDate);
    dt.setHours(hh, mm || 0, 0, 0);
    upsert.mutate({
      task_id: taskId,
      kind: 'custom',
      scheduled_at: dt.toISOString(),
      recipients: ['creator', 'assignee'],
      channels: ['in_app', 'browser'],
    });
    setCustomDate(undefined);
  };

  const updateChannels = (r: TaskReminder, channels: ReminderChannel[]) => {
    upsert.mutate({ ...r, channels } as any);
  };

  const updateRecipients = (r: TaskReminder, recipients: ReminderRecipient[]) => {
    upsert.mutate({ ...r, recipients } as any);
  };

  const reschedule = (r: TaskReminder, iso: string) => {
    upsert.mutate({ ...r, scheduled_at: iso } as any, {
      onSuccess: () => toast.success('Lembrete reprogramado'),
      onError: () => toast.error('Falha ao reprogramar'),
    });
  };

  const cancelAll = () => {
    const active = reminders.filter(r => r.enabled);
    if (!active.length) return;
    Promise.all(active.map(r => new Promise<void>((res) => {
      toggle.mutate({ id: r.id, enabled: false }, { onSuccess: () => res(), onError: () => res() });
    }))).then(() => toast.success('Lembretes cancelados'));
  };

  const customReminders = reminders.filter(r => r.kind === 'custom');
  const anyEnabled = reminders.some(r => r.enabled);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2 text-sm font-medium">
          <Bell className="h-4 w-4" /> Lembretes
        </Label>
        {anyEnabled && (
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={cancelAll}>
            <BellOff className="mr-1 h-3 w-3" /> Cancelar todos
          </Button>
        )}
      </div>

      {/* Auto reminders */}
      <div className="space-y-2 rounded-md border border-border p-3">
        <p className="text-xs text-muted-foreground">Automáticos (com base no prazo e início)</p>
        {autoKinds.map(k => {
          const r = reminders.find(x => x.kind === k);
          return (
            <div key={k} className="flex flex-col gap-1 border-b border-border/40 pb-2 last:border-0 last:pb-0">
              <div className="flex items-center justify-between">
                <span className="text-sm">{KIND_LABELS[k]}</span>
                <div className="flex items-center gap-1">
                  {r?.scheduled_at && (
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(r.scheduled_at), 'dd/MM HH:mm')}
                    </span>
                  )}
                  {r && r.enabled && (
                    <ReschedulePopover reminder={r} onSave={(iso) => reschedule(r, iso)} />
                  )}
                  <Switch
                    checked={r?.enabled ?? false}
                    disabled={!r}
                    onCheckedChange={(v) => r && toggle.mutate({ id: r.id, enabled: v })}
                  />
                </div>
              </div>
              {r && <StatusBadges rows={scheduledByReminder[r.id] ?? []} />}
            </div>
          );
        })}
      </div>

      {/* Custom reminders */}
      <div className="space-y-2">
        {customReminders.map(r => (
          <div key={r.id} className="rounded-md border border-border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {r.scheduled_at ? format(new Date(r.scheduled_at), 'dd/MM/yyyy HH:mm') : '—'}
                {!r.enabled && <span className="ml-2 text-xs text-muted-foreground">(cancelado)</span>}
              </span>
              <div className="flex items-center gap-1">
                <ReschedulePopover reminder={r} onSave={(iso) => reschedule(r, iso)} />
                <Switch
                  checked={r.enabled}
                  onCheckedChange={(v) => toggle.mutate({ id: r.id, enabled: v })}
                />
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove.mutate(r.id)}>
                  <X className="h-3 w-3" />
                </Button>
            </div>
            <StatusBadges rows={scheduledByReminder[r.id] ?? []} />
            <div className="flex flex-wrap gap-1">
              {CHANNEL_META.map(({ key, icon: Icon, label }) => {
                const active = r.channels.includes(key);
                return (
                  <Badge
                    key={key}
                    variant={active ? 'default' : 'outline'}
                    className="cursor-pointer text-xs"
                    onClick={() => updateChannels(r, active ? r.channels.filter(c => c !== key) : [...r.channels, key])}
                  >
                    <Icon className="mr-1 h-3 w-3" />{label}
                  </Badge>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-1">
              {(['creator', 'assignee', 'shared'] as ReminderRecipient[]).map(rc => {
                const active = r.recipients.includes(rc);
                return (
                  <Badge
                    key={rc}
                    variant={active ? 'secondary' : 'outline'}
                    className="cursor-pointer text-xs"
                    onClick={() => updateRecipients(r, active ? r.recipients.filter(x => x !== rc) : [...r.recipients, rc])}
                  >
                    {RECIPIENT_LABELS[rc]}
                  </Badge>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Add custom */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="w-full">
            <Plus className="mr-2 h-3 w-3" /> Adicionar lembrete personalizado
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3 space-y-2">
          <Calendar mode="single" selected={customDate} onSelect={setCustomDate} initialFocus />
          <div className="flex items-center gap-2">
            <Label className="text-xs">Hora</Label>
            <input
              type="time"
              value={customTime}
              onChange={(e) => setCustomTime(e.target.value)}
              className="flex h-8 w-28 rounded-md border border-input bg-background px-2 text-sm"
            />
          </div>
          <Button size="sm" className="w-full" disabled={!customDate} onClick={addCustom}>
            Criar lembrete
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
