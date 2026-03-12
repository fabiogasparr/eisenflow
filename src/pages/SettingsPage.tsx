import { AppLayout } from '@/components/AppLayout';
import { useLanguage } from '@/i18n/LanguageContext';
import { useCalendarSettings } from '@/hooks/useCalendarSettings';
import { usePomodoroSettings } from '@/hooks/usePomodoroSettings';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

export default function SettingsPage() {
  const { t, language, setLanguage } = useLanguage();
  const calendar = useCalendarSettings();
  const pomo = usePomodoroSettings();

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-2xl">
        <h1 className="font-display text-2xl font-bold">{t('settings')}</h1>

        <Card>
          <CardHeader>
            <CardTitle className="font-display">{t('language')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label>{t('language')}</Label>
              <Select value={language} onValueChange={(v) => setLanguage(v as any)}>
                <SelectTrigger className="w-60">
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
