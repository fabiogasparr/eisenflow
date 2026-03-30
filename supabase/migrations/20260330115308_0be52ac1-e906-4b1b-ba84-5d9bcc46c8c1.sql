
-- Fix 1: Remove self-join bypass from team_members INSERT policy
DROP POLICY IF EXISTS "Team admins/managers can add members" ON public.team_members;

CREATE POLICY "Team admins/managers can add members"
ON public.team_members
FOR INSERT
TO public
WITH CHECK (
  get_team_role(auth.uid(), team_id) = ANY (ARRAY['admin'::team_role, 'manager'::team_role])
);

-- Fix 2: Restrict profiles SELECT to same team/tenant members only
DROP POLICY IF EXISTS "Authenticated users can view all profiles" ON public.profiles;

CREATE POLICY "Users can view profiles of co-members"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM public.tenant_members tm1
    JOIN public.tenant_members tm2 ON tm1.tenant_id = tm2.tenant_id
    WHERE tm1.user_id = auth.uid() AND tm2.user_id = profiles.user_id
  )
  OR EXISTS (
    SELECT 1 FROM public.team_members tm1
    JOIN public.team_members tm2 ON tm1.team_id = tm2.team_id
    WHERE tm1.user_id = auth.uid() AND tm2.user_id = profiles.user_id
  )
  OR is_super_admin()
);
