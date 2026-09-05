-- ============================================================================
-- 20260905000700 — Tenant pessoal no signup: a cadeia de triggers funciona
--                  num Supabase self-hosted
-- ============================================================================
-- Cadeia existente (nada disto é novo):
--   auth.users INSERT
--     → on_auth_user_created ........ public.handle_new_user()         (20260311173629)
--       → profiles INSERT
--         → on_profile_created_create_tenant → handle_new_user_tenant() (20260324190022)
--           → tenants INSERT (slug = user_id)
--             → on_tenant_created → handle_new_tenant()               (20260324175343)
--               → tenant_members (role 'owner')
--
-- Trigger em auth.users é permitido no self-hosted: `postgres` recebe TRIGGER
-- (entre outros) em auth.users via default privileges do GoTrue — só não
-- pode ALTERar a tabela. Quem insere é o GoTrue, como supabase_auth_admin;
-- as três funções são SECURITY DEFINER (dono: postgres), então o INSERT em
-- profiles/tenants/tenant_members roda com os privilégios do postgres, e o
-- Postgres NÃO exige EXECUTE de quem dispara o trigger (o REVOKE ... FROM
-- PUBLIC de 20260603143925 não atrapalha — verificado em teste).
--
-- O que esta migration garante:
--   1. handle_new_user_tenant idempotente: se o tenant pessoal já existir
--      (slug = user_id), não estoura UNIQUE e não derruba o signup com
--      "Database error saving new user".
--   2. Asserções de que is_tenant_member / get_tenant_role / is_tenant_admin
--      (e as equivalentes de team) são SECURITY DEFINER: a policy "Tenant
--      members can view their tenant" chama is_tenant_member, que lê
--      tenant_members, cuja policy chama is_tenant_member de novo — sem
--      SECURITY DEFINER isso vira recursão infinita de RLS. O `db reset`
--      falha aqui se alguém recriar uma delas sem isso.
--   3. Os dois triggers da cadeia existem.
-- ============================================================================

-- handle_new_user_tenant: idempotente. Se por qualquer motivo o tenant pessoal
-- já existir (slug = user_id), não estoura UNIQUE e não derruba o signup.
CREATE OR REPLACE FUNCTION public.handle_new_user_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenants WHERE slug = NEW.user_id::text) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.tenants (name, slug, created_by)
  VALUES (
    COALESCE(NULLIF(trim(NEW.display_name), ''), 'Meu Workspace'),
    NEW.user_id::text,
    NEW.user_id
  );
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_tenant() FROM anon, authenticated, PUBLIC;

-- Garantia estrutural: as funções usadas nas policies de tenants/tenant_members
-- precisam ser SECURITY DEFINER (ver cabeçalho). Falha o db reset se alguém
-- as recriar sem isso.
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.is_tenant_member(uuid, uuid)',
    'public.get_tenant_role(uuid, uuid)',
    'public.is_tenant_admin(uuid, uuid)',
    'public.get_user_tenant_id(uuid)',
    'public.is_team_member(uuid, uuid)',
    'public.get_team_role(uuid, uuid)',
    'public.is_super_admin()'
  ] LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) THEN
      RAISE EXCEPTION 'A função % precisa ser SECURITY DEFINER (usada em policies de RLS; sem isso há recursão).', f;
    END IF;
  END LOOP;
END
$$;

-- O trigger que cria o tenant pessoal precisa continuar existindo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'on_profile_created_create_tenant'
      AND tgrelid = 'public.profiles'::regclass
  ) THEN
    CREATE TRIGGER on_profile_created_create_tenant
      AFTER INSERT ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_tenant();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'on_auth_user_created'
      AND tgrelid = 'auth.users'::regclass
  ) THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END
$$;
