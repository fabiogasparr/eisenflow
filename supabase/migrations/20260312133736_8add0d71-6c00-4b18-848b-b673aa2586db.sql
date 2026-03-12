
ALTER TABLE public.gamification ADD COLUMN IF NOT EXISTS total_pomodoros integer NOT NULL DEFAULT 0;

ALTER TABLE public.productivity_metrics ADD COLUMN IF NOT EXISTS pomodoros_completed integer NOT NULL DEFAULT 0;
