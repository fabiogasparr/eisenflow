
-- Create team role enum
CREATE TYPE public.team_role AS ENUM ('admin', 'manager', 'member');

-- Create invite status enum
CREATE TYPE public.invite_status AS ENUM ('pending', 'accepted', 'expired', 'cancelled');

-- Teams table
CREATE TABLE public.teams (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  avatar_url TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Team members table
CREATE TABLE public.team_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role team_role NOT NULL DEFAULT 'member',
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(team_id, user_id)
);

-- Team invites table
CREATE TABLE public.team_invites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL,
  invited_email TEXT,
  invite_code TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  status invite_status NOT NULL DEFAULT 'pending',
  role team_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '7 days'),
  UNIQUE(invite_code)
);

-- Add team_id to projects (optional)
ALTER TABLE public.projects ADD COLUMN team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL;

-- Security definer function: check if user is a team member
CREATE OR REPLACE FUNCTION public.is_team_member(_user_id UUID, _team_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = _user_id AND team_id = _team_id
  )
$$;

-- Security definer function: check team role
CREATE OR REPLACE FUNCTION public.get_team_role(_user_id UUID, _team_id UUID)
RETURNS team_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.team_members
  WHERE user_id = _user_id AND team_id = _team_id
  LIMIT 1
$$;

-- Enable RLS
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_invites ENABLE ROW LEVEL SECURITY;

-- Teams policies
CREATE POLICY "Team members can view their teams" ON public.teams
  FOR SELECT USING (public.is_team_member(auth.uid(), id));

CREATE POLICY "Authenticated users can create teams" ON public.teams
  FOR INSERT WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Team admins can update teams" ON public.teams
  FOR UPDATE USING (public.get_team_role(auth.uid(), id) = 'admin');

CREATE POLICY "Team admins can delete teams" ON public.teams
  FOR DELETE USING (public.get_team_role(auth.uid(), id) = 'admin');

-- Team members policies
CREATE POLICY "Team members can view other members" ON public.team_members
  FOR SELECT USING (public.is_team_member(auth.uid(), team_id));

CREATE POLICY "Team admins/managers can add members" ON public.team_members
  FOR INSERT WITH CHECK (
    public.get_team_role(auth.uid(), team_id) IN ('admin', 'manager')
    OR auth.uid() = user_id -- user accepting an invite
  );

CREATE POLICY "Team admins can update members" ON public.team_members
  FOR UPDATE USING (public.get_team_role(auth.uid(), team_id) = 'admin');

CREATE POLICY "Team admins can remove members" ON public.team_members
  FOR DELETE USING (
    public.get_team_role(auth.uid(), team_id) = 'admin'
    OR auth.uid() = user_id -- member leaving team
  );

-- Team invites policies
CREATE POLICY "Team members can view invites" ON public.team_invites
  FOR SELECT USING (
    public.is_team_member(auth.uid(), team_id)
    OR invited_email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

CREATE POLICY "Team admins/managers can create invites" ON public.team_invites
  FOR INSERT WITH CHECK (
    public.get_team_role(auth.uid(), team_id) IN ('admin', 'manager')
  );

CREATE POLICY "Team admins can update invites" ON public.team_invites
  FOR UPDATE USING (
    public.get_team_role(auth.uid(), team_id) IN ('admin', 'manager')
  );

CREATE POLICY "Team admins can delete invites" ON public.team_invites
  FOR DELETE USING (
    public.get_team_role(auth.uid(), team_id) IN ('admin', 'manager')
  );

-- Auto-add creator as admin when team is created
CREATE OR REPLACE FUNCTION public.handle_new_team()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.team_members (team_id, user_id, role)
  VALUES (NEW.id, NEW.created_by, 'admin');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_team_created
  AFTER INSERT ON public.teams
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_team();

-- Update projects RLS to allow team members to view team projects
CREATE POLICY "Team members can view team projects" ON public.projects
  FOR SELECT USING (
    team_id IS NOT NULL AND public.is_team_member(auth.uid(), team_id)
  );

-- Update tasks RLS: team members can view tasks in team projects
CREATE POLICY "Team members can view team tasks" ON public.tasks
  FOR SELECT USING (
    project_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id
      AND p.team_id IS NOT NULL
      AND public.is_team_member(auth.uid(), p.team_id)
    )
  );

-- Update updated_at trigger for teams
CREATE TRIGGER update_teams_updated_at
  BEFORE UPDATE ON public.teams
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
