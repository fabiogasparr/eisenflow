-- ============================================================================
-- 20260905000800 — Privilégios das funções das migrations de 02/09
-- ============================================================================
-- No Supabase, toda função criada em `public` nasce com EXECUTE para anon,
-- authenticated e service_role (default privileges). As migrations de 02/09
-- (rate limit, IP, token rotation) criaram funções SECURITY DEFINER sem
-- REVOKE, várias delas recebendo o alvo (user_id, api_key, IP) por parâmetro.
-- Resultado, via PostgREST /rpc:
--   * anon podia chamar block_ip_address(<qualquer IP>) e block_api_key(...)
--     → negação de serviço trivial;
--   * authenticated podia chamar revoke_all_user_tokens(<outro usuário>) e
--     log_token_rotation(<outro usuário>, ...) e cleanup_expired_tokens();
--   * check_rate_limit / refill_rate_limit_tokens consumiam tokens de
--     qualquer api_key.
-- Todas essas são chamadas pelo SERVIDOR (hermes-mcp com service_role). Aqui
-- ficam só para service_role; as que fazem sentido para o usuário sobre si
-- mesmo ganham o guard auth.uid() = p_user_id.
--
-- De quebra: o CHECK de token_rotation_log.token_type só aceitava
-- 'access'/'refresh', mas revoke_all_user_tokens grava 'all' e
-- cleanup_expired_tokens grava 'session' — as duas funções falhavam sempre.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Rate limit (20260902195000): só servidor
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.refill_rate_limit_tokens(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, integer, inet) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_rate_limit_event(text, text, text, rate_limit_status, integer, inet, text, text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.block_api_key(text, text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.block_ip_address(inet, interval) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.refill_rate_limit_tokens(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, inet) TO service_role;
GRANT EXECUTE ON FUNCTION public.log_rate_limit_event(text, text, text, rate_limit_status, integer, inet, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.block_api_key(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.block_ip_address(inet, interval) TO service_role;

-- As tabelas de rate limit nasceram sem RLS e com GRANT ALL para anon/authenticated.
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_ips     ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limit_buckets, public.rate_limit_events, public.rate_limit_ips FROM anon, authenticated;

DROP POLICY IF EXISTS "Service role full access" ON public.rate_limit_buckets;
CREATE POLICY "Service role full access" ON public.rate_limit_buckets FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access" ON public.rate_limit_events;
CREATE POLICY "Service role full access" ON public.rate_limit_events FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access" ON public.rate_limit_ips;
CREATE POLICY "Service role full access" ON public.rate_limit_ips FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Admin do tenant pode ver o bucket da própria chave (sem alterar).
DROP POLICY IF EXISTS "Tenant admins can view their rate limit buckets" ON public.rate_limit_buckets;
CREATE POLICY "Tenant admins can view their rate limit buckets"
  ON public.rate_limit_buckets FOR SELECT
  TO authenticated
  USING (tenant_id IS NOT NULL AND public.is_tenant_admin(auth.uid(), tenant_id));
GRANT SELECT ON public.rate_limit_buckets TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. IP (20260902195200)
-- ---------------------------------------------------------------------------
-- is_ip_allowed/log_ip_access/report_suspicious_ip são decisões do servidor
-- (hermes-mcp). Um cliente não tem por que "reportar IP suspeito" nem gravar
-- log de acesso de um tenant arbitrário.
REVOKE EXECUTE ON FUNCTION public.is_ip_allowed(uuid, inet) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_ip_access(uuid, inet, text, text, boolean, text, text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.report_suspicious_ip(inet, text, text) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_ip_allowed(uuid, inet) TO service_role;
GRANT EXECUTE ON FUNCTION public.log_ip_access(uuid, inet, text, text, boolean, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.report_suspicious_ip(inet, text, text) TO service_role;

-- report_suspicious_ip fazia GREATEST() em texto ('low' > 'high' alfabeticamente).
CREATE OR REPLACE FUNCTION public.report_suspicious_ip(
  p_ip_address inet,
  p_threat_level text,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rank CONSTANT text[] := ARRAY['low', 'medium', 'high', 'critical'];
BEGIN
  IF NOT (p_threat_level = ANY(v_rank)) THEN
    RAISE EXCEPTION 'threat_level inválido: %', p_threat_level;
  END IF;
  INSERT INTO public.suspicious_ips (ip_address, threat_level, reason)
  VALUES (p_ip_address, p_threat_level, p_reason)
  ON CONFLICT (ip_address) DO UPDATE
    SET threat_level = CASE
          WHEN array_position(v_rank, EXCLUDED.threat_level) > array_position(v_rank, suspicious_ips.threat_level)
          THEN EXCLUDED.threat_level ELSE suspicious_ips.threat_level END,
        reason = EXCLUDED.reason,
        failed_attempts = suspicious_ips.failed_attempts + 1,
        updated_at = now();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.report_suspicious_ip(inet, text, text) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_suspicious_ip(inet, text, text) TO service_role;

-- ip_access_log: só o servidor escreve (a policy só cobria SELECT).
REVOKE INSERT, UPDATE, DELETE ON public.ip_access_log FROM anon, authenticated;
REVOKE ALL ON public.ip_access_log FROM anon;
DROP POLICY IF EXISTS "Service role full access" ON public.ip_access_log;
CREATE POLICY "Service role full access" ON public.ip_access_log FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access" ON public.ip_whitelist;
CREATE POLICY "Service role full access" ON public.ip_whitelist FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.ip_whitelist FROM anon;

-- ---------------------------------------------------------------------------
-- 3. Token rotation (20260902195400)
-- ---------------------------------------------------------------------------
ALTER TABLE public.token_rotation_log DROP CONSTRAINT IF EXISTS token_rotation_log_token_type_check;
ALTER TABLE public.token_rotation_log
  ADD CONSTRAINT token_rotation_log_token_type_check
  CHECK (token_type IN ('access', 'refresh', 'session', 'all'));

REVOKE EXECUTE ON FUNCTION public.cleanup_expired_tokens() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.detect_token_reuse_attack(text, inet, text) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_tokens() TO service_role;
GRANT EXECUTE ON FUNCTION public.detect_token_reuse_attack(text, inet, text) TO service_role;

-- Sobre si mesmo: ok. Sobre outro usuário: só service_role.
CREATE OR REPLACE FUNCTION public.log_token_rotation(
  p_user_id uuid,
  p_token_type text,
  p_action text,
  p_token_family text DEFAULT NULL,
  p_generation integer DEFAULT NULL,
  p_ip_address inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'não é permitido registrar rotação de token de outro usuário' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.token_rotation_log (
    user_id, token_type, action, token_family, generation,
    ip_address, user_agent, reason
  ) VALUES (
    p_user_id, p_token_type, p_action, p_token_family, p_generation,
    p_ip_address, p_user_agent, p_reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_all_user_tokens(
  p_user_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'não é permitido revogar tokens de outro usuário' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.google_calendar_tokens
  SET is_revoked = true,
      revoked_at = now(),
      revoked_reason = COALESCE(p_reason, 'revogação em massa'),
      updated_at = now()
  WHERE user_id = p_user_id;

  UPDATE public.session_tokens
  SET is_revoked = true,
      revoked_at = now()
  WHERE user_id = p_user_id;

  PERFORM public.log_token_rotation(
    p_user_id, 'all', 'revoked', NULL, NULL, NULL, NULL,
    COALESCE(p_reason, '') || ' (bulk revocation)'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_refresh_token_expired(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expires_at timestamptz;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'não é permitido consultar tokens de outro usuário' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Multi-tenant: vale "algum refresh_token do usuário expirou".
  SELECT min(refresh_token_expires_at) INTO v_expires_at
  FROM public.google_calendar_tokens
  WHERE user_id = p_user_id AND NOT is_revoked;
  RETURN v_expires_at IS NOT NULL AND v_expires_at < now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_token_rotation(uuid, text, text, text, integer, inet, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revoke_all_user_tokens(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_refresh_token_expired(uuid) FROM anon, PUBLIC;

-- session_tokens / token_rotation_log: escrita só pelo servidor ou pelas funções.
REVOKE ALL ON public.session_tokens, public.token_rotation_log FROM anon;
REVOKE INSERT, DELETE ON public.session_tokens FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.token_rotation_log FROM authenticated;
DROP POLICY IF EXISTS "Service role full access" ON public.session_tokens;
CREATE POLICY "Service role full access" ON public.session_tokens FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Service role full access" ON public.token_rotation_log;
CREATE POLICY "Service role full access" ON public.token_rotation_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 4. Funções de trigger sem search_path fixo (linter do Supabase)
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.check_token_expiration_on_access() SET search_path = public;
ALTER FUNCTION public.is_valid_totp_format(text) SET search_path = public;
ALTER FUNCTION public.user_has_2fa_enabled(uuid) SET search_path = public;
ALTER FUNCTION public.detect_token_reuse_attack(text, inet, text) SET search_path = public;
ALTER FUNCTION public.cleanup_expired_tokens() SET search_path = public;
ALTER FUNCTION public.is_ip_allowed(uuid, inet) SET search_path = public;
ALTER FUNCTION public.log_ip_access(uuid, inet, text, text, boolean, text, text) SET search_path = public;
ALTER FUNCTION public.refill_rate_limit_tokens(uuid) SET search_path = public;
ALTER FUNCTION public.check_rate_limit(text, integer, inet) SET search_path = public;
ALTER FUNCTION public.log_rate_limit_event(text, text, text, rate_limit_status, integer, inet, text, text) SET search_path = public;
ALTER FUNCTION public.block_api_key(text, text) SET search_path = public;
ALTER FUNCTION public.block_ip_address(inet, interval) SET search_path = public;
