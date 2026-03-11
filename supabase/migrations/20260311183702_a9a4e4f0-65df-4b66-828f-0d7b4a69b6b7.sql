
-- Create notifications table
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL DEFAULT 'task_delegated',
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  metadata jsonb DEFAULT '{}'::jsonb,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users can view their own notifications
CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can update their own notifications (mark as read)
CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can delete their own notifications
CREATE POLICY "Users can delete own notifications"
  ON public.notifications FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Security definer function to insert notifications (bypasses RLS)
CREATE OR REPLACE FUNCTION public.notify_task_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _task_title text;
  _delegator_name text;
BEGIN
  -- Only fire when assigned_to changes to a non-null value different from before
  IF NEW.assigned_to IS NOT NULL AND (OLD.assigned_to IS NULL OR OLD.assigned_to != NEW.assigned_to) THEN
    _task_title := NEW.title;

    SELECT COALESCE(display_name, 'Alguém') INTO _delegator_name
    FROM public.profiles
    WHERE user_id = auth.uid()
    LIMIT 1;

    INSERT INTO public.notifications (user_id, type, title, body, metadata)
    VALUES (
      NEW.assigned_to,
      'task_delegated',
      _delegator_name || ' delegou uma tarefa',
      _task_title,
      jsonb_build_object('task_id', NEW.id, 'delegated_by', auth.uid())
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger on tasks table
CREATE TRIGGER on_task_assigned
  AFTER UPDATE OF assigned_to ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_task_assigned();

-- Also trigger on insert if assigned_to is set
CREATE TRIGGER on_task_assigned_insert
  AFTER INSERT ON public.tasks
  FOR EACH ROW
  WHEN (NEW.assigned_to IS NOT NULL)
  EXECUTE FUNCTION public.notify_task_assigned();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
