
-- 1. Security definer function to get current user email
CREATE OR REPLACE FUNCTION public.get_user_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email::text FROM auth.users WHERE id = auth.uid()
$$;

-- 2. Fix tasks UPDATE policy
DROP POLICY IF EXISTS "Users can update shared tasks with edit permission" ON public.tasks;
CREATE POLICY "Users can update shared tasks with edit permission"
ON public.tasks FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM task_shares
    WHERE task_shares.task_id = tasks.id
      AND task_shares.permission = 'edit'
      AND (
        task_shares.shared_with_user_id = auth.uid()
        OR task_shares.shared_with_email = public.get_user_email()
      )
  )
);

-- 3. Fix task_shares SELECT policy
DROP POLICY IF EXISTS "Users can view their shares" ON public.task_shares;
CREATE POLICY "Users can view their shares"
ON public.task_shares FOR SELECT TO authenticated
USING (
  shared_by = auth.uid()
  OR shared_with_user_id = auth.uid()
  OR shared_with_email = public.get_user_email()
);

-- 4. Fix team_invites SELECT policy
DROP POLICY IF EXISTS "Team members can view invites" ON public.team_invites;
CREATE POLICY "Team members can view invites"
ON public.team_invites FOR SELECT TO public
USING (
  is_team_member(auth.uid(), team_id)
  OR invited_email = public.get_user_email()
);
