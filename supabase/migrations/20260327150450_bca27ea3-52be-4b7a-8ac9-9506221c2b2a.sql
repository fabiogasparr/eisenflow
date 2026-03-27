
-- Table to track focus sessions per task
CREATE TABLE public.task_focus_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  duration_seconds integer NOT NULL DEFAULT 0,
  phase text NOT NULL DEFAULT 'focus',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.task_focus_sessions ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can insert their own focus sessions"
  ON public.task_focus_sessions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own focus sessions"
  ON public.task_focus_sessions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own focus sessions"
  ON public.task_focus_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX idx_focus_sessions_task_id ON public.task_focus_sessions(task_id);
CREATE INDEX idx_focus_sessions_user_id ON public.task_focus_sessions(user_id);
