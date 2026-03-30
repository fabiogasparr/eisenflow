
-- 1. Remove super admin SELECT policy from google_calendar_tokens (tokens should only be accessed via service_role in edge functions)
DROP POLICY IF EXISTS "Super admins can view all google tokens" ON google_calendar_tokens;

-- 2. Fix profiles UPDATE policy to prevent users from changing their own disabled status
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE TO public
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND disabled IS NOT DISTINCT FROM (SELECT p.disabled FROM profiles p WHERE p.user_id = auth.uid())
  );

-- 3. Add validation trigger on gamification to prevent arbitrary stat manipulation
CREATE OR REPLACE FUNCTION public.validate_gamification_update()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  -- Only allow incremental changes, not arbitrary values
  -- Block decreasing xp, level, or setting unreasonably high values
  IF NEW.xp < OLD.xp AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Cannot decrease XP';
  END IF;
  IF NEW.level < OLD.level AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Cannot decrease level';
  END IF;
  IF NEW.total_tasks_completed < OLD.total_tasks_completed AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Cannot decrease completed task count';
  END IF;
  IF NEW.total_focus_minutes < OLD.total_focus_minutes AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Cannot decrease focus minutes';
  END IF;
  IF NEW.total_pomodoros < OLD.total_pomodoros AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Cannot decrease pomodoro count';
  END IF;
  -- Limit single-update increments to reasonable values
  IF (NEW.xp - OLD.xp) > 500 AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'XP increment too large';
  END IF;
  IF (NEW.total_focus_minutes - OLD.total_focus_minutes) > 480 AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'Focus minutes increment too large';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_gamification_update ON gamification;
CREATE TRIGGER validate_gamification_update
  BEFORE UPDATE ON gamification
  FOR EACH ROW
  EXECUTE FUNCTION validate_gamification_update();
