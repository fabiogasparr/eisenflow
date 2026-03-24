
-- 1. Create tenant_role enum
CREATE TYPE public.tenant_role AS ENUM ('owner', 'admin', 'member', 'guest');

-- 2. Create tenants table
CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  logo_url text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Create tenant_members table
CREATE TABLE public.tenant_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role tenant_role NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);

-- 4. Add tenant_id to teams, tasks, projects
ALTER TABLE public.teams ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL;
ALTER TABLE public.projects ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL;

-- 5. Helper functions (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.is_tenant_member(_user_id uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE user_id = _user_id AND tenant_id = _tenant_id
  )
$$;

CREATE OR REPLACE FUNCTION public.get_tenant_role(_user_id uuid, _tenant_id uuid)
RETURNS tenant_role
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.tenant_members
  WHERE user_id = _user_id AND tenant_id = _tenant_id
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.get_user_tenant_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM public.tenant_members
  WHERE user_id = _user_id
  ORDER BY joined_at ASC
  LIMIT 1
$$;

-- 6. Trigger: auto-add creator as owner when tenant is created
CREATE OR REPLACE FUNCTION public.handle_new_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.tenant_members (tenant_id, user_id, role)
  VALUES (NEW.id, NEW.created_by, 'owner');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_tenant_created
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_tenant();

-- 7. Updated_at trigger for tenants
CREATE TRIGGER update_tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 8. Enable RLS
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;

-- 9. RLS for tenants
CREATE POLICY "Tenant members can view their tenant"
  ON public.tenants FOR SELECT
  USING (is_tenant_member(auth.uid(), id));

CREATE POLICY "Super admins can view all tenants"
  ON public.tenants FOR SELECT TO authenticated
  USING (is_super_admin());

CREATE POLICY "Authenticated users can create tenants"
  ON public.tenants FOR INSERT
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Tenant owners/admins can update tenant"
  ON public.tenants FOR UPDATE
  USING (get_tenant_role(auth.uid(), id) IN ('owner', 'admin'));

CREATE POLICY "Tenant owners can delete tenant"
  ON public.tenants FOR DELETE
  USING (get_tenant_role(auth.uid(), id) = 'owner');

-- 10. RLS for tenant_members
CREATE POLICY "Tenant members can view members of their tenant"
  ON public.tenant_members FOR SELECT
  USING (is_tenant_member(auth.uid(), tenant_id));

CREATE POLICY "Super admins can view all tenant members"
  ON public.tenant_members FOR SELECT TO authenticated
  USING (is_super_admin());

CREATE POLICY "Tenant owners/admins can add members"
  ON public.tenant_members FOR INSERT
  WITH CHECK (
    get_tenant_role(auth.uid(), tenant_id) IN ('owner', 'admin')
    OR auth.uid() = user_id
  );

CREATE POLICY "Tenant owners/admins can update members"
  ON public.tenant_members FOR UPDATE
  USING (get_tenant_role(auth.uid(), tenant_id) IN ('owner', 'admin'));

CREATE POLICY "Tenant owners/admins can remove members"
  ON public.tenant_members FOR DELETE
  USING (
    get_tenant_role(auth.uid(), tenant_id) IN ('owner', 'admin')
    OR auth.uid() = user_id
  );

-- 11. Additional RLS for teams with tenant_id
CREATE POLICY "Tenant members can view tenant teams"
  ON public.teams FOR SELECT
  USING (tenant_id IS NOT NULL AND is_tenant_member(auth.uid(), tenant_id));

-- 12. Additional RLS for tasks with tenant_id
CREATE POLICY "Tenant members can view tenant tasks"
  ON public.tasks FOR SELECT
  USING (tenant_id IS NOT NULL AND is_tenant_member(auth.uid(), tenant_id));

-- 13. Guest cannot delete tasks (tenant tasks only)
CREATE POLICY "Guests cannot delete tenant tasks"
  ON public.tasks FOR DELETE
  USING (
    tenant_id IS NULL
    OR get_tenant_role(auth.uid(), tenant_id) IS DISTINCT FROM 'guest'
  );

-- 14. Additional RLS for projects with tenant_id
CREATE POLICY "Tenant members can view tenant projects"
  ON public.projects FOR SELECT
  USING (tenant_id IS NOT NULL AND is_tenant_member(auth.uid(), tenant_id));
