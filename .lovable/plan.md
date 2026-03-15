

# Fix: "permission denied for table users"

## Root Cause

Three RLS policies reference `auth.users` directly in their expressions. Client-side queries cannot access `auth.users`, so any operation that triggers evaluation of these policies fails.

Affected policies:
1. **tasks** → "Users can update shared tasks with edit permission" (UPDATE)
2. **task_shares** → "Users can view their shares" (SELECT)
3. **team_invites** → "Team members can view invites" (SELECT)

## Solution

1. **Create a `get_user_email` security definer function** that safely returns the current user's email from `auth.users`
2. **Replace all direct `auth.users` references** in the 3 policies with calls to `get_user_email()`

### Database migration

```sql
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
DROP POLICY "Users can update shared tasks with edit permission" ON public.tasks;
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
DROP POLICY "Users can view their shares" ON public.task_shares;
CREATE POLICY "Users can view their shares"
ON public.task_shares FOR SELECT TO authenticated
USING (
  shared_by = auth.uid()
  OR shared_with_user_id = auth.uid()
  OR shared_with_email = public.get_user_email()
);

-- 4. Fix team_invites SELECT policy
DROP POLICY "Team members can view invites" ON public.team_invites;
CREATE POLICY "Team members can view invites"
ON public.team_invites FOR SELECT TO public
USING (
  is_team_member(auth.uid(), team_id)
  OR invited_email = public.get_user_email()
);
```

Also check and fix `is_task_shared_with` function which references `auth.users`:

```sql
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
           OR shared_with_email = (SELECT email::text FROM auth.users WHERE id = _user_id))
  )
$$;
```

This one is already SECURITY DEFINER so it works, but we should keep it consistent.

### No code changes needed
The fix is entirely in the database — no frontend files need to change.

