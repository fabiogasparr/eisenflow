
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'super_admin'
  )
$$;

-- Super admin can view all user_roles
CREATE POLICY "Super admins can view all user roles"
ON public.user_roles FOR SELECT TO authenticated
USING (public.is_super_admin());

-- Super admin can manage user_roles
CREATE POLICY "Super admins can manage user roles"
ON public.user_roles FOR ALL TO authenticated
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());

-- Super admin can view all tasks
CREATE POLICY "Super admins can view all tasks"
ON public.tasks FOR SELECT TO authenticated
USING (public.is_super_admin());

-- Super admin can view all gamification
CREATE POLICY "Super admins can view all gamification"
ON public.gamification FOR SELECT TO authenticated
USING (public.is_super_admin());

-- Super admin can view all profiles (already allowed for authenticated, but explicit)
-- profiles already has "Authenticated users can view all profiles" so no need
