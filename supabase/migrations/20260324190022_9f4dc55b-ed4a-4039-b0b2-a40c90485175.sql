
-- Function to auto-create personal tenant when a profile is created
CREATE OR REPLACE FUNCTION public.handle_new_user_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.tenants (name, slug, created_by)
  VALUES (
    COALESCE(NEW.display_name, 'Meu Workspace'),
    NEW.user_id::text,
    NEW.user_id
  );
  RETURN NEW;
END;
$$;

-- Trigger on profiles table
CREATE TRIGGER on_profile_created_create_tenant
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_tenant();

-- Backfill: create personal tenants for existing users without one
INSERT INTO public.tenants (name, slug, created_by)
SELECT 
  COALESCE(p.display_name, 'Meu Workspace'),
  p.user_id::text,
  p.user_id
FROM public.profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM public.tenant_members tm WHERE tm.user_id = p.user_id
);
