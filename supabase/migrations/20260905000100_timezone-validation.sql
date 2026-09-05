-- ============================================================================
-- 20260905000100 — Validação de fuso horário contra pg_timezone_names
-- ============================================================================
-- Substitui o CHECK `valid_timezone` da migration 20260902195100 (removido de
-- lá porque alterava auth.users e listava fusos inventados — ver o cabeçalho
-- daquela migration).
--
-- Por que trigger e não CHECK: um CHECK não pode conter subconsulta, e
-- embrulhar `EXISTS (SELECT 1 FROM pg_timezone_names ...)` numa função
-- IMMUTABLE seria mentir para o planner (a lista de fusos muda com o pacote
-- tzdata). Um trigger BEFORE INSERT OR UPDATE faz a mesma validação sem
-- fingir imutabilidade.
--
-- A mesma validação vale para TODAS as colunas `timezone` do schema:
-- user_preferences, user_reminder_preferences, recurring_schedules,
-- whatsapp_connections e tenant_whatsapp_connections. Um fuso inválido nessas
-- tabelas quebra o cron de lembretes em tempo de execução (`AT TIME ZONE`
-- lança erro), então vale barrar na entrada.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Função de validação (reutilizável em SQL e no front via RPC)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_valid_timezone(p_tz text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT p_tz IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_tz);
$$;

COMMENT ON FUNCTION public.is_valid_timezone(text) IS
  'true se p_tz é um nome IANA conhecido pelo Postgres (pg_timezone_names).';

GRANT EXECUTE ON FUNCTION public.is_valid_timezone(text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.is_valid_timezone(text) FROM anon;

-- ---------------------------------------------------------------------------
-- 2. Trigger genérico: valida a coluna `timezone` da linha
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_timezone_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Todas as tabelas alvo têm a coluna NOT NULL; se um dia alguma aceitar NULL,
  -- NULL passa (ausência de preferência não é fuso inválido).
  IF NEW.timezone IS NOT NULL AND NOT public.is_valid_timezone(NEW.timezone) THEN
    RAISE EXCEPTION 'Fuso horário inválido: "%". Use um nome IANA, ex.: America/Sao_Paulo', NEW.timezone
      USING ERRCODE = 'check_violation', CONSTRAINT = 'valid_timezone';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validate_timezone_column() FROM anon, authenticated, PUBLIC;

DROP TRIGGER IF EXISTS trg_validate_timezone ON public.user_preferences;
CREATE TRIGGER trg_validate_timezone
  BEFORE INSERT OR UPDATE OF timezone ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.validate_timezone_column();

DROP TRIGGER IF EXISTS trg_validate_timezone ON public.user_reminder_preferences;
CREATE TRIGGER trg_validate_timezone
  BEFORE INSERT OR UPDATE OF timezone ON public.user_reminder_preferences
  FOR EACH ROW EXECUTE FUNCTION public.validate_timezone_column();

DROP TRIGGER IF EXISTS trg_validate_timezone ON public.recurring_schedules;
CREATE TRIGGER trg_validate_timezone
  BEFORE INSERT OR UPDATE OF timezone ON public.recurring_schedules
  FOR EACH ROW EXECUTE FUNCTION public.validate_timezone_column();

DROP TRIGGER IF EXISTS trg_validate_timezone ON public.whatsapp_connections;
CREATE TRIGGER trg_validate_timezone
  BEFORE INSERT OR UPDATE OF timezone ON public.whatsapp_connections
  FOR EACH ROW EXECUTE FUNCTION public.validate_timezone_column();

DROP TRIGGER IF EXISTS trg_validate_timezone ON public.tenant_whatsapp_connections;
CREATE TRIGGER trg_validate_timezone
  BEFORE INSERT OR UPDATE OF timezone ON public.tenant_whatsapp_connections
  FOR EACH ROW EXECUTE FUNCTION public.validate_timezone_column();

-- ---------------------------------------------------------------------------
-- 3. user_preferences: o lugar oficial do fuso do usuário
-- ---------------------------------------------------------------------------
-- Defaults coerentes com o produto (pt-BR). O front sempre manda o fuso
-- detectado pelo navegador, então o default só vale para linhas criadas por
-- outros caminhos (ex.: functions).
ALTER TABLE public.user_preferences
  ALTER COLUMN timezone SET DEFAULT 'America/Sao_Paulo',
  ALTER COLUMN language SET DEFAULT 'pt-BR';

-- A PK é `id` (= auth.users.id) porque é assim que o front Supabase-nativo
-- (src/hooks/useTimezone.ts) consulta. O porte Appwrite chamava a mesma coisa
-- de `user_id`; a coluna gerada abaixo aceita as duas grafias sem duplicar dado.
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS user_id uuid GENERATED ALWAYS AS (id) STORED;

CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON public.user_preferences(user_id);

-- A migration original dava DELETE a ninguém; o usuário deve poder apagar as
-- próprias preferências (LGPD / reset de conta).
DROP POLICY IF EXISTS "Users can delete their own preferences" ON public.user_preferences;
CREATE POLICY "Users can delete their own preferences"
  ON public.user_preferences FOR DELETE
  TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Service role full access" ON public.user_preferences;
CREATE POLICY "Service role full access"
  ON public.user_preferences FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- get_user_timezone lê preferências de QUALQUER usuário (as functions precisam
-- disso para agendar lembretes); não faz sentido expor a anônimos.
REVOKE EXECUTE ON FUNCTION public.get_user_timezone(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.convert_to_user_timezone(timestamptz, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.convert_to_utc(timestamptz, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.start_of_day_user_tz(date, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.end_of_day_user_tz(date, uuid) FROM anon;

COMMENT ON COLUMN public.user_preferences.timezone IS
  'Fuso IANA do usuário (validado por trigger contra pg_timezone_names). Substitui a antiga auth.users.timezone.';
