CREATE POLICY "Task owners can update shares" ON public.task_shares
FOR UPDATE TO authenticated
USING (shared_by = auth.uid());