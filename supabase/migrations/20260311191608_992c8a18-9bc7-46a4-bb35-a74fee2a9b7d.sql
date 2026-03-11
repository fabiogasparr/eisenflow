
CREATE OR REPLACE FUNCTION public.notify_task_status_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _task_title text;
  _changer_name text;
  _notify_user_id uuid;
  _status_label text;
BEGIN
  -- Only fire when status actually changes
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Only notify if the task is assigned (delegated)
    -- Notify the OTHER party: if assignee changes status, notify creator; if creator changes, notify assignee
    IF NEW.assigned_to IS NOT NULL AND NEW.assigned_to != NEW.created_by THEN
      _task_title := NEW.title;

      -- Determine who made the change and who to notify
      -- We use auth.uid() to know who triggered the update
      IF auth.uid() = NEW.assigned_to THEN
        _notify_user_id := NEW.created_by;
      ELSIF auth.uid() = NEW.created_by THEN
        _notify_user_id := NEW.assigned_to;
      ELSE
        RETURN NEW;
      END IF;

      SELECT COALESCE(display_name, 'Alguém') INTO _changer_name
      FROM public.profiles
      WHERE user_id = auth.uid()
      LIMIT 1;

      -- Map status to readable label
      CASE NEW.status
        WHEN 'completed' THEN _status_label := 'concluída';
        WHEN 'in_progress' THEN _status_label := 'em andamento';
        WHEN 'pending' THEN _status_label := 'pendente';
        WHEN 'eliminated' THEN _status_label := 'eliminada';
        ELSE _status_label := NEW.status::text;
      END CASE;

      INSERT INTO public.notifications (user_id, type, title, body, metadata)
      VALUES (
        _notify_user_id,
        'task_status_changed',
        _changer_name || ' atualizou uma tarefa',
        _task_title || ' → ' || _status_label,
        jsonb_build_object('task_id', NEW.id, 'changed_by', auth.uid(), 'old_status', OLD.status, 'new_status', NEW.status)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_task_status_changed
  AFTER UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_task_status_changed();
