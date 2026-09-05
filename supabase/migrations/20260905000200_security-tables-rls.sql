-- ============================================================================
-- 20260905000200 — RLS nas três tabelas de segurança criadas sem RLS
-- ============================================================================
-- As migrations de 02/09 criaram `suspicious_ips` (ip-validation),
-- `admin_2fa_enforcement` e `failed_2fa_attempts` (2fa-setup) sem
-- ENABLE ROW LEVEL SECURITY. Como o Supabase dá GRANT ALL em toda tabela nova
-- de `public` para anon/authenticated (default privileges), elas ficavam
-- legíveis E graváveis por qualquer usuário autenticado — e a `suspicious_ips`
-- até por anônimos.
--
-- Política mínima:
--   suspicious_ips ......... só service_role (lista global, não é por tenant).
--   admin_2fa_enforcement .. membros do tenant leem; owner/admin gravam.
--   failed_2fa_attempts .... o usuário vê as próprias tentativas; ninguém
--                            insere direto (só via log_failed_2fa_attempt).
-- service_role já tem BYPASSRLS; a policy explícita é documentação viva.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- suspicious_ips
-- ---------------------------------------------------------------------------
ALTER TABLE public.suspicious_ips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON public.suspicious_ips;
CREATE POLICY "Service role full access"
  ON public.suspicious_ips FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- Sem policy para authenticated/anon: com RLS ligado, nada passa.
-- Tira também os privilégios de tabela para não depender só da RLS.
REVOKE ALL ON public.suspicious_ips FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- admin_2fa_enforcement
-- ---------------------------------------------------------------------------
ALTER TABLE public.admin_2fa_enforcement ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view 2fa enforcement" ON public.admin_2fa_enforcement;
CREATE POLICY "Tenant members can view 2fa enforcement"
  ON public.admin_2fa_enforcement FOR SELECT
  TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));

DROP POLICY IF EXISTS "Tenant admins can insert 2fa enforcement" ON public.admin_2fa_enforcement;
CREATE POLICY "Tenant admins can insert 2fa enforcement"
  ON public.admin_2fa_enforcement FOR INSERT
  TO authenticated
  WITH CHECK (public.is_tenant_admin(auth.uid(), tenant_id));

DROP POLICY IF EXISTS "Tenant admins can update 2fa enforcement" ON public.admin_2fa_enforcement;
CREATE POLICY "Tenant admins can update 2fa enforcement"
  ON public.admin_2fa_enforcement FOR UPDATE
  TO authenticated
  USING (public.is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (public.is_tenant_admin(auth.uid(), tenant_id));

DROP POLICY IF EXISTS "Tenant admins can delete 2fa enforcement" ON public.admin_2fa_enforcement;
CREATE POLICY "Tenant admins can delete 2fa enforcement"
  ON public.admin_2fa_enforcement FOR DELETE
  TO authenticated
  USING (public.is_tenant_admin(auth.uid(), tenant_id));

DROP POLICY IF EXISTS "Service role full access" ON public.admin_2fa_enforcement;
CREATE POLICY "Service role full access"
  ON public.admin_2fa_enforcement FOR ALL
  TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.admin_2fa_enforcement FROM anon;

-- ---------------------------------------------------------------------------
-- failed_2fa_attempts
-- ---------------------------------------------------------------------------
ALTER TABLE public.failed_2fa_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own failed 2fa attempts" ON public.failed_2fa_attempts;
CREATE POLICY "Users can view their own failed 2fa attempts"
  ON public.failed_2fa_attempts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access" ON public.failed_2fa_attempts;
CREATE POLICY "Service role full access"
  ON public.failed_2fa_attempts FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- Escrita só pela função SECURITY DEFINER (log_failed_2fa_attempt).
REVOKE ALL ON public.failed_2fa_attempts FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.failed_2fa_attempts FROM authenticated;
