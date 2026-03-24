
CREATE POLICY "Super admins can view all teams"
ON public.teams FOR SELECT TO authenticated
USING (is_super_admin());

CREATE POLICY "Super admins can view all team members"
ON public.team_members FOR SELECT TO authenticated
USING (is_super_admin());
