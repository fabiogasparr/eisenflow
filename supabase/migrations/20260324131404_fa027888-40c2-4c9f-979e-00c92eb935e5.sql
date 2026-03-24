
-- Table to store Google OAuth2 tokens per user
CREATE TABLE public.google_calendar_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_expires_at timestamptz NOT NULL,
  calendar_id text NOT NULL DEFAULT 'primary',
  sync_enabled boolean NOT NULL DEFAULT true,
  last_synced_at timestamptz,
  google_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.google_calendar_tokens ENABLE ROW LEVEL SECURITY;

-- User can read/update/delete their own tokens
CREATE POLICY "Users can view their own google tokens"
ON public.google_calendar_tokens FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own google tokens"
ON public.google_calendar_tokens FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own google tokens"
ON public.google_calendar_tokens FOR UPDATE TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own google tokens"
ON public.google_calendar_tokens FOR DELETE TO authenticated
USING (auth.uid() = user_id);

-- Super admin can view all
CREATE POLICY "Super admins can view all google tokens"
ON public.google_calendar_tokens FOR SELECT TO authenticated
USING (is_super_admin());

-- Add google_event_id to tasks table
ALTER TABLE public.tasks ADD COLUMN google_event_id text;

-- Trigger for updated_at
CREATE TRIGGER update_google_calendar_tokens_updated_at
  BEFORE UPDATE ON public.google_calendar_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
