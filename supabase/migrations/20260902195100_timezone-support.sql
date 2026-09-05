-- Migration: Add Timezone Support for International Users
--
-- ============================================================================
-- CORRIGIDA NO LUGAR EM 05/09/2026 (porte para Supabase self-hosted)
--
-- A versao original desta migration era INVALIDA num Supabase limpo e
-- derrubava o `supabase db reset` inteiro. Tres motivos:
--
--  1. `ALTER TABLE auth.users ADD COLUMN timezone` — o schema `auth` e do
--     GoTrue (dono: supabase_auth_admin). As migrations rodam como `postgres`,
--     que tem privilegios mas NAO e dono da tabela: "must be owner of table
--     users". Mesmo rodando como superuser seria errado — o GoTrue gerencia
--     essa tabela e nada garante que a coluna sobrevive a uma atualizacao.
--  2. O `CHECK valid_timezone` listava dezenas de fusos inventados
--     (America/Nerja, America/Nersbergen, America/Nerolic...) e NAO listava
--     America/Sao_Paulo. A validacao real, contra pg_timezone_names, esta em
--     20260905000100_timezone-validation.sql.
--  3. O "seed" final fazia INSERT com `auth.uid()` — que e NULL fora de uma
--     requisicao autenticada — na PK de user_preferences: violacao de NOT NULL.
--
-- O que ficou: a tabela public.user_preferences (que ja era o lugar certo,
-- chaveada por id = auth.users.id) e as funcoes utilitarias, com
-- get_user_timezone lendo SO de user_preferences. Quem lia
-- auth.users.timezone deve ler user_preferences.timezone.
-- ============================================================================
--
-- This migration:
-- 1. Creates public.user_preferences (timezone, language, date/time format)
-- 2. Adds timezone-aware date conversion functions
-- 3. Provides utilities for timezone handling

-- Create a public users extension table (since auth.users has limited access)
CREATE TABLE IF NOT EXISTS public.user_preferences (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'UTC',
  language text NOT NULL DEFAULT 'en',
  date_format text NOT NULL DEFAULT 'YYYY-MM-DD',
  time_format text NOT NULL DEFAULT '24h', -- 24h or 12h
  week_starts_on integer NOT NULL DEFAULT 0, -- 0 = Sunday, 1 = Monday
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- RLS policies for user preferences
CREATE POLICY "Users can view their own preferences"
  ON public.user_preferences FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own preferences"
  ON public.user_preferences FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own preferences"
  ON public.user_preferences FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- Index for performance
CREATE INDEX idx_user_preferences_timezone ON public.user_preferences(timezone);

-- Trigger for updated_at
CREATE TRIGGER update_user_preferences_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to get user's timezone
-- CORRIGIDO 05/09/2026: lia auth.users.timezone (coluna que nao existe mais,
-- ver cabecalho). Agora so user_preferences; sem linha, 'UTC'.
CREATE OR REPLACE FUNCTION get_user_timezone(p_user_id uuid)
RETURNS text AS $$
DECLARE
  v_timezone text;
BEGIN
  SELECT up.timezone INTO v_timezone
  FROM public.user_preferences up
  WHERE up.id = p_user_id
  LIMIT 1;

  RETURN COALESCE(v_timezone, 'UTC');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- Function to convert UTC timestamp to user's timezone
CREATE OR REPLACE FUNCTION convert_to_user_timezone(
  p_timestamp timestamptz,
  p_user_id uuid
)
RETURNS timestamptz AS $$
DECLARE
  v_timezone text;
BEGIN
  v_timezone := get_user_timezone(p_user_id);
  RETURN p_timestamp AT TIME ZONE v_timezone;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Function to convert user's timezone to UTC
CREATE OR REPLACE FUNCTION convert_to_utc(
  p_timestamp timestamptz,
  p_user_id uuid
)
RETURNS timestamptz AS $$
DECLARE
  v_timezone text;
BEGIN
  v_timezone := get_user_timezone(p_user_id);
  RETURN p_timestamp AT TIME ZONE v_timezone AT TIME ZONE 'UTC';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Function to get start of day in user's timezone
CREATE OR REPLACE FUNCTION start_of_day_user_tz(
  p_date date,
  p_user_id uuid
)
RETURNS timestamptz AS $$
DECLARE
  v_timezone text;
BEGIN
  v_timezone := get_user_timezone(p_user_id);
  RETURN (p_date || ' 00:00:00')::timestamp AT TIME ZONE v_timezone AT TIME ZONE 'UTC';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Function to get end of day in user's timezone
CREATE OR REPLACE FUNCTION end_of_day_user_tz(
  p_date date,
  p_user_id uuid
)
RETURNS timestamptz AS $$
DECLARE
  v_timezone text;
BEGIN
  v_timezone := get_user_timezone(p_user_id);
  RETURN (p_date || ' 23:59:59')::timestamp AT TIME ZONE v_timezone AT TIME ZONE 'UTC';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_timezone(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION convert_to_user_timezone(timestamptz, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION convert_to_utc(timestamptz, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION start_of_day_user_tz(date, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION end_of_day_user_tz(date, uuid) TO authenticated, anon;
