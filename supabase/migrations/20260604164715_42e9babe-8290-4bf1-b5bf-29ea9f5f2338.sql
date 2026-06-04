-- 1) task_shares: enforce ownership/assignee on INSERT and UPDATE
DROP POLICY IF EXISTS "Task owners can create shares" ON public.task_shares;
CREATE POLICY "Task owners can create shares"
ON public.task_shares
FOR INSERT
TO authenticated
WITH CHECK (
  shared_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = task_shares.task_id
      AND (t.created_by = auth.uid() OR t.assigned_to = auth.uid())
  )
);

DROP POLICY IF EXISTS "Task owners can update shares" ON public.task_shares;
CREATE POLICY "Task owners can update shares"
ON public.task_shares
FOR UPDATE
TO authenticated
USING (shared_by = auth.uid())
WITH CHECK (
  shared_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = task_shares.task_id
      AND (t.created_by = auth.uid() OR t.assigned_to = auth.uid())
  )
);

-- 2) tenant_whatsapp_connections: restrict SELECT to owners/admins (QR + phone are sensitive)
DROP POLICY IF EXISTS "tenant wa select" ON public.tenant_whatsapp_connections;
CREATE POLICY "tenant wa admin select"
ON public.tenant_whatsapp_connections
FOR SELECT
TO authenticated
USING (
  public.get_tenant_role(auth.uid(), tenant_id) = ANY (ARRAY['owner'::tenant_role, 'admin'::tenant_role])
);

-- 3) Pin search_path on helper function flagged by linter
CREATE OR REPLACE FUNCTION public.compute_reminder_scheduled_at(_kind reminder_kind, _due timestamp with time zone, _start timestamp with time zone)
RETURNS timestamp with time zone
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE _kind
    WHEN 'due_d1' THEN _due - interval '1 day'
    WHEN 'due_1h' THEN _due - interval '1 hour'
    WHEN 'due_now' THEN _due
    WHEN 'start_now' THEN _start
    WHEN 'start_5min' THEN _start - interval '5 minutes'
    ELSE NULL
  END
$function$;