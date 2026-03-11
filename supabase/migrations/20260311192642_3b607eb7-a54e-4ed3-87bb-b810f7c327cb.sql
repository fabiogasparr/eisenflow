ALTER TABLE public.tasks ADD COLUMN started_at timestamptz DEFAULT NULL;
ALTER TABLE public.tasks ADD COLUMN completed_at timestamptz DEFAULT NULL;