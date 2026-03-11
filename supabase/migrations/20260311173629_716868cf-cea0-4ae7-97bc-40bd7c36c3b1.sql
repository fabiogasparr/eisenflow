
-- Create task quadrant enum
CREATE TYPE public.task_quadrant AS ENUM ('do', 'schedule', 'delegate', 'eliminate');

-- Create task status enum
CREATE TYPE public.task_status AS ENUM ('pending', 'in_progress', 'completed', 'eliminated');

-- Create delegation status enum
CREATE TYPE public.delegation_status AS ENUM ('pending', 'accepted', 'completed', 'rejected');

-- Create app role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'member');

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Profiles table
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  preferred_language TEXT NOT NULL DEFAULT 'pt-BR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- User roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Users can view their own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);

-- Projects table
CREATE TABLE public.projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own projects" ON public.projects FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "Users can create projects" ON public.projects FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Users can update their own projects" ON public.projects FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Users can delete their own projects" ON public.projects FOR DELETE USING (auth.uid() = owner_id);

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tasks table
CREATE TABLE public.tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  urgency INTEGER NOT NULL DEFAULT 3 CHECK (urgency BETWEEN 1 AND 5),
  importance INTEGER NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  quadrant task_quadrant NOT NULL DEFAULT 'do',
  due_date TIMESTAMPTZ,
  estimated_time INTEGER,
  status task_status NOT NULL DEFAULT 'pending',
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  tags TEXT[] DEFAULT '{}',
  impact_score INTEGER DEFAULT 0 CHECK (impact_score BETWEEN 0 AND 100),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own tasks" ON public.tasks FOR SELECT USING (auth.uid() = created_by OR auth.uid() = assigned_to);
CREATE POLICY "Users can create tasks" ON public.tasks FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Users can update their own tasks" ON public.tasks FOR UPDATE USING (auth.uid() = created_by OR auth.uid() = assigned_to);
CREATE POLICY "Users can delete their own tasks" ON public.tasks FOR DELETE USING (auth.uid() = created_by);

CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_tasks_quadrant ON public.tasks(quadrant);
CREATE INDEX idx_tasks_created_by ON public.tasks(created_by);
CREATE INDEX idx_tasks_status ON public.tasks(status);

-- Delegations table
CREATE TABLE public.delegations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  delegated_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delegated_to UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status delegation_status NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.delegations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view delegations they're part of" ON public.delegations FOR SELECT USING (auth.uid() = delegated_by OR auth.uid() = delegated_to);
CREATE POLICY "Users can create delegations" ON public.delegations FOR INSERT WITH CHECK (auth.uid() = delegated_by);
CREATE POLICY "Users can update delegations" ON public.delegations FOR UPDATE USING (auth.uid() = delegated_by OR auth.uid() = delegated_to);

CREATE TRIGGER update_delegations_updated_at BEFORE UPDATE ON public.delegations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Productivity metrics table
CREATE TABLE public.productivity_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  tasks_completed INTEGER NOT NULL DEFAULT 0,
  tasks_eliminated INTEGER NOT NULL DEFAULT 0,
  tasks_delegated INTEGER NOT NULL DEFAULT 0,
  time_in_important INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

ALTER TABLE public.productivity_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own metrics" ON public.productivity_metrics FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own metrics" ON public.productivity_metrics FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own metrics" ON public.productivity_metrics FOR UPDATE USING (auth.uid() = user_id);
