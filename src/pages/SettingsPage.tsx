import { AppLayout } from '@/components/AppLayout';
import { useLanguage } from '@/i18n/LanguageContext';
import { useCalendarSettings } from '@/hooks/useCalendarSettings';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

export default function SettingsPage() {
  const { t, language, setLanguage } = useLanguage();
  const calendar = useCalendarSettings();

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
      </div>
    </AppLayout>
  );
}
