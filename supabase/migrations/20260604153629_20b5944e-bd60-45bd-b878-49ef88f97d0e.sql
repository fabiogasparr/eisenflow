
-- ========== ENUMS ==========
DO $$ BEGIN
  CREATE TYPE public.reminder_kind AS ENUM ('due_d1','due_1h','due_now','start_now','start_5min','custom','daily_summary','weekly_plan');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.reminder_channel AS ENUM ('in_app','browser','whatsapp_personal','whatsapp_tenant','email');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.reminder_recipient AS ENUM ('creator','assignee','shared');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.scheduled_reminder_status AS ENUM ('pending','sent','failed','skipped','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ========== user_reminder_preferences ==========
CREATE TABLE IF NOT EXISTS public.user_reminder_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  auto_due_d1 boolean NOT NULL DEFAULT true,
  auto_due_1h boolean NOT NULL DEFAULT true,
  auto_due_now boolean NOT NULL DEFAULT true,
  auto_start boolean NOT NULL DEFAULT true,
  default_channels public.reminder_channel[] NOT NULL DEFAULT ARRAY['in_app','browser']::public.reminder_channel[],
  default_recipients public.reminder_recipient[] NOT NULL DEFAULT ARRAY['creator','assignee']::public.reminder_recipient[],
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_reminder_preferences TO authenticated;
GRANT ALL ON public.user_reminder_preferences TO service_role;
ALTER TABLE public.user_reminder_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own prefs select" ON public.user_reminder_preferences FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own prefs insert" ON public.user_reminder_preferences FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own prefs update" ON public.user_reminder_preferences FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own prefs delete" ON public.user_reminder_preferences FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER trg_user_reminder_prefs_updated BEFORE UPDATE ON public.user_reminder_preferences FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== task_reminders ==========
CREATE TABLE IF NOT EXISTS public.task_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  created_by uuid NOT NULL,
  kind public.reminder_kind NOT NULL,
  scheduled_at timestamptz,
  recipients public.reminder_recipient[] NOT NULL DEFAULT ARRAY['creator','assignee']::public.reminder_recipient[],
  channels public.reminder_channel[] NOT NULL DEFAULT ARRAY['in_app']::public.reminder_channel[],
  enabled boolean NOT NULL DEFAULT true,
  auto_generated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, kind) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IF NOT EXISTS idx_task_reminders_task ON public.task_reminders(task_id);
CREATE INDEX IF NOT EXISTS idx_task_reminders_sched ON public.task_reminders(scheduled_at) WHERE enabled;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_reminders TO authenticated;
GRANT ALL ON public.task_reminders TO service_role;
ALTER TABLE public.task_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task reminders select" ON public.task_reminders FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_reminders.task_id
    AND (t.created_by = auth.uid() OR t.assigned_to = auth.uid()
         OR (t.tenant_id IS NOT NULL AND public.is_tenant_member(auth.uid(), t.tenant_id))
         OR (t.project_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = t.project_id AND p.team_id IS NOT NULL AND public.is_team_member(auth.uid(), p.team_id)))
         OR public.is_task_shared_with(auth.uid(), t.id)
         OR public.is_super_admin()))
);
CREATE POLICY "task reminders insert" ON public.task_reminders FOR INSERT TO authenticated WITH CHECK (
  created_by = auth.uid() AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_reminders.task_id
    AND (t.created_by = auth.uid() OR t.assigned_to = auth.uid()))
);
CREATE POLICY "task reminders update" ON public.task_reminders FOR UPDATE TO authenticated USING (
  created_by = auth.uid() OR EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_reminders.task_id
    AND (t.created_by = auth.uid() OR t.assigned_to = auth.uid()))
);
CREATE POLICY "task reminders delete" ON public.task_reminders FOR DELETE TO authenticated USING (
  created_by = auth.uid() OR EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_reminders.task_id AND t.created_by = auth.uid())
);
CREATE TRIGGER trg_task_reminders_updated BEFORE UPDATE ON public.task_reminders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== scheduled_reminders (queue) ==========
CREATE TABLE IF NOT EXISTS public.scheduled_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_reminder_id uuid,
  recurring_schedule_id uuid,
  task_id uuid,
  user_id uuid NOT NULL,
  tenant_id uuid,
  kind public.reminder_kind NOT NULL,
  channel public.reminder_channel NOT NULL,
  scheduled_at timestamptz NOT NULL,
  status public.scheduled_reminder_status NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sched_unique_task ON public.scheduled_reminders(task_reminder_id, user_id, channel) WHERE task_reminder_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sched_pending ON public.scheduled_reminders(scheduled_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_sched_user ON public.scheduled_reminders(user_id);
GRANT SELECT ON public.scheduled_reminders TO authenticated;
GRANT ALL ON public.scheduled_reminders TO service_role;
ALTER TABLE public.scheduled_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own scheduled select" ON public.scheduled_reminders FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER trg_sched_reminders_updated BEFORE UPDATE ON public.scheduled_reminders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== recurring_schedules ==========
CREATE TABLE IF NOT EXISTS public.recurring_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id uuid,
  kind public.reminder_kind NOT NULL,
  cron_local text NOT NULL DEFAULT '08:00',
  weekday integer,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  channels public.reminder_channel[] NOT NULL DEFAULT ARRAY['in_app']::public.reminder_channel[],
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_schedules TO authenticated;
GRANT ALL ON public.recurring_schedules TO service_role;
ALTER TABLE public.recurring_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own recurring select" ON public.recurring_schedules FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own recurring insert" ON public.recurring_schedules FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own recurring update" ON public.recurring_schedules FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own recurring delete" ON public.recurring_schedules FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER trg_recurring_updated BEFORE UPDATE ON public.recurring_schedules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== tenant_whatsapp_connections ==========
CREATE TABLE IF NOT EXISTS public.tenant_whatsapp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE,
  instance_name text NOT NULL,
  phone_number text,
  status text NOT NULL DEFAULT 'disconnected',
  qr_code text,
  default_sender boolean NOT NULL DEFAULT true,
  reminders_enabled boolean NOT NULL DEFAULT true,
  daily_report_enabled boolean NOT NULL DEFAULT false,
  weekly_report_enabled boolean NOT NULL DEFAULT false,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_whatsapp_connections TO authenticated;
GRANT ALL ON public.tenant_whatsapp_connections TO service_role;
ALTER TABLE public.tenant_whatsapp_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant wa select" ON public.tenant_whatsapp_connections FOR SELECT TO authenticated USING (public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY "tenant wa admin insert" ON public.tenant_whatsapp_connections FOR INSERT TO authenticated WITH CHECK (public.get_tenant_role(auth.uid(), tenant_id) IN ('owner','admin'));
CREATE POLICY "tenant wa admin update" ON public.tenant_whatsapp_connections FOR UPDATE TO authenticated USING (public.get_tenant_role(auth.uid(), tenant_id) IN ('owner','admin'));
CREATE POLICY "tenant wa admin delete" ON public.tenant_whatsapp_connections FOR DELETE TO authenticated USING (public.get_tenant_role(auth.uid(), tenant_id) IN ('owner','admin'));
CREATE TRIGGER trg_tenant_wa_updated BEFORE UPDATE ON public.tenant_whatsapp_connections FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== tenant_member_phones ==========
CREATE TABLE IF NOT EXISTS public.tenant_member_phones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  phone_number text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  verification_code text,
  verification_expires_at timestamptz,
  receive_reminders boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_member_phones TO authenticated;
GRANT ALL ON public.tenant_member_phones TO service_role;
ALTER TABLE public.tenant_member_phones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tmp select" ON public.tenant_member_phones FOR SELECT TO authenticated USING (
  auth.uid() = user_id OR public.get_tenant_role(auth.uid(), tenant_id) IN ('owner','admin')
);
CREATE POLICY "tmp insert" ON public.tenant_member_phones FOR INSERT TO authenticated WITH CHECK (
  (auth.uid() = user_id AND public.is_tenant_member(auth.uid(), tenant_id))
  OR public.get_tenant_role(auth.uid(), tenant_id) IN ('owner','admin')
);
CREATE POLICY "tmp update" ON public.tenant_member_phones FOR UPDATE TO authenticated USING (
  auth.uid() = user_id OR public.get_tenant_role(auth.uid(), tenant_id) IN ('owner','admin')
);
CREATE POLICY "tmp delete" ON public.tenant_member_phones FOR DELETE TO authenticated USING (
  auth.uid() = user_id OR public.get_tenant_role(auth.uid(), tenant_id) IN ('owner','admin')
);
CREATE TRIGGER trg_tmp_updated BEFORE UPDATE ON public.tenant_member_phones FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========== expand / sync functions ==========

-- Compute scheduled_at for auto kinds from a task
CREATE OR REPLACE FUNCTION public.compute_reminder_scheduled_at(_kind public.reminder_kind, _due timestamptz, _start timestamptz)
RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _kind
    WHEN 'due_d1' THEN _due - interval '1 day'
    WHEN 'due_1h' THEN _due - interval '1 hour'
    WHEN 'due_now' THEN _due
    WHEN 'start_now' THEN _start
    WHEN 'start_5min' THEN _start - interval '5 minutes'
    ELSE NULL
  END
$$;

-- Expand a task_reminder into scheduled_reminders (idempotent upsert)
CREATE OR REPLACE FUNCTION public.expand_task_reminder(_reminder_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
  t RECORD;
  recipient_id uuid;
  ch public.reminder_channel;
BEGIN
  SELECT * INTO r FROM public.task_reminders WHERE id = _reminder_id;
  IF NOT FOUND OR NOT r.enabled OR r.scheduled_at IS NULL THEN
    -- Cancel any pending rows for this reminder
    UPDATE public.scheduled_reminders SET status = 'cancelled'
      WHERE task_reminder_id = _reminder_id AND status = 'pending';
    RETURN;
  END IF;

  SELECT * INTO t FROM public.tasks WHERE id = r.task_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- If scheduled_at in past beyond 10min, cancel
  IF r.scheduled_at < now() - interval '10 minutes' THEN
    UPDATE public.scheduled_reminders SET status = 'cancelled'
      WHERE task_reminder_id = _reminder_id AND status = 'pending';
    RETURN;
  END IF;

  -- Collect recipients
  CREATE TEMP TABLE IF NOT EXISTS _recipients(user_id uuid PRIMARY KEY) ON COMMIT DROP;
  DELETE FROM _recipients;
  IF 'creator' = ANY(r.recipients) AND t.created_by IS NOT NULL THEN
    INSERT INTO _recipients VALUES (t.created_by) ON CONFLICT DO NOTHING;
  END IF;
  IF 'assignee' = ANY(r.recipients) AND t.assigned_to IS NOT NULL THEN
    INSERT INTO _recipients VALUES (t.assigned_to) ON CONFLICT DO NOTHING;
  END IF;
  IF 'shared' = ANY(r.recipients) THEN
    INSERT INTO _recipients SELECT shared_with_user_id FROM public.task_shares WHERE task_id = t.id AND shared_with_user_id IS NOT NULL
    ON CONFLICT DO NOTHING;
  END IF;

  -- Cancel any pending rows that no longer fit (different schedule/channel/recipient)
  UPDATE public.scheduled_reminders SET status = 'cancelled'
    WHERE task_reminder_id = _reminder_id AND status = 'pending'
      AND (scheduled_at <> r.scheduled_at
           OR NOT (channel = ANY(r.channels))
           OR user_id NOT IN (SELECT user_id FROM _recipients));

  -- Upsert
  FOR recipient_id IN SELECT user_id FROM _recipients LOOP
    FOREACH ch IN ARRAY r.channels LOOP
      INSERT INTO public.scheduled_reminders
        (task_reminder_id, task_id, user_id, tenant_id, kind, channel, scheduled_at, status, payload)
      VALUES
        (r.id, t.id, recipient_id, t.tenant_id, r.kind, ch, r.scheduled_at, 'pending',
         jsonb_build_object('task_title', t.title, 'due_date', t.due_date, 'started_at', t.started_at))
      ON CONFLICT (task_reminder_id, user_id, channel) DO UPDATE
        SET scheduled_at = EXCLUDED.scheduled_at,
            status = CASE WHEN public.scheduled_reminders.status IN ('sent','failed') THEN public.scheduled_reminders.status ELSE 'pending' END,
            payload = EXCLUDED.payload,
            updated_at = now();
    END LOOP;
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.expand_task_reminder(uuid) FROM anon, authenticated, PUBLIC;

-- Sync auto reminders for a task (called from trigger)
CREATE OR REPLACE FUNCTION public.sync_task_auto_reminders(_task_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t RECORD;
  prefs RECORD;
  k public.reminder_kind;
  sched timestamptz;
  rid uuid;
  auto_kinds public.reminder_kind[] := ARRAY['due_d1','due_1h','due_now','start_now']::public.reminder_kind[];
BEGIN
  SELECT * INTO t FROM public.tasks WHERE id = _task_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Skip terminal statuses: cancel pending
  IF t.status IN ('completed','eliminated') THEN
    UPDATE public.task_reminders SET enabled = false WHERE task_id = _task_id AND auto_generated;
    UPDATE public.scheduled_reminders SET status = 'cancelled'
      WHERE task_id = _task_id AND status = 'pending';
    RETURN;
  END IF;

  -- Load creator prefs (or defaults)
  SELECT * INTO prefs FROM public.user_reminder_preferences WHERE user_id = t.created_by;

  FOREACH k IN ARRAY auto_kinds LOOP
    sched := public.compute_reminder_scheduled_at(k, t.due_date, t.started_at);

    -- Check pref toggle
    IF prefs.user_id IS NOT NULL THEN
      IF (k IN ('due_d1') AND NOT prefs.auto_due_d1)
         OR (k = 'due_1h' AND NOT prefs.auto_due_1h)
         OR (k = 'due_now' AND NOT prefs.auto_due_now)
         OR (k = 'start_now' AND NOT prefs.auto_start)
      THEN
        DELETE FROM public.task_reminders WHERE task_id = _task_id AND kind = k AND auto_generated;
        CONTINUE;
      END IF;
    END IF;

    IF sched IS NULL THEN
      DELETE FROM public.task_reminders WHERE task_id = _task_id AND kind = k AND auto_generated;
      CONTINUE;
    END IF;

    INSERT INTO public.task_reminders (task_id, created_by, kind, scheduled_at, recipients, channels, enabled, auto_generated)
    VALUES (
      t.id, t.created_by, k, sched,
      COALESCE(prefs.default_recipients, ARRAY['creator','assignee']::public.reminder_recipient[]),
      COALESCE(prefs.default_channels, ARRAY['in_app','browser']::public.reminder_channel[]),
      true, true
    )
    ON CONFLICT (task_id, kind) DO UPDATE
      SET scheduled_at = EXCLUDED.scheduled_at,
          enabled = true,
          updated_at = now()
    RETURNING id INTO rid;

    PERFORM public.expand_task_reminder(rid);
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sync_task_auto_reminders(uuid) FROM anon, authenticated, PUBLIC;

-- Trigger on tasks
CREATE OR REPLACE FUNCTION public.tasks_reminders_sync_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.sync_task_auto_reminders(NEW.id);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.due_date IS DISTINCT FROM OLD.due_date
       OR NEW.started_at IS DISTINCT FROM OLD.started_at
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
      PERFORM public.sync_task_auto_reminders(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tasks_reminders_sync_trg() FROM anon, authenticated, PUBLIC;

DROP TRIGGER IF EXISTS trg_tasks_reminders_sync ON public.tasks;
CREATE TRIGGER trg_tasks_reminders_sync
AFTER INSERT OR UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.tasks_reminders_sync_trg();

-- Trigger on task_reminders (re-expand on change)
CREATE OR REPLACE FUNCTION public.task_reminders_expand_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.scheduled_reminders SET status = 'cancelled'
      WHERE task_reminder_id = OLD.id AND status = 'pending';
    RETURN OLD;
  END IF;
  PERFORM public.expand_task_reminder(NEW.id);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.task_reminders_expand_trg() FROM anon, authenticated, PUBLIC;

DROP TRIGGER IF EXISTS trg_task_reminders_expand ON public.task_reminders;
CREATE TRIGGER trg_task_reminders_expand
AFTER INSERT OR UPDATE OR DELETE ON public.task_reminders
FOR EACH ROW EXECUTE FUNCTION public.task_reminders_expand_trg();

-- Trigger on task_shares (re-expand reminders that include 'shared')
CREATE OR REPLACE FUNCTION public.task_shares_reexpand_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid; _task uuid;
BEGIN
  _task := COALESCE(NEW.task_id, OLD.task_id);
  FOR rid IN SELECT id FROM public.task_reminders WHERE task_id = _task AND 'shared' = ANY(recipients) LOOP
    PERFORM public.expand_task_reminder(rid);
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.task_shares_reexpand_trg() FROM anon, authenticated, PUBLIC;

DROP TRIGGER IF EXISTS trg_task_shares_reexpand ON public.task_shares;
CREATE TRIGGER trg_task_shares_reexpand
AFTER INSERT OR UPDATE OR DELETE ON public.task_shares
FOR EACH ROW EXECUTE FUNCTION public.task_shares_reexpand_trg();
