
-- Create tenant_invites table (similar to team_invites)
CREATE TABLE public.tenant_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  invited_by uuid NOT NULL,
  invited_email text,
  invite_code text NOT NULL DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  status invite_status NOT NULL DEFAULT 'pending',
  role tenant_role NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);

ALTER TABLE public.tenant_invites ENABLE ROW LEVEL SECURITY;

-- RLS: tenant admins/owners can manage invites
CREATE POLICY "Tenant admins can create invites"
  ON public.tenant_invites FOR INSERT
  WITH CHECK (
    get_tenant_role(auth.uid(), tenant_id) IN ('owner', 'admin')
  );

CREATE POLICY "Tenant admins can view invites"
  ON public.tenant_invites FOR SELECT
  USING (
    get_tenant_role(auth.uid(), tenant_id) IN ('owner', 'admin')
    OR invited_email = get_user_email()
  );

CREATE POLICY "Tenant admins can update invites"
  ON public.tenant_invites FOR UPDATE
  USING (
    get_tenant_role(auth.uid(), tenant_id) IN ('owner', 'admin')
  );

CREATE POLICY "Tenant admins can delete invites"
  ON public.tenant_invites FOR DELETE
  USING (
    get_tenant_role(auth.uid(), tenant_id) IN ('owner', 'admin')
  );
