-- ============================================================================
-- 20260905000500 — Google Calendar: 1 app OAuth, N contas (por tenant)
-- ============================================================================
-- Cada tenant conecta a PRÓPRIA conta Google, com um único GOOGLE_CLIENT_ID do
-- EisenFlow. A conexão deixa de ser por usuário e passa a ser por
-- (user_id, tenant_id): o mesmo usuário pode ter contas Google diferentes em
-- tenants diferentes.
--
-- O que muda aqui:
--   * google_calendar_tokens.tenant_id NOT NULL → tenants(id) ON DELETE CASCADE
--     (banco nasce vazio; não há linha sem tenant para migrar).
--   * UNIQUE (user_id) → UNIQUE (user_id, tenant_id); índice em tenant_id.
--   * RLS: além de ser dono da linha, o usuário precisa ser membro do tenant.
--   * is_revoked / revoked_at / revoked_reason garantidos (já vinham de
--     20260902195400, mas com ADD IF NOT EXISTS custa nada).
--   * As colunas *_encrypted/encryption_method/vault_key_id da migration
--     20260902194454 são removidas: o porte cifra os tokens NA FUNCTION
--     (AES-256-GCM, GOOGLE_TOKENS_ENCRYPTION_KEY) e guarda o blob base64 em
--     access_token/refresh_token. Ter dois esquemas de cifra convivendo é o
--     mesmo erro do totp_secret. A policy "Encrypted tokens require decryption"
--     (que dependia de access_token IS NULL) cai junto.
--   * google_token_audit_log: ganha tenant_id e created_at, e passa a ser
--     SÓ service_role — auditoria é escrita pelas functions; o usuário não
--     precisa (nem deve) enxergar IP/user-agent de eventos passados via API.
--
-- Os tokens continuam legíveis pelo dono da linha via PostgREST, mas são
-- ciphertext sem a chave (que só a edge-runtime tem). Se o front nunca
-- precisar ler esta tabela (o porte expõe `status` na function), o próximo
-- passo é REVOKE SELECT para authenticated — não feito aqui para não quebrar
-- `select('*')` do front sem aviso.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Estrutura
-- ---------------------------------------------------------------------------
ALTER TABLE public.google_calendar_tokens
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

-- Banco vazio: pode virar NOT NULL direto. Se algum dia houver linha órfã,
-- este ALTER falha de propósito — melhor que uma conexão sem tenant.
ALTER TABLE public.google_calendar_tokens
  ALTER COLUMN tenant_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'google_calendar_tokens_tenant_id_fkey'
      AND conrelid = 'public.google_calendar_tokens'::regclass
  ) THEN
    ALTER TABLE public.google_calendar_tokens
      ADD CONSTRAINT google_calendar_tokens_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
  END IF;
END
$$;

-- UNIQUE (user_id) → UNIQUE (user_id, tenant_id)
ALTER TABLE public.google_calendar_tokens
  DROP CONSTRAINT IF EXISTS google_calendar_tokens_user_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'google_calendar_tokens_user_id_tenant_id_key'
      AND conrelid = 'public.google_calendar_tokens'::regclass
  ) THEN
    ALTER TABLE public.google_calendar_tokens
      ADD CONSTRAINT google_calendar_tokens_user_id_tenant_id_key UNIQUE (user_id, tenant_id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_google_calendar_tokens_tenant_id
  ON public.google_calendar_tokens(tenant_id);

-- Revogação (invalid_grant → google_reconnect_required no front)
ALTER TABLE public.google_calendar_tokens
  ADD COLUMN IF NOT EXISTS is_revoked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_reason text;

-- is_revoked veio de 20260902195400 como NULLable; a function trata como boolean.
ALTER TABLE public.google_calendar_tokens
  ALTER COLUMN is_revoked SET DEFAULT false;
UPDATE public.google_calendar_tokens SET is_revoked = false WHERE is_revoked IS NULL;
ALTER TABLE public.google_calendar_tokens
  ALTER COLUMN is_revoked SET NOT NULL;

-- Cifra em duplicidade (ver cabeçalho): some.
DROP POLICY IF EXISTS "Encrypted tokens require decryption" ON public.google_calendar_tokens;
ALTER TABLE public.google_calendar_tokens
  DROP COLUMN IF EXISTS access_token_encrypted,
  DROP COLUMN IF EXISTS refresh_token_encrypted,
  DROP COLUMN IF EXISTS encryption_method,
  DROP COLUMN IF EXISTS vault_key_id;
DROP TYPE IF EXISTS public.token_encryption_method;

COMMENT ON COLUMN public.google_calendar_tokens.access_token IS
  'Blob AES-256-GCM montado pela function (base64: iv[12] + tag[16] + ciphertext). Chave: GOOGLE_TOKENS_ENCRYPTION_KEY na edge-runtime.';
COMMENT ON COLUMN public.google_calendar_tokens.refresh_token IS
  'Blob AES-256-GCM (mesmo formato de access_token).';
COMMENT ON COLUMN public.google_calendar_tokens.tenant_id IS
  'Tenant dono da conexão. A chave lógica é (user_id, tenant_id).';

-- ---------------------------------------------------------------------------
-- 2. RLS: dono da linha E membro do tenant
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their own google tokens" ON public.google_calendar_tokens;
DROP POLICY IF EXISTS "Users can insert their own google tokens" ON public.google_calendar_tokens;
DROP POLICY IF EXISTS "Users can update their own google tokens" ON public.google_calendar_tokens;
DROP POLICY IF EXISTS "Users can delete their own google tokens" ON public.google_calendar_tokens;
DROP POLICY IF EXISTS "Super admins can view all google tokens" ON public.google_calendar_tokens;

DROP POLICY IF EXISTS "Tenant members can view their own google tokens" ON public.google_calendar_tokens;
CREATE POLICY "Tenant members can view their own google tokens"
  ON public.google_calendar_tokens FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id AND public.is_tenant_member(auth.uid(), tenant_id));

DROP POLICY IF EXISTS "Tenant members can insert their own google tokens" ON public.google_calendar_tokens;
CREATE POLICY "Tenant members can insert their own google tokens"
  ON public.google_calendar_tokens FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.is_tenant_member(auth.uid(), tenant_id));

DROP POLICY IF EXISTS "Tenant members can update their own google tokens" ON public.google_calendar_tokens;
CREATE POLICY "Tenant members can update their own google tokens"
  ON public.google_calendar_tokens FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id AND public.is_tenant_member(auth.uid(), tenant_id))
  WITH CHECK (auth.uid() = user_id AND public.is_tenant_member(auth.uid(), tenant_id));

DROP POLICY IF EXISTS "Tenant members can delete their own google tokens" ON public.google_calendar_tokens;
CREATE POLICY "Tenant members can delete their own google tokens"
  ON public.google_calendar_tokens FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id AND public.is_tenant_member(auth.uid(), tenant_id));

DROP POLICY IF EXISTS "Service role full access" ON public.google_calendar_tokens;
CREATE POLICY "Service role full access"
  ON public.google_calendar_tokens FOR ALL
  TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.google_calendar_tokens FROM anon;

-- ---------------------------------------------------------------------------
-- 3. google_token_audit_log (user_id, tenant_id, action, ip_address,
--    user_agent, created_at) — só service_role
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.google_token_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  ip_address inet,
  user_agent text
);

ALTER TABLE public.google_token_audit_log
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- A migration de 02/09 chamava a coluna de `timestamp`; padronizamos em created_at.
ALTER TABLE public.google_token_audit_log DROP COLUMN IF EXISTS "timestamp";

-- ip_address como text: a function grava o primeiro item de x-forwarded-for
-- sem validar, e um valor fora do formato inet derrubaria o INSERT de
-- auditoria (que roda em try/catch e seria perdido em silêncio).
ALTER TABLE public.google_token_audit_log
  ALTER COLUMN ip_address TYPE text USING ip_address::text;

CREATE INDEX IF NOT EXISTS idx_google_token_audit_log_user ON public.google_token_audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_google_token_audit_log_tenant ON public.google_token_audit_log(tenant_id, created_at DESC);

ALTER TABLE public.google_token_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own audit logs" ON public.google_token_audit_log;
DROP POLICY IF EXISTS "Service role full access" ON public.google_token_audit_log;
CREATE POLICY "Service role full access"
  ON public.google_token_audit_log FOR ALL
  TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.google_token_audit_log FROM anon, authenticated;

-- log_token_operation (02/09) deixava qualquer usuário autenticado escrever no
-- audit log; as functions gravam direto com service_role.
DROP FUNCTION IF EXISTS public.log_token_operation(text, inet, text);

COMMENT ON TABLE public.google_token_audit_log IS
  'Auditoria de connect/refresh/revoke do Google por (user, tenant). Escrita só pelas functions.';
