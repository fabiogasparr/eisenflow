-- ============================================================================
-- 20260905000300 — Segredos TOTP cifrados com chave do servidor
-- ============================================================================
-- Defeito original (2fa-setup + a migration de tokens do Google):
--   * `user_2fa.totp_secret` em TEXTO PLANO coexistia com
--     `totp_secret_encrypted`; o front gravava e lia o texto plano.
--   * `backup_codes text[]` idem, em texto plano.
--   * As funções encrypt_token/decrypt_token recebiam a chave como parâmetro
--     e a única chamada usava a literal 'REPLACE_WITH_VAULT_KEY'. decrypt_token
--     tinha GRANT para authenticated — qualquer usuário decifrava qualquer
--     blob se soubesse a chave.
--
-- Desenho novo:
--   * A chave mestra vive numa configuração do banco, nunca no código:
--         ALTER DATABASE postgres SET app.settings.encryption_key = '<32+ bytes aleatórios>';
--     (self-hosted: rodar como supabase_admin; vale para sessões novas — reinicie
--     o PostgREST/edge-runtime ou espere as conexões reciclarem.)
--   * app_encrypt/app_decrypt (pgp_sym_encrypt, AES-256 + salt) leem a chave
--     via current_setting('app.settings.encryption_key', true) e FALHAM com
--     mensagem clara se ela não estiver definida. Só service_role/postgres
--     executam.
--   * O segredo TOTP nunca sai do banco: set_user_2fa_secret grava cifrado,
--     verify_user_totp valida o código dentro do Postgres (HMAC-SHA1 via
--     pgcrypto, RFC 6238, janela ±1 passo) e registra falhas em
--     failed_2fa_attempts. Códigos de recuperação viram hash SHA-256.
--   * As colunas em texto plano são removidas. Banco vazio: nada a migrar.
--
-- Nota: o GoTrue self-hosted já tem MFA TOTP nativo (auth.mfa_factors). Se o
-- produto adotar o MFA nativo, esta tabela inteira pode ser aposentada; até lá,
-- este é o mínimo para ela não ser um vazamento.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Chave mestra + cifra simétrica
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_encryption_key()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  v_key := current_setting('app.settings.encryption_key', true);
  IF v_key IS NULL OR length(v_key) < 32 THEN
    RAISE EXCEPTION 'app.settings.encryption_key não definida (ou menor que 32 caracteres). '
      'Rode como supabase_admin: ALTER DATABASE postgres SET app.settings.encryption_key = ''<segredo>'';'
      USING ERRCODE = 'config_file_error';
  END IF;
  RETURN v_key;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.app_encryption_key() FROM anon, authenticated, PUBLIC;

CREATE OR REPLACE FUNCTION public.app_encrypt(p_plain text)
RETURNS bytea
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT CASE
    WHEN p_plain IS NULL THEN NULL
    ELSE pgp_sym_encrypt(p_plain, public.app_encryption_key(), 'cipher-algo=aes256')
  END;
$$;

CREATE OR REPLACE FUNCTION public.app_decrypt(p_cipher bytea)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT CASE
    WHEN p_cipher IS NULL THEN NULL
    ELSE pgp_sym_decrypt(p_cipher, public.app_encryption_key())
  END;
$$;

-- Só o servidor cifra/decifra. O front nunca vê o segredo.
REVOKE EXECUTE ON FUNCTION public.app_encrypt(text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_decrypt(bytea) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_encrypt(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.app_decrypt(bytea) TO service_role;

-- As antigas, com chave por parâmetro e a literal 'REPLACE_WITH_VAULT_KEY':
DROP FUNCTION IF EXISTS public.encrypt_token(text, text);
DROP FUNCTION IF EXISTS public.decrypt_token(bytea, text);

-- ---------------------------------------------------------------------------
-- 2. user_2fa: some o texto plano
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_2fa DROP COLUMN IF EXISTS totp_secret;
ALTER TABLE public.user_2fa DROP COLUMN IF EXISTS backup_codes;
ALTER TABLE public.user_2fa DROP COLUMN IF EXISTS backup_codes_encrypted;
ALTER TABLE public.user_2fa ADD COLUMN IF NOT EXISTS backup_code_hashes text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.user_2fa.totp_secret_encrypted IS
  'Segredo TOTP (base32) cifrado por app_encrypt(). Nunca é devolvido ao cliente; use verify_user_totp().';
COMMENT ON COLUMN public.user_2fa.backup_code_hashes IS
  'SHA-256 (hex) de cada código de recuperação ainda não usado.';

-- O usuário pode ver o próprio status (is_enabled etc.), mas não precisa
-- inserir/alterar o segredo direto: as funções abaixo fazem isso.
DROP POLICY IF EXISTS "Users can update their own 2FA settings" ON public.user_2fa;
CREATE POLICY "Users can update their own 2FA settings"
  ON public.user_2fa FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own 2FA settings" ON public.user_2fa;
CREATE POLICY "Users can delete their own 2FA settings"
  ON public.user_2fa FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access" ON public.user_2fa;
CREATE POLICY "Service role full access"
  ON public.user_2fa FOR ALL
  TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.user_2fa FROM anon;
REVOKE INSERT ON public.user_2fa FROM authenticated;      -- só via set_user_2fa_secret
-- Mesmo com RLS, o usuário não deve conseguir trocar o segredo por UPDATE direto:
-- privilégio de UPDATE só nas colunas de status (o REVOKE de tabela é
-- necessário porque privilégio de coluna não "subtrai" do de tabela).
REVOKE UPDATE ON public.user_2fa FROM authenticated;
GRANT UPDATE (is_enabled, enabled_at, setup_verified_at, last_used_at) ON public.user_2fa TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. TOTP (RFC 6238) dentro do Postgres
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.base32_decode(p_text text)
RETURNS bytea
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  s     text    := upper(regexp_replace(p_text, '[\s=-]', '', 'g'));
  bits  int     := 0;
  buf   int     := 0;
  outb  bytea   := '\x'::bytea;
  ch    text;
  v     int;
  i     int;
BEGIN
  FOR i IN 1..length(s) LOOP
    ch := substr(s, i, 1);
    v  := position(ch IN alphabet) - 1;
    IF v < 0 THEN
      RAISE EXCEPTION 'base32 inválido: caractere "%"', ch;
    END IF;
    buf  := (buf << 5) | v;
    bits := bits + 5;
    IF bits >= 8 THEN
      bits := bits - 8;
      outb := outb || set_byte('\x00'::bytea, 0, (buf >> bits) & 255);
      buf  := buf & ((1 << bits) - 1);
    END IF;
  END LOOP;
  RETURN outb;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.base32_decode(text) FROM anon, authenticated, PUBLIC;

-- Código de 6 dígitos para um contador (passo de 30 s). Separado de now() para
-- ser testável com os vetores da RFC.
CREATE OR REPLACE FUNCTION public.totp_code(p_secret_base32 text, p_counter bigint)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $$
DECLARE
  h bytea;
  o int;
  v bigint;
BEGIN
  -- int8send = 8 bytes big-endian, exatamente o "T" da RFC 4226/6238.
  h := hmac(int8send(p_counter), public.base32_decode(p_secret_base32), 'sha1');
  o := get_byte(h, 19) & 15;
  v := ((get_byte(h, o) & 127)::bigint << 24)
     | (get_byte(h, o + 1)::bigint << 16)
     | (get_byte(h, o + 2)::bigint << 8)
     |  get_byte(h, o + 3)::bigint;
  RETURN lpad((v % 1000000)::text, 6, '0');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.totp_code(text, bigint) FROM anon, authenticated, PUBLIC;

-- Inicia (ou reinicia) a configuração de 2FA do usuário logado. O segredo entra
-- cifrado; os códigos de recuperação entram como hash. is_enabled fica false até
-- o usuário provar que o app gera códigos válidos (verify_user_totp).
CREATE OR REPLACE FUNCTION public.set_user_2fa_secret(p_secret_base32 text, p_backup_codes text[] DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_hashes text[] := '{}';
  c text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'não autenticado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_secret_base32 IS NULL OR length(public.base32_decode(p_secret_base32)) < 10 THEN
    RAISE EXCEPTION 'segredo TOTP inválido (base32, mínimo 80 bits)';
  END IF;
  IF p_backup_codes IS NOT NULL THEN
    FOREACH c IN ARRAY p_backup_codes LOOP
      v_hashes := array_append(v_hashes, encode(digest(c, 'sha256'), 'hex'));
    END LOOP;
  END IF;

  INSERT INTO public.user_2fa (user_id, is_enabled, totp_secret_encrypted, backup_code_hashes, setup_verified_at, enabled_at)
  VALUES (v_uid, false, public.app_encrypt(p_secret_base32), v_hashes, NULL, NULL)
  ON CONFLICT (user_id) DO UPDATE
    SET is_enabled = false,
        totp_secret_encrypted = EXCLUDED.totp_secret_encrypted,
        backup_code_hashes = EXCLUDED.backup_code_hashes,
        setup_verified_at = NULL,
        enabled_at = NULL,
        updated_at = now();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_user_2fa_secret(text, text[]) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_user_2fa_secret(text, text[]) TO authenticated, service_role;

-- Valida um código TOTP do usuário logado. Falhas vão para failed_2fa_attempts;
-- 5 falhas em 15 minutos bloqueiam novas tentativas até a janela passar.
CREATE OR REPLACE FUNCTION public.verify_user_totp(p_code text, p_ip_address inet DEFAULT NULL, p_user_agent text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_secret  text;
  v_counter bigint;
  v_ok      boolean := false;
  i         int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;
  IF p_code IS NULL OR p_code !~ '^\d{6}$' THEN
    RETURN false;
  END IF;
  IF public.get_failed_2fa_attempts(v_uid, 15) >= 5 THEN
    RAISE EXCEPTION 'muitas tentativas de 2FA; aguarde 15 minutos';
  END IF;

  SELECT public.app_decrypt(totp_secret_encrypted) INTO v_secret
  FROM public.user_2fa WHERE user_id = v_uid;
  IF v_secret IS NULL THEN
    RETURN false;
  END IF;

  v_counter := floor(extract(epoch FROM now()) / 30)::bigint;
  FOR i IN -1..1 LOOP
    IF public.totp_code(v_secret, v_counter + i) = p_code THEN
      v_ok := true;
      EXIT;
    END IF;
  END LOOP;

  IF v_ok THEN
    UPDATE public.user_2fa
       SET last_used_at = now(),
           setup_verified_at = COALESCE(setup_verified_at, now()),
           updated_at = now()
     WHERE user_id = v_uid;
  ELSE
    INSERT INTO public.failed_2fa_attempts (user_id, ip_address, user_agent)
    VALUES (v_uid, p_ip_address, p_user_agent);
  END IF;
  RETURN v_ok;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.verify_user_totp(text, inet, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_user_totp(text, inet, text) TO authenticated, service_role;

-- Consome um código de recuperação (uso único).
CREATE OR REPLACE FUNCTION public.consume_user_backup_code(p_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_hash text;
  v_rows int;
BEGIN
  IF v_uid IS NULL OR p_code IS NULL OR length(p_code) = 0 THEN
    RETURN false;
  END IF;
  v_hash := encode(digest(p_code, 'sha256'), 'hex');
  UPDATE public.user_2fa
     SET backup_code_hashes = array_remove(backup_code_hashes, v_hash),
         last_used_at = now(),
         updated_at = now()
   WHERE user_id = v_uid
     AND v_hash = ANY(backup_code_hashes);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    INSERT INTO public.failed_2fa_attempts (user_id) VALUES (v_uid);
  END IF;
  RETURN v_rows > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.consume_user_backup_code(text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_user_backup_code(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. As funções de 02/09 que recebiam p_user_id de quem chamava
-- ---------------------------------------------------------------------------
-- log_failed_2fa_attempt(p_user_id) permitia a qualquer usuário "encher" o log
-- de outro; get_failed_2fa_attempts(p_user_id) lia o de qualquer um. Agora um
-- usuário comum só opera sobre si mesmo; service_role continua livre.
CREATE OR REPLACE FUNCTION public.log_failed_2fa_attempt(
  p_user_id uuid,
  p_ip_address inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'não é permitido registrar tentativa para outro usuário' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.failed_2fa_attempts (user_id, ip_address, user_agent)
  VALUES (p_user_id, p_ip_address, p_user_agent);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_failed_2fa_attempts(
  p_user_id uuid,
  p_minutes_back integer DEFAULT 30
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'não é permitido consultar tentativas de outro usuário' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT COUNT(*) INTO v_count FROM public.failed_2fa_attempts
  WHERE user_id = p_user_id
    AND timestamp > now() - (p_minutes_back || ' minutes')::interval;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.user_has_2fa_enabled(uuid) FROM anon;
