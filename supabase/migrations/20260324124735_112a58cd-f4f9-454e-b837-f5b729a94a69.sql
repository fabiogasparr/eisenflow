ALTER TABLE public.profiles ADD COLUMN disabled boolean NOT NULL DEFAULT false;

-- Allow super admins to update any profile (for toggling disabled)
DROP POLICY IF EXISTS "Super admins can update all profiles" ON public.profiles;
CREATE POLICY "Super admins can update all profiles"
ON public.profiles FOR UPDATE TO authenticated
USING (is_super_admin())
WITH CHECK (is_super_admin());