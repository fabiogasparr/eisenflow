
CREATE TABLE public.whatsapp_sent_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  reminder_type text NOT NULL,
  sent_at timestamptz DEFAULT now(),
  UNIQUE(user_id, task_id, reminder_type)
);

ALTER TABLE public.whatsapp_sent_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.whatsapp_sent_reminders
  FOR ALL TO service_role USING (true) WITH CHECK (true);
