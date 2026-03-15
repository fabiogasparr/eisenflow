
-- Create permission enum for task shares
CREATE TYPE public.share_permission AS ENUM ('view', 'edit');

-- Create task_shares table
CREATE TABLE public.task_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  shared_by uuid NOT NULL,
  shared_with_email text NOT NULL,
  shared_with_user_id uuid,
  permission share_permission NOT NULL DEFAULT 'view',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint: can't share same task with same email twice
ALTER TABLE public.task_shares ADD CONSTRAINT unique_task_share UNIQUE (task_id, shared_with_email);

-- Enable RLS
ALTER TABLE public.task_shares ENABLE ROW LEVEL SECURITY;

-- Security definer function to check if user has a share
CREATE OR REPLACE FUNCTION public.is_task_shared_with(_user_id uuid, _task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.task_shares
    WHERE task_id = _task_id
      AND (shared_with_user_id = _user_id 
           OR shared_with_email = (SELECT email FROM auth.users WHERE id = _user_id))
  )
$$;

-- RLS: owners see shares they created, recipients see shares for them
CREATE POLICY "Users can view their shares" ON public.task_shares
FOR SELECT TO authenticated
USING (
  shared_by = auth.uid() 
  OR shared_with_user_id = auth.uid()
  OR shared_with_email = (SELECT email FROM auth.users WHERE id = auth.uid())::text
);

CREATE POLICY "Task owners can create shares" ON public.task_shares
FOR INSERT TO authenticated
WITH CHECK (shared_by = auth.uid());

CREATE POLICY "Task owners can delete shares" ON public.task_shares
FOR DELETE TO authenticated
USING (shared_by = auth.uid());

-- Add RLS policy on tasks table so shared users can view shared tasks
CREATE POLICY "Users can view shared tasks" ON public.tasks
FOR SELECT TO authenticated
USING (is_task_shared_with(auth.uid(), id));

-- Policy for edit permission on shared tasks
CREATE POLICY "Users can update shared tasks with edit permission" ON public.tasks
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.task_shares
    WHERE task_id = tasks.id
      AND permission = 'edit'
      AND (shared_with_user_id = auth.uid()
           OR shared_with_email = (SELECT email FROM auth.users WHERE id = auth.uid())::text)
  )
);

-- Allow profiles to be viewed by anyone authenticated (for displaying names in shares)
CREATE POLICY "Authenticated users can view all profiles" ON public.profiles
FOR SELECT TO authenticated
USING (true);

-- Drop the old restrictive profile select policy
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
