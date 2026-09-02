-- Migration: Refresh Token Rotation and Management
-- Implements secure token rotation with expiration and family tracking

-- Add token_family column to google_calendar_tokens to track token chains
ALTER TABLE public.google_calendar_tokens
  ADD COLUMN IF NOT EXISTS token_family text,
  ADD COLUMN IF NOT EXISTS token_generation integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refresh_token_expires_at timestamptz DEFAULT (now() + interval '30 days'),
  ADD COLUMN IF NOT EXISTS is_revoked boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_reason text;

-- Create token rotation audit log
CREATE TABLE IF NOT EXISTS public.token_rotation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  token_type text NOT NULL CHECK (token_type IN ('access', 'refresh')),
  action text NOT NULL CHECK (action IN ('issued', 'rotated', 'expired', 'revoked', 'refreshed')),
  token_family text,
  generation integer,
  ip_address inet,
  user_agent text,
  reason text,
  timestamp timestamptz NOT NULL DEFAULT now()
);

-- Create session tokens table for Supabase auth tokens
CREATE TABLE IF NOT EXISTS public.session_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  token_family text NOT NULL,
  token_generation integer NOT NULL,
  session_id text UNIQUE,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  is_revoked boolean DEFAULT false,
  revoked_at timestamptz
);

-- Indexes for performance
CREATE INDEX idx_token_rotation_log_user_id ON public.token_rotation_log(user_id, timestamp DESC);
CREATE INDEX idx_token_rotation_log_action ON public.token_rotation_log(action, timestamp DESC);
CREATE INDEX idx_session_tokens_user_id ON public.session_tokens(user_id, expires_at DESC);
CREATE INDEX idx_session_tokens_family ON public.session_tokens(token_family);
CREATE INDEX idx_session_tokens_revoked ON public.session_tokens(is_revoked, expires_at);

-- RLS
ALTER TABLE public.token_rotation_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own token logs"
  ON public.token_rotation_log FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own session tokens"
  ON public.session_tokens FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can revoke their own tokens"
  ON public.session_tokens FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Function to log token operation
CREATE OR REPLACE FUNCTION log_token_rotation(
  p_user_id uuid,
  p_token_type text,
  p_action text,
  p_token_family text DEFAULT NULL,
  p_generation integer DEFAULT NULL,
  p_ip_address inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  INSERT INTO public.token_rotation_log (
    user_id, token_type, action, token_family, generation,
    ip_address, user_agent, reason
  ) VALUES (
    p_user_id, p_token_type, p_action, p_token_family, p_generation,
    p_ip_address, p_user_agent, p_reason
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if refresh token is expired
CREATE OR REPLACE FUNCTION is_refresh_token_expired(p_user_id uuid)
RETURNS boolean AS $$
DECLARE
  v_expires_at timestamptz;
BEGIN
  SELECT refresh_token_expires_at INTO v_expires_at
  FROM public.google_calendar_tokens
  WHERE user_id = p_user_id;

  RETURN v_expires_at IS NOT NULL AND v_expires_at < now();
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Function to revoke all tokens for a user (security breach scenario)
CREATE OR REPLACE FUNCTION revoke_all_user_tokens(
  p_user_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  -- Mark Google Calendar tokens as revoked
  UPDATE public.google_calendar_tokens
  SET
    is_revoked = true,
    revoked_at = now(),
    revoked_reason = p_reason,
    updated_at = now()
  WHERE user_id = p_user_id;

  -- Mark session tokens as revoked
  UPDATE public.session_tokens
  SET
    is_revoked = true,
    revoked_at = now()
  WHERE user_id = p_user_id;

  -- Log the revocation
  PERFORM log_token_rotation(
    p_user_id, 'all', 'revoked', NULL, NULL, NULL, NULL,
    p_reason || ' (bulk revocation)'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to cleanup expired tokens
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS integer AS $$
DECLARE
  v_deleted integer;
BEGIN
  -- Delete session tokens older than 90 days
  DELETE FROM public.session_tokens
  WHERE expires_at < now()
  OR (is_revoked AND revoked_at < now() - interval '7 days');

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- Log cleanup
  INSERT INTO public.token_rotation_log (
    user_id, token_type, action, reason
  ) SELECT
    user_id, 'session', 'expired', 'automatic cleanup'
  FROM (SELECT DISTINCT user_id FROM public.session_tokens
        WHERE expires_at < now()) t;

  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule cleanup job
SELECT cron.schedule(
  'cleanup_expired_tokens_daily',
  '0 3 * * *', -- 3 AM daily
  'SELECT cleanup_expired_tokens();'
);

-- Function to check token reuse attack (device fingerprint mismatch)
CREATE OR REPLACE FUNCTION detect_token_reuse_attack(
  p_session_id text,
  p_ip_address inet,
  p_user_agent text
)
RETURNS boolean AS $$
DECLARE
  v_stored_ip inet;
  v_stored_ua text;
  v_suspicious boolean := false;
BEGIN
  SELECT ip_address, user_agent INTO v_stored_ip, v_stored_ua
  FROM public.session_tokens
  WHERE session_id = p_session_id
  AND is_revoked = false;

  -- Check for IP change (might be legitimate if VPN)
  IF v_stored_ip IS NOT NULL AND v_stored_ip != p_ip_address THEN
    v_suspicious := true;
  END IF;

  -- Check for user-agent change (strong indicator)
  IF v_stored_ua IS NOT NULL AND v_stored_ua != p_user_agent THEN
    v_suspicious := true;
  END IF;

  RETURN v_suspicious;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Trigger to validate token expiration on access
CREATE OR REPLACE FUNCTION check_token_expiration_on_access()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.expires_at < now() AND NOT NEW.is_revoked THEN
    NEW.is_revoked := true;
    NEW.revoked_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER session_tokens_check_expiration
  BEFORE UPDATE ON public.session_tokens
  FOR EACH ROW
  EXECUTE FUNCTION check_token_expiration_on_access();

-- Comments
COMMENT ON TABLE public.token_rotation_log IS 'Audit log of all token rotation and revocation events';
COMMENT ON TABLE public.session_tokens IS 'Active session tokens with rotation history';
COMMENT ON COLUMN public.google_calendar_tokens.token_family IS 'Family ID for tracking token rotation chains';
COMMENT ON COLUMN public.google_calendar_tokens.token_generation IS 'Generation number in rotation chain';
COMMENT ON COLUMN public.google_calendar_tokens.refresh_token_expires_at IS 'When refresh token expires (30 days)';
COMMENT ON FUNCTION detect_token_reuse_attack IS 'Detect suspicious token reuse with device fingerprinting';

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION log_token_rotation(uuid, text, text, text, integer, inet, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION is_refresh_token_expired(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION detect_token_reuse_attack(text, inet, text) TO authenticated;
GRANT EXECUTE ON FUNCTION revoke_all_user_tokens(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_expired_tokens() TO authenticated;
