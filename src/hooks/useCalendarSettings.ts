import { useState, useCallback } from 'react';

export type CalendarViewMode = 'weekly' | 'monthly';

interface CalendarSettings {
  viewMode: CalendarViewMode;
  showWeekends: boolean;
}

const STORAGE_KEY = 'eisenflow-calendar-settings';

const defaults: CalendarSettings = {
  viewMode: 'weekly',
  showWeekends: true,
};

function load(): CalendarSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {}
  return defaults;
}

export function useCalendarSettings() {
  const [settings, setSettings] = useState<CalendarSettings>(load);

  const update = useCallback((patch: Partial<CalendarSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { ...settings, update };
}
