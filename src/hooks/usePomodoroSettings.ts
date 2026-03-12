import { useState, useCallback } from 'react';

export interface PomodoroSettings {
  enabled: boolean;
  focusDuration: number;
  shortBreakDuration: number;
  longBreakDuration: number;
  longBreakInterval: number;
}

const STORAGE_KEY = 'eisenflow-pomodoro-settings';

const defaults: PomodoroSettings = {
  enabled: true,
  focusDuration: 25,
  shortBreakDuration: 5,
  longBreakDuration: 15,
  longBreakInterval: 4,
};

function load(): PomodoroSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {}
  return defaults;
}

export function usePomodoroSettings() {
  const [settings, setSettings] = useState<PomodoroSettings>(load);

  const update = useCallback((patch: Partial<PomodoroSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { ...settings, update };
}
