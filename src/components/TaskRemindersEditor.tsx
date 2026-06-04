import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Bell, Plus, X, Smartphone, MessageCircle, Mail, Monitor, Building2 } from 'lucide-react';
import {
  useTaskReminders,
  type ReminderChannel,
  type ReminderRecipient,
  type ReminderKind,
} from '@/hooks/useTaskReminders';
import { format } from 'date-fns';

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

export function TaskRemindersEditor({ taskId }: Props) {
  const { reminders, upsert, remove, toggle } = useTaskReminders(taskId);
  const [customDate, setCustomDate] = useState<Date | undefined>();
  const [customTime, setCustomTime] = useState('09:00');

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

  const updateChannels = (id: string, channels: ReminderChannel[]) => {
    const r = reminders.find(x => x.id === id);
    if (!r) return;
    upsert.mutate({ ...r, channels } as any);
  };

  const updateRecipients = (id: string, recipients: ReminderRecipient[]) => {
    const r = reminders.find(x => x.id === id);
    if (!r) return;
    upsert.mutate({ ...r, recipients } as any);
  };

  return (
    <div className="space-y-3">
      <Label className="flex items-center gap-2 text-sm font-medium">
        <Bell className="h-4 w-4" /> Lembretes
      </Label>

      {/* Auto reminders */}
      <div className="space-y-2 rounded-md border border-border p-3">
        <p className="text-xs text-muted-foreground">Automáticos (com base no prazo e início)</p>
        {autoKinds.map(k => {
          const r = reminders.find(x => x.kind === k);
          return (
            <div key={k} className="flex items-center justify-between">
              <span className="text-sm">{KIND_LABELS[k]}</span>
              <div className="flex items-center gap-2">
                {r?.scheduled_at && (
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(r.scheduled_at), 'dd/MM HH:mm')}
                  </span>
                )}
                <Switch
                  checked={r?.enabled ?? false}
                  disabled={!r}
                  onCheckedChange={(v) => r && toggle.mutate({ id: r.id, enabled: v })}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Custom reminders */}
      <div className="space-y-2">
        {reminders.filter(r => r.kind === 'custom').map(r => (
          <div key={r.id} className="rounded-md border border-border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {r.scheduled_at ? format(new Date(r.scheduled_at), 'dd/MM/yyyy HH:mm') : '—'}
              </span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove.mutate(r.id)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-1">
              {CHANNEL_META.map(({ key, icon: Icon, label }) => {
                const active = r.channels.includes(key);
                return (
                  <Badge
                    key={key}
                    variant={active ? 'default' : 'outline'}
                    className="cursor-pointer text-xs"
                    onClick={() => updateChannels(r.id, active ? r.channels.filter(c => c !== key) : [...r.channels, key])}
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
                    onClick={() => updateRecipients(r.id, active ? r.recipients.filter(x => x !== rc) : [...r.recipients, rc])}
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
