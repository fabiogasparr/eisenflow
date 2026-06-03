
-- 1) Fix subtasks SELECT to mirror task visibility (shared/tenant/team)
DROP POLICY IF EXISTS "Users can view subtasks of their tasks" ON public.subtasks;
CREATE POLICY "Users can view subtasks of accessible tasks"
ON public.subtasks
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = subtasks.task_id
      AND (
        t.created_by = auth.uid()
        OR t.assigned_to = auth.uid()
        OR (t.tenant_id IS NOT NULL AND public.is_tenant_member(auth.uid(), t.tenant_id))
        OR (t.project_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.projects p
              WHERE p.id = t.project_id AND p.team_id IS NOT NULL AND public.is_team_member(auth.uid(), p.team_id)
            ))
        OR public.is_task_shared_with(auth.uid(), t.id)
        OR public.is_super_admin()
      )
  )
);

-- 2) Public bucket listing: drop broad SELECT on tenant-logos.
-- Direct public URLs still work because the bucket itself is public; this only blocks listing/enumeration.
DROP POLICY IF EXISTS "Anyone can view tenant logos" ON storage.objects;

-- 3) Revoke EXECUTE from anon/authenticated on SECURITY DEFINER functions that should not be callable directly.
-- These are trigger-only or internal helpers; functions used inside RLS expressions retain their default access.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_team() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_tenant() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_tenant() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_task_assigned() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_task_status_changed() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_gamification_update() FROM anon, authenticated, PUBLIC;

-- Internal helpers (used only by RLS via planner; revoke direct EXECUTE from anon)
REVOKE EXECUTE ON FUNCTION public.get_user_email() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_tenant_id(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_tenant_role(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_team_role(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_tenant_member(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_team_member(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_task_shared_with(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon;
