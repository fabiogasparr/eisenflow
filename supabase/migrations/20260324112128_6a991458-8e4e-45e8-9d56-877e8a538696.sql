
CREATE POLICY "Super admins can view all productivity_metrics"
ON public.productivity_metrics FOR SELECT TO authenticated
USING (is_super_admin());
