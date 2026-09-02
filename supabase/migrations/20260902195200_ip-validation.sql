-- Migration: IP Validation and Whitelisting
-- Tracks IP access patterns and enforces whitelist policies per team/tenant

CREATE TABLE IF NOT EXISTS public.ip_whitelist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants ON DELETE CASCADE,
  ip_address inet NOT NULL,
  description text,
  added_by uuid REFERENCES auth.users ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, ip_address)
);

CREATE TABLE IF NOT EXISTS public.ip_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  ip_address inet NOT NULL,
  user_id uuid REFERENCES auth.users ON DELETE SET NULL,
  endpoint text NOT NULL,
  method text NOT NULL,
  status_code integer,
  allowed boolean NOT NULL DEFAULT true,
  reason text,
  user_agent text,
  timestamp timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.suspicious_ips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address inet NOT NULL UNIQUE,
  threat_level text NOT NULL CHECK (threat_level IN ('low', 'medium', 'high', 'critical')),
  reason text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  block_until timestamptz,
  is_blocked boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_ip_whitelist_tenant_id ON public.ip_whitelist(tenant_id, is_active);
CREATE INDEX idx_ip_access_log_ip_address ON public.ip_access_log(ip_address, timestamp DESC);
CREATE INDEX idx_ip_access_log_tenant_id ON public.ip_access_log(tenant_id, timestamp DESC);
CREATE INDEX idx_suspicious_ips_ip_address ON public.suspicious_ips(ip_address, is_blocked);

-- RLS
ALTER TABLE public.ip_whitelist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ip_access_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage whitelist" ON public.ip_whitelist
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = ip_whitelist.tenant_id
      AND tm.user_id = auth.uid()
      AND tm.role IN ('admin', 'owner')
    )
  );

CREATE POLICY "Admins can view access logs" ON public.ip_access_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = ip_access_log.tenant_id
      AND tm.user_id = auth.uid()
      AND tm.role IN ('admin', 'owner')
    )
  );

-- Function to check IP whitelist
CREATE OR REPLACE FUNCTION is_ip_allowed(
  p_tenant_id uuid,
  p_ip_address inet
)
RETURNS boolean AS $$
BEGIN
  -- Check if IP is in suspicious list and blocked
  IF EXISTS (
    SELECT 1 FROM public.suspicious_ips
    WHERE ip_address = p_ip_address
    AND is_blocked = true
    AND (block_until IS NULL OR block_until > now())
  ) THEN
    RETURN false;
  END IF;

  -- If whitelist has entries for this tenant, check if IP is in it
  IF EXISTS (
    SELECT 1 FROM public.ip_whitelist
    WHERE tenant_id = p_tenant_id
  ) THEN
    RETURN EXISTS (
      SELECT 1 FROM public.ip_whitelist
      WHERE tenant_id = p_tenant_id
      AND ip_address = p_ip_address
      AND is_active = true
    );
  END IF;

  -- No whitelist = allow all
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to log IP access
CREATE OR REPLACE FUNCTION log_ip_access(
  p_tenant_id uuid,
  p_ip_address inet,
  p_endpoint text,
  p_method text,
  p_allowed boolean,
  p_reason text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  INSERT INTO public.ip_access_log (
    tenant_id, ip_address, user_id, endpoint, method,
    allowed, reason, user_agent
  ) VALUES (
    p_tenant_id, p_ip_address, auth.uid(), p_endpoint, p_method,
    p_allowed, p_reason, p_user_agent
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to report suspicious IP
CREATE OR REPLACE FUNCTION report_suspicious_ip(
  p_ip_address inet,
  p_threat_level text,
  p_reason text
)
RETURNS void AS $$
BEGIN
  INSERT INTO public.suspicious_ips (ip_address, threat_level, reason)
  VALUES (p_ip_address, p_threat_level, p_reason)
  ON CONFLICT (ip_address) DO UPDATE
  SET
    threat_level = GREATEST(suspicious_ips.threat_level, p_threat_level),
    reason = p_reason,
    failed_attempts = suspicious_ips.failed_attempts + 1,
    updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for updated_at
CREATE TRIGGER update_ip_whitelist_updated_at
  BEFORE UPDATE ON public.ip_whitelist
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_suspicious_ips_updated_at
  BEFORE UPDATE ON public.suspicious_ips
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

GRANT EXECUTE ON FUNCTION is_ip_allowed(uuid, inet) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION log_ip_access(uuid, inet, text, text, boolean, text, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION report_suspicious_ip(inet, text, text) TO authenticated;
