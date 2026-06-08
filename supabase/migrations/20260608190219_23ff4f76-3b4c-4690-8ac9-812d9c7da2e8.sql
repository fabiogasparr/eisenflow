
-- helper to check admin/owner of a tenant
CREATE OR REPLACE FUNCTION public.is_tenant_admin(_user_id uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE user_id = _user_id
      AND tenant_id = _tenant_id
      AND role IN ('owner','admin')
  )
$$;

-- ============ tenant_mcp_settings ============
CREATE TABLE public.tenant_mcp_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_mcp_settings TO authenticated;
GRANT ALL ON public.tenant_mcp_settings TO service_role;

ALTER TABLE public.tenant_mcp_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can read mcp settings"
  ON public.tenant_mcp_settings FOR SELECT
  TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));

CREATE POLICY "tenant admins can insert mcp settings"
  ON public.tenant_mcp_settings FOR INSERT
  TO authenticated
  WITH CHECK (public.is_tenant_admin(auth.uid(), tenant_id));

CREATE POLICY "tenant admins can update mcp settings"
  ON public.tenant_mcp_settings FOR UPDATE
  TO authenticated
  USING (public.is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (public.is_tenant_admin(auth.uid(), tenant_id));

CREATE TRIGGER trg_tenant_mcp_settings_updated_at
  BEFORE UPDATE ON public.tenant_mcp_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ tenant_api_keys ============
CREATE TABLE public.tenant_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_by uuid NOT NULL,
  last_used_at timestamptz,
  last_used_ip text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tenant_api_keys_tenant ON public.tenant_api_keys(tenant_id);
CREATE INDEX idx_tenant_api_keys_hash ON public.tenant_api_keys(key_hash);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_api_keys TO authenticated;
GRANT ALL ON public.tenant_api_keys TO service_role;

ALTER TABLE public.tenant_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant admins can read api keys"
  ON public.tenant_api_keys FOR SELECT
  TO authenticated
  USING (public.is_tenant_admin(auth.uid(), tenant_id));

CREATE POLICY "tenant admins can insert api keys"
  ON public.tenant_api_keys FOR INSERT
  TO authenticated
  WITH CHECK (public.is_tenant_admin(auth.uid(), tenant_id) AND created_by = auth.uid());

CREATE POLICY "tenant admins can update api keys"
  ON public.tenant_api_keys FOR UPDATE
  TO authenticated
  USING (public.is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (public.is_tenant_admin(auth.uid(), tenant_id));

CREATE POLICY "tenant admins can delete api keys"
  ON public.tenant_api_keys FOR DELETE
  TO authenticated
  USING (public.is_tenant_admin(auth.uid(), tenant_id));

-- ============ tenant_api_audit_log ============
CREATE TABLE public.tenant_api_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  api_key_id uuid REFERENCES public.tenant_api_keys(id) ON DELETE SET NULL,
  tool text,
  status text NOT NULL,
  error text,
  input_preview jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tenant_api_audit_tenant_created ON public.tenant_api_audit_log(tenant_id, created_at DESC);

GRANT SELECT ON public.tenant_api_audit_log TO authenticated;
GRANT ALL ON public.tenant_api_audit_log TO service_role;

ALTER TABLE public.tenant_api_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant admins can read audit log"
  ON public.tenant_api_audit_log FOR SELECT
  TO authenticated
  USING (public.is_tenant_admin(auth.uid(), tenant_id));
