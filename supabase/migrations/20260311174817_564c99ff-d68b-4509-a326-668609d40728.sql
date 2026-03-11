
-- Gamification table for streaks and scores
CREATE TABLE public.gamification (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_active_date DATE,
  total_tasks_completed INTEGER NOT NULL DEFAULT 0,
  total_tasks_eliminated INTEGER NOT NULL DEFAULT 0,
  total_tasks_delegated INTEGER NOT NULL DEFAULT 0,
  total_focus_minutes INTEGER NOT NULL DEFAULT 0,
  life_score INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  xp INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.gamification ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own gamification" ON public.gamification FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own gamification" ON public.gamification FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own gamification" ON public.gamification FOR UPDATE USING (auth.uid() = user_id);

CREATE TRIGGER update_gamification_updated_at BEFORE UPDATE ON public.gamification
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Badges earned by users
CREATE TABLE public.user_badges (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  badge_id TEXT NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, badge_id)
);

ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own badges" ON public.user_badges FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own badges" ON public.user_badges FOR INSERT WITH CHECK (auth.uid() = user_id);
