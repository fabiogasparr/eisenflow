-- Fix WhatsApp reminder errors:
-- 1) Replace DEFERRABLE unique constraint on task_reminders(task_id, kind) with a partial unique index
--    so ON CONFLICT works AND multiple custom reminders per task are allowed.
-- 2) Rewrite expand_task_reminder to avoid "DELETE requires a WHERE clause" by using an array of recipient ids
--    instead of a temp table truncated with DELETE.
-- 3) Rewrite sync_task_auto_reminders to use SELECT-then-UPDATE/INSERT instead of ON CONFLICT (the
--    new partial unique index covers only auto_generated rows, but we keep the code defensive).

-- 1) Drop deferrable unique and add partial unique index for auto-generated reminders only
ALTER TABLE public.task_reminders
  DROP CONSTRAINT IF EXISTS task_reminders_task_id_kind_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_reminders_auto_unique
  ON public.task_reminders(task_id, kind)
  WHERE auto_generated = true;

-- 2) expand_task_reminder: build recipient list as an array, no temp table, no naked DELETE
CREATE OR REPLACE FUNCTION public.expand_task_reminder(_reminder_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  t RECORD;
  recipient_ids uuid[] := ARRAY[]::uuid[];
  recipient_id uuid;
  ch public.reminder_channel;
  existing_id uuid;
BEGIN
  SELECT * INTO r FROM public.task_reminders WHERE id = _reminder_id;
  IF NOT FOUND OR NOT r.enabled OR r.scheduled_at IS NULL THEN
    UPDATE public.scheduled_reminders SET status = 'cancelled'
      WHERE task_reminder_id = _reminder_id AND status = 'pending';
    RETURN;
  END IF;

  SELECT * INTO t FROM public.tasks WHERE id = r.task_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF r.scheduled_at < now() - interval '10 minutes' THEN
    UPDATE public.scheduled_reminders SET status = 'cancelled'
      WHERE task_reminder_id = _reminder_id AND status = 'pending';
    RETURN;
  END IF;

  IF 'creator' = ANY(r.recipients) AND t.created_by IS NOT NULL THEN
    recipient_ids := array_append(recipient_ids, t.created_by);
  END IF;
  IF 'assignee' = ANY(r.recipients) AND t.assigned_to IS NOT NULL
     AND NOT (t.assigned_to = ANY(recipient_ids)) THEN
    recipient_ids := array_append(recipient_ids, t.assigned_to);
  END IF;
  IF 'shared' = ANY(r.recipients) THEN
    FOR recipient_id IN
      SELECT DISTINCT shared_with_user_id FROM public.task_shares
       WHERE task_id = t.id AND shared_with_user_id IS NOT NULL
    LOOP
      IF NOT (recipient_id = ANY(recipient_ids)) THEN
        recipient_ids := array_append(recipient_ids, recipient_id);
      END IF;
    END LOOP;
  END IF;

  -- Cancel any pending rows that no longer fit
  UPDATE public.scheduled_reminders SET status = 'cancelled'
    WHERE task_reminder_id = _reminder_id
      AND status = 'pending'
      AND (scheduled_at <> r.scheduled_at
           OR NOT (channel = ANY(r.channels))
           OR NOT (user_id = ANY(recipient_ids)));

  -- Upsert one row per (recipient, channel) using SELECT/UPDATE/INSERT (avoids ON CONFLICT pitfalls)
  IF array_length(recipient_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  FOREACH recipient_id IN ARRAY recipient_ids LOOP
    FOREACH ch IN ARRAY r.channels LOOP
      SELECT id INTO existing_id
        FROM public.scheduled_reminders
       WHERE task_reminder_id = r.id
         AND user_id = recipient_id
         AND channel = ch
       LIMIT 1;

      IF existing_id IS NOT NULL THEN
        UPDATE public.scheduled_reminders
           SET scheduled_at = r.scheduled_at,
               status = CASE WHEN status IN ('sent','failed') THEN status ELSE 'pending' END,
               payload = jsonb_build_object('task_title', t.title, 'due_date', t.due_date, 'started_at', t.started_at),
               updated_at = now()
         WHERE id = existing_id;
      ELSE
        INSERT INTO public.scheduled_reminders
          (task_reminder_id, task_id, user_id, tenant_id, kind, channel, scheduled_at, status, payload)
        VALUES
          (r.id, t.id, recipient_id, t.tenant_id, r.kind, ch, r.scheduled_at, 'pending',
           jsonb_build_object('task_title', t.title, 'due_date', t.due_date, 'started_at', t.started_at));
      END IF;
    END LOOP;
  END LOOP;
END;
$function$;

-- 3) sync_task_auto_reminders: use SELECT-then-UPDATE/INSERT instead of ON CONFLICT
CREATE OR REPLACE FUNCTION public.sync_task_auto_reminders(_task_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  t RECORD;
  prefs RECORD;
  k public.reminder_kind;
  sched timestamptz;
  rid uuid;
  auto_kinds public.reminder_kind[] := ARRAY['due_d1','due_1h','due_now','start_now']::public.reminder_kind[];
  pref_enabled boolean;
BEGIN
  SELECT * INTO t FROM public.tasks WHERE id = _task_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF t.status IN ('completed','eliminated') THEN
    UPDATE public.task_reminders SET enabled = false WHERE task_id = _task_id AND auto_generated;
    UPDATE public.scheduled_reminders SET status = 'cancelled'
      WHERE task_id = _task_id AND status = 'pending';
    RETURN;
  END IF;

  SELECT * INTO prefs FROM public.user_reminder_preferences WHERE user_id = t.created_by;

  FOREACH k IN ARRAY auto_kinds LOOP
    sched := public.compute_reminder_scheduled_at(k, t.due_date, t.started_at);

    pref_enabled := true;
    IF prefs.user_id IS NOT NULL THEN
      IF k = 'due_d1' AND NOT prefs.auto_due_d1 THEN pref_enabled := false;
      ELSIF k = 'due_1h' AND NOT prefs.auto_due_1h THEN pref_enabled := false;
      ELSIF k = 'due_now' AND NOT prefs.auto_due_now THEN pref_enabled := false;
      ELSIF k = 'start_now' AND NOT prefs.auto_start THEN pref_enabled := false;
      END IF;
    END IF;

    IF NOT pref_enabled OR sched IS NULL THEN
      DELETE FROM public.task_reminders
       WHERE task_id = _task_id AND kind = k AND auto_generated = true;
      CONTINUE;
    END IF;

    SELECT id INTO rid
      FROM public.task_reminders
     WHERE task_id = _task_id AND kind = k AND auto_generated = true
     LIMIT 1;

    IF rid IS NOT NULL THEN
      UPDATE public.task_reminders
         SET scheduled_at = sched,
             enabled = true,
             updated_at = now()
       WHERE id = rid;
    ELSE
      INSERT INTO public.task_reminders (task_id, created_by, kind, scheduled_at, recipients, channels, enabled, auto_generated)
      VALUES (
        t.id, t.created_by, k, sched,
        COALESCE(prefs.default_recipients, ARRAY['creator','assignee']::public.reminder_recipient[]),
        COALESCE(prefs.default_channels, ARRAY['in_app','browser']::public.reminder_channel[]),
        true, true
      )
      RETURNING id INTO rid;
    END IF;

    PERFORM public.expand_task_reminder(rid);
  END LOOP;
END;
$function$;