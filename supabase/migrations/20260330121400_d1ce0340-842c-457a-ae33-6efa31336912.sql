
-- =============================================
-- Fix 1: Task DELETE bypass - convert to RESTRICTIVE policy
-- =============================================
DROP POLICY IF EXISTS "Guests cannot delete tenant tasks" ON public.tasks;

CREATE POLICY "Guests cannot delete tenant tasks"
ON public.tasks
AS RESTRICTIVE
FOR DELETE
TO public
USING (
  (tenant_id IS NULL) OR (get_tenant_role(auth.uid(), tenant_id) IS DISTINCT FROM 'guest'::tenant_role)
);

-- =============================================
-- Fix 2: Badge self-grant - remove user INSERT policy, create SECURITY DEFINER function
-- =============================================
DROP POLICY IF EXISTS "Users can insert their own badges" ON public.user_badges;

CREATE OR REPLACE FUNCTION public.award_badge_if_earned(_user_id uuid, _badge_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Caller must be the user themselves
  IF auth.uid() IS NULL OR auth.uid() != _user_id THEN
    RETURN false;
  END IF;

  -- Check if badge already earned
  IF EXISTS (SELECT 1 FROM public.user_badges WHERE user_id = _user_id AND badge_id = _badge_id) THEN
    RETURN false;
  END IF;

  -- Validate badge_id is a known badge
  IF _badge_id NOT IN (
    'first_task', 'task_master_10', 'task_master_50', 'task_master_100',
    'streak_3', 'streak_7', 'streak_30',
    'eliminator_5', 'delegator_5',
    'focus_60', 'focus_300',
    'level_5', 'level_10',
    'score_50', 'score_80',
    'pomodoro_10', 'pomodoro_50', 'pomodoro_100'
  ) THEN
    RETURN false;
  END IF;

  -- Validate eligibility by checking gamification stats
  DECLARE
    stats RECORD;
  BEGIN
    SELECT * INTO stats FROM public.gamification WHERE user_id = _user_id;
    IF NOT FOUND THEN RETURN false; END IF;

    -- Check condition for each badge
    IF (_badge_id = 'first_task' AND stats.total_tasks_completed < 1) OR
       (_badge_id = 'task_master_10' AND stats.total_tasks_completed < 10) OR
       (_badge_id = 'task_master_50' AND stats.total_tasks_completed < 50) OR
       (_badge_id = 'task_master_100' AND stats.total_tasks_completed < 100) OR
       (_badge_id = 'streak_3' AND stats.longest_streak < 3) OR
       (_badge_id = 'streak_7' AND stats.longest_streak < 7) OR
       (_badge_id = 'streak_30' AND stats.longest_streak < 30) OR
       (_badge_id = 'eliminator_5' AND stats.total_tasks_eliminated < 5) OR
       (_badge_id = 'delegator_5' AND stats.total_tasks_delegated < 5) OR
       (_badge_id = 'focus_60' AND stats.total_focus_minutes < 60) OR
       (_badge_id = 'focus_300' AND stats.total_focus_minutes < 300) OR
       (_badge_id = 'level_5' AND stats.level < 5) OR
       (_badge_id = 'level_10' AND stats.level < 10) OR
       (_badge_id = 'score_50' AND stats.life_score < 50) OR
       (_badge_id = 'score_80' AND stats.life_score < 80) OR
       (_badge_id = 'pomodoro_10' AND stats.total_pomodoros < 10) OR
       (_badge_id = 'pomodoro_50' AND stats.total_pomodoros < 50) OR
       (_badge_id = 'pomodoro_100' AND stats.total_pomodoros < 100)
    THEN
      RETURN false;
    END IF;
  END;

  -- Insert the badge
  INSERT INTO public.user_badges (user_id, badge_id) VALUES (_user_id, _badge_id);
  RETURN true;
END;
$$;

-- =============================================
-- Fix 3: Tenant members self-insert escalation - remove OR clause
-- =============================================
DROP POLICY IF EXISTS "Tenant owners/admins can add members" ON public.tenant_members;

CREATE POLICY "Tenant owners/admins can add members"
ON public.tenant_members
FOR INSERT
TO public
WITH CHECK (
  get_tenant_role(auth.uid(), tenant_id) = ANY (ARRAY['owner'::tenant_role, 'admin'::tenant_role])
);

-- =============================================
-- Fix 4: whatsapp_sent_reminders - table is service_role only, no changes needed
-- but explicitly document by ensuring no authenticated policy exists
-- =============================================
-- Already correct - only service_role policy exists. No fix needed.
