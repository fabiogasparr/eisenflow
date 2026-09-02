-- Migration: Two-Factor Authentication (2FA) for Admins
-- Implements TOTP-based 2FA with backup codes

CREATE TABLE public.user_2fa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users ON DELETE CASCADE,
  is_enabled boolean NOT NULL DEFAULT false,
  totp_secret text,  -- Encrypted in application layer
  totp_secret_encrypted bytea,
  backup_codes text[] NOT NULL DEFAULT '{}',
  backup_codes_encrypted bytea,
  setup_verified_at timestamptz,
  enabled_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.admin_2fa_enforcement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants ON DELETE CASCADE,
  require_2fa_for_admins boolean NOT NULL DEFAULT true,
  allow_30_day_grace_period boolean NOT NULL DEFAULT true,
  grace_period_end_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id)
);

CREATE TABLE public.failed_2fa_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  ip_address inet,
  user_agent text,
  timestamp timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_user_2fa_user_id ON public.user_2fa(user_id);
CREATE INDEX idx_user_2fa_is_enabled ON public.user_2fa(is_enabled);
CREATE INDEX idx_failed_2fa_attempts_user_id ON public.failed_2fa_attempts(user_id, timestamp DESC);
CREATE INDEX idx_failed_2fa_attempts_ip ON public.failed_2fa_attempts(ip_address, timestamp DESC);

-- RLS
ALTER TABLE public.user_2fa ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own 2FA settings"
  ON public.user_2fa FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own 2FA settings"
  ON public.user_2fa FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- Function to validate TOTP code format
CREATE OR REPLACE FUNCTION is_valid_totp_format(p_code text)
RETURNS boolean AS $$
BEGIN
  RETURN p_code ~ '^\d{6}$';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to check if user has 2FA enabled
CREATE OR REPLACE FUNCTION user_has_2fa_enabled(p_user_id uuid)
RETURNS boolean AS $$
DECLARE
  v_enabled boolean;
BEGIN
  SELECT is_enabled INTO v_enabled FROM public.user_2fa WHERE user_id = p_user_id;
  RETURN COALESCE(v_enabled, false);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Function to log failed 2FA attempt
CREATE OR REPLACE FUNCTION log_failed_2fa_attempt(
  p_user_id uuid,
  p_ip_address inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  INSERT INTO public.failed_2fa_attempts (user_id, ip_address, user_agent)
  VALUES (p_user_id, p_ip_address, p_user_agent);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check failed 2FA attempts
CREATE OR REPLACE FUNCTION get_failed_2fa_attempts(
  p_user_id uuid,
  p_minutes_back integer DEFAULT 30
)
RETURNS integer AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count FROM public.failed_2fa_attempts
  WHERE user_id = p_user_id
  AND timestamp > now() - (p_minutes_back || ' minutes')::interval;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Trigger for updated_at
CREATE TRIGGER update_user_2fa_updated_at
  BEFORE UPDATE ON public.user_2fa
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_admin_2fa_enforcement_updated_at
  BEFORE UPDATE ON public.admin_2fa_enforcement
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION is_valid_totp_format(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION user_has_2fa_enabled(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION log_failed_2fa_attempt(uuid, inet, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_failed_2fa_attempts(uuid, integer) TO authenticated;
