import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Bell, Smartphone, Monitor, Building2, Mail, Calendar as CalIcon } from 'lucide-react';
import {
  useReminderPreferences,
  useRecurringSchedules,
  type ReminderChannel,
} from '@/hooks/useTaskReminders';

const CHANNEL_META: { key: ReminderChannel; icon: any; label: string }[] = [
  { key: 'in_app', icon: Bell, label: 'No app' },
  { key: 'browser', icon: Monitor, label: 'Navegador' },
  { key: 'whatsapp_personal', icon: Smartphone, label: 'WhatsApp pessoal' },
  { key: 'whatsapp_tenant', icon: Building2, label: 'WhatsApp do workspace' },
  { key: 'email', icon: Mail, label: 'E-mail' },
];

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function RemindersSettingsPanel() {
  const { prefs, save } = useReminderPreferences();
  const { schedules, upsert, remove } = useRecurringSchedules();

  const [newKind, setNewKind] = useState<'daily_summary' | 'weekly_plan'>('daily_summary');
  const [newTime, setNewTime] = useState('08:00');
  const [newWeekday, setNewWeekday] = useState(1);

  const channels = prefs?.default_channels ?? ['in_app', 'browser'];
  const toggleChannel = (c: ReminderChannel) => {
    const next = channels.includes(c) ? channels.filter(x => x !== c) : [...channels, c];
    save.mutate({ default_channels: next });
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <Bell className="h-5 w-5" /> Lembretes padrão
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm">Lembretes automáticos</Label>
            <div className="grid grid-cols-2 gap-2">
              {([
                ['auto_due_d1', 'D-1 (1 dia antes)'],
                ['auto_due_1h', '1 hora antes'],
                ['auto_due_now', 'No vencimento'],
                ['auto_start', 'No início agendado'],
              ] as const).map(([k, label]) => (
                <div key={k} className="flex items-center justify-between rounded-md border border-border p-2">
                  <span className="text-sm">{label}</span>
                  <Switch
                    checked={(prefs as any)?.[k] ?? true}
                    onCheckedChange={(v) => save.mutate({ [k]: v } as any)}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Canais padrão</Label>
            <div className="flex flex-wrap gap-1">
              {CHANNEL_META.map(({ key, icon: Icon, label }) => {
                const active = channels.includes(key);
                return (
                  <Badge
                    key={key}
                    variant={active ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => toggleChannel(key)}
                  >
                    <Icon className="mr-1 h-3 w-3" />{label}
                  </Badge>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <CalIcon className="h-5 w-5" /> Agendamentos recorrentes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {schedules.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum agendamento ainda.</p>
          )}
          {schedules.map(s => (
            <div key={s.id} className="flex items-center justify-between rounded-md border border-border p-3">
              <div className="flex flex-col">
                <span className="text-sm font-medium">
                  {s.kind === 'daily_summary' ? 'Resumo diário' : s.kind === 'weekly_plan' ? 'Plano da semana' : 'Personalizado'}
                </span>
                <span className="text-xs text-muted-foreground">
                  {s.kind === 'weekly_plan' && s.weekday !== null ? `${WEEKDAYS[s.weekday]} • ` : ''}{s.cron_local}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={s.enabled} onCheckedChange={(v) => upsert.mutate({ id: s.id, enabled: v })} />
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove.mutate(s.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-end pt-2 border-t">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Tipo</Label>
              <Select value={newKind} onValueChange={(v: any) => setNewKind(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily_summary">Resumo diário</SelectItem>
                  <SelectItem value="weekly_plan">Plano da semana</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {newKind === 'weekly_plan' && (
              <div className="w-32 space-y-1">
                <Label className="text-xs">Dia</Label>
                <Select value={String(newWeekday)} onValueChange={(v) => setNewWeekday(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.map((w, i) => <SelectItem key={i} value={String(i)}>{w}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="w-32 space-y-1">
              <Label className="text-xs">Hora</Label>
              <Input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
            </div>
            <Button
              size="sm"
              onClick={() => upsert.mutate({
                kind: newKind,
                cron_local: newTime,
                weekday: newKind === 'weekly_plan' ? newWeekday : null,
                channels: channels,
                enabled: true,
              })}
            >
              <Plus className="mr-1 h-3 w-3" /> Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
