import { AppLayout } from '@/components/AppLayout';
import { useLanguage } from '@/i18n/LanguageContext';
import { useCalendarSettings } from '@/hooks/useCalendarSettings';
import { usePomodoroSettings } from '@/hooks/usePomodoroSettings';
import { useWhatsApp } from '@/hooks/useWhatsApp';
import { WhatsAppQRCode } from '@/components/WhatsAppQRCode';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

export default function SettingsPage() {
  const { t, language, setLanguage } = useLanguage();
  const calendar = useCalendarSettings();
  const pomo = usePomodoroSettings();
  const whatsapp = useWhatsApp();

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-2xl">
        <h1 className="font-display text-2xl font-bold">{t('settings')}</h1>

        {/* Language */}
        <Card>
          <CardHeader>
            <CardTitle className="font-display">{t('language')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label>{t('language')}</Label>
              <Select value={language} onValueChange={(v) => setLanguage(v as any)}>
                <SelectTrigger className="w-full sm:w-60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pt-BR">🇧🇷 Português (BR)</SelectItem>
                  <SelectItem value="en">🇺🇸 English</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* WhatsApp */}
        <Card>
          <CardHeader>
            <CardTitle className="font-display">📱 {t('whatsapp')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <WhatsAppQRCode />

            {whatsapp.connection?.status === 'connected' && (
              <div className="space-y-4 pt-2 border-t">
                <div className="flex items-center justify-between pt-4">
                  <Label htmlFor="wa-reminders">{t('whatsappReminders')}</Label>
                  <Switch
                    id="wa-reminders"
                    checked={whatsapp.connection.reminders_enabled}
                    onCheckedChange={(v) => whatsapp.updateSettings.mutate({ reminders_enabled: v })}
                  />
                </div>
                <div className="flex items-center justify-between max-w-xs">
                  <Label htmlFor="wa-report">{t('whatsappDailyReport')}</Label>
                  <Switch
                    id="wa-report"
                    checked={whatsapp.connection.daily_report_enabled}
                    onCheckedChange={(v) => whatsapp.updateSettings.mutate({ daily_report_enabled: v })}
                  />
                </div>
                <div className="flex items-center justify-between max-w-xs">
                  <Label htmlFor="wa-weekly-report">{t('whatsappWeeklyReport')}</Label>
                  <Switch
                    id="wa-weekly-report"
                    checked={whatsapp.connection.weekly_report_enabled}
                    onCheckedChange={(v) => whatsapp.updateSettings.mutate({ weekly_report_enabled: v })}
                  />
                </div>
                {whatsapp.connection.weekly_report_enabled && (
                  <div className="space-y-1.5 max-w-xs">
                    <Label className="text-xs">{t('whatsappWeeklyReportDay')}</Label>
                    <Select
                      value={String(whatsapp.connection.weekly_report_day ?? 1)}
                      onValueChange={(v) => whatsapp.updateSettings.mutate({ weekly_report_day: Number(v) })}
                    >
                      <SelectTrigger className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">{language === 'pt-BR' ? 'Domingo' : 'Sunday'}</SelectItem>
                        <SelectItem value="1">{language === 'pt-BR' ? 'Segunda-feira' : 'Monday'}</SelectItem>
                        <SelectItem value="2">{language === 'pt-BR' ? 'Terça-feira' : 'Tuesday'}</SelectItem>
                        <SelectItem value="3">{language === 'pt-BR' ? 'Quarta-feira' : 'Wednesday'}</SelectItem>
                        <SelectItem value="4">{language === 'pt-BR' ? 'Quinta-feira' : 'Thursday'}</SelectItem>
                        <SelectItem value="5">{language === 'pt-BR' ? 'Sexta-feira' : 'Friday'}</SelectItem>
                        <SelectItem value="6">{language === 'pt-BR' ? 'Sábado' : 'Saturday'}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {(whatsapp.connection.daily_report_enabled || whatsapp.connection.weekly_report_enabled) && (
                  <div className="space-y-1.5 max-w-xs">
                    <Label className="text-xs">{t('whatsappReportTime')}</Label>
                    <Input
                      type="time"
                      value={whatsapp.connection.report_time || '08:00'}
                      onChange={(e) => whatsapp.updateSettings.mutate({ report_time: e.target.value })}
                    />
                  </div>
                )}
                <div className="flex items-center justify-between max-w-xs">
                  <Label>{t('whatsappAcceptFrom')}</Label>
                  <Select
                    value={whatsapp.connection.accept_messages_from || 'self_only'}
                    onValueChange={(v) => whatsapp.updateSettings.mutate({ accept_messages_from: v as 'self_only' | 'all' })}
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="self_only">{t('whatsappSelfOnly')}</SelectItem>
                      <SelectItem value="all">{t('whatsappAll')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="pt-2">
                  <p className="text-xs font-medium text-muted-foreground mb-2">{t('whatsappCommands')}:</p>
                  <div className="text-xs text-muted-foreground space-y-1 font-mono bg-muted/50 rounded-md p-3">
                    <p>/nova [título] — {language === 'pt-BR' ? 'Criar tarefa' : 'Create task'}</p>
                    <p>/listar — {language === 'pt-BR' ? 'Listar tarefas' : 'List tasks'}</p>
                    <p>/concluir [nº] — {language === 'pt-BR' ? 'Concluir tarefa' : 'Complete task'}</p>
                    <p>/andamento [nº] — {language === 'pt-BR' ? 'Em andamento' : 'In progress'}</p>
                    <p>/urgente [nº] — {language === 'pt-BR' ? 'Mover para "Fazer Agora"' : 'Move to "Do Now"'}</p>
                    <p>/ajuda — {language === 'pt-BR' ? 'Ver comandos' : 'Show commands'}</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Calendar */}
        <Card>
          <CardHeader>
            <CardTitle className="font-display">{t('calendarSettings')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>{t('viewMode')}</Label>
              <Select value={calendar.viewMode} onValueChange={(v) => calendar.update({ viewMode: v as any })}>
                <SelectTrigger className="w-60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">{t('weekly')}</SelectItem>
                  <SelectItem value="monthly">{t('monthly')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between max-w-xs">
              <Label htmlFor="show-weekends">{t('showWeekends')}</Label>
              <Switch
                id="show-weekends"
                checked={calendar.showWeekends}
                onCheckedChange={(v) => calendar.update({ showWeekends: v })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Pomodoro */}
        <Card>
          <CardHeader>
            <CardTitle className="font-display">🍅 Pomodoro</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between max-w-xs">
              <Label htmlFor="pomo-enabled">
                {language === 'pt-BR' ? 'Ativar Pomodoro' : 'Enable Pomodoro'}
              </Label>
              <Switch
                id="pomo-enabled"
                checked={pomo.enabled}
                onCheckedChange={(v) => pomo.update({ enabled: v })}
              />
            </div>

            {pomo.enabled && (
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-4 max-w-xs">
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      {language === 'pt-BR' ? 'Foco (min)' : 'Focus (min)'}
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      max={120}
                      value={pomo.focusDuration}
                      onChange={(e) => pomo.update({ focusDuration: Number(e.target.value) || 25 })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      {language === 'pt-BR' ? 'Pausa curta (min)' : 'Short break (min)'}
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      max={30}
                      value={pomo.shortBreakDuration}
                      onChange={(e) => pomo.update({ shortBreakDuration: Number(e.target.value) || 5 })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      {language === 'pt-BR' ? 'Pausa longa (min)' : 'Long break (min)'}
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      max={60}
                      value={pomo.longBreakDuration}
                      onChange={(e) => pomo.update({ longBreakDuration: Number(e.target.value) || 15 })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      {language === 'pt-BR' ? 'Ciclos p/ pausa longa' : 'Cycles for long break'}
                    </Label>
                    <Input
                      type="number"
                      min={2}
                      max={10}
                      value={pomo.longBreakInterval}
                      onChange={(e) => pomo.update({ longBreakInterval: Number(e.target.value) || 4 })}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {language === 'pt-BR'
                    ? `Ciclo: ${pomo.focusDuration}min foco → ${pomo.shortBreakDuration}min pausa → repete ${pomo.longBreakInterval}x → ${pomo.longBreakDuration}min pausa longa`
                    : `Cycle: ${pomo.focusDuration}min focus → ${pomo.shortBreakDuration}min break → repeat ${pomo.longBreakInterval}x → ${pomo.longBreakDuration}min long break`}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
