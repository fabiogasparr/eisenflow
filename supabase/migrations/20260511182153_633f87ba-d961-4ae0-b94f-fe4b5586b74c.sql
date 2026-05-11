
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TYPE public.reclassification_status AS ENUM ('pending','accepted','rejected','expired');

CREATE TABLE public.task_reclassification_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  user_id uuid NOT NULL,
  current_quadrant task_quadrant NOT NULL,
  suggested_quadrant task_quadrant NOT NULL,
  current_importance integer NOT NULL,
  suggested_importance integer NOT NULL,
  current_urgency integer NOT NULL,
  applied_urgency integer NOT NULL,
  reason text,
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.reclassification_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX idx_reclass_user_status ON public.task_reclassification_suggestions(user_id, status);
CREATE INDEX idx_reclass_task ON public.task_reclassification_suggestions(task_id);

ALTER TABLE public.task_reclassification_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own suggestions"
ON public.task_reclassification_suggestions FOR SELECT
TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users update own suggestions"
ON public.task_reclassification_suggestions FOR UPDATE
TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users delete own suggestions"
ON public.task_reclassification_suggestions FOR DELETE
TO authenticated USING (auth.uid() = user_id);
