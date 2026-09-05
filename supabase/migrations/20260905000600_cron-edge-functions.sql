-- ============================================================================
-- 20260905000600 — Agendamentos das Edge Functions via pg_cron + pg_net
-- ============================================================================
-- Não existe scheduler no edge-runtime self-hosted: quem dispara as functions
-- periódicas é o pg_cron dentro do Postgres, fazendo um POST assíncrono com
-- pg_net. Nada de URL nem segredo no SQL — os dois vêm de configurações do
-- banco, que o OPERADOR precisa definir (como supabase_admin) antes do
-- primeiro disparo:
--
--   ALTER DATABASE postgres SET app.settings.functions_url    = '...';
--   ALTER DATABASE postgres SET app.settings.internal_secret  = '...';
--
--   functions_url ... base das functions SEM barra final. Duas opções:
--                     * pela rede interna do docker, sem passar pelo Kong:
--                         http://functions:9000
--                       (nome do serviço edge-runtime no compose do Supabase)
--                     * pela URL pública: https://<dominio>/functions/v1
--   internal_secret . o mesmo valor de INTERNAL_SECRET no env da edge-runtime;
--                     vai no header x-internal-secret e é o que as functions
--                     internas (dispatch-reminders, whatsapp-send...) exigem.
--
--   Opcional — se FUNCTIONS_VERIFY_JWT=true na edge-runtime, ela exige um JWT
--   do projeto além do segredo interno:
--   ALTER DATABASE postgres SET app.settings.functions_bearer = '<SERVICE_ROLE_KEY>';
--
-- `ALTER DATABASE ... SET` vale para sessões NOVAS. O pg_cron abre uma sessão
-- nova por execução, então pega o valor no próximo disparo; não é preciso
-- reiniciar nada.
--
-- Por que passar por uma função SQL (invoke_edge_function) em vez de escrever
-- net.http_post em cada cron.schedule:
--   * os jobs ficam legíveis em cron.job (`SELECT public.invoke_edge_function('x')`);
--   * trocar URL/segredo é um ALTER DATABASE, sem mexer nos jobs;
--   * o erro quando a configuração falta é um só, claro, e aparece em
--     cron.job_run_details.
--
-- Pré-requisitos no supabase/postgres: pg_cron carregado em
-- shared_preload_libraries com cron.database_name = 'postgres' (padrão da
-- imagem) e a extensão pg_net (ambas já criadas em 20260313104226).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ---------------------------------------------------------------------------
-- 1. invoke_edge_function(name[, body]) → id da requisição em net._http_response
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoke_edge_function(p_name text, p_body jsonb DEFAULT '{}'::jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base    text := current_setting('app.settings.functions_url', true);
  v_secret  text := current_setting('app.settings.internal_secret', true);
  v_bearer  text := current_setting('app.settings.functions_bearer', true);
  v_headers jsonb;
  v_req_id  bigint;
BEGIN
  IF p_name IS NULL OR p_name !~ '^[a-z0-9][a-z0-9-]*$' THEN
    RAISE EXCEPTION 'invoke_edge_function: nome de function inválido: %', p_name;
  END IF;
  IF v_base IS NULL OR v_base = '' THEN
    RAISE EXCEPTION 'invoke_edge_function: app.settings.functions_url não definida. '
      'Rode como supabase_admin: ALTER DATABASE postgres SET app.settings.functions_url = ''http://functions:9000'';'
      USING ERRCODE = 'config_file_error';
  END IF;
  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE EXCEPTION 'invoke_edge_function: app.settings.internal_secret não definida. '
      'Rode como supabase_admin: ALTER DATABASE postgres SET app.settings.internal_secret = ''<INTERNAL_SECRET da edge-runtime>'';'
      USING ERRCODE = 'config_file_error';
  END IF;

  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-internal-secret', v_secret
  );
  IF v_bearer IS NOT NULL AND v_bearer <> '' THEN
    v_headers := v_headers
      || jsonb_build_object('Authorization', 'Bearer ' || v_bearer, 'apikey', v_bearer);
  END IF;

  -- pg_net é assíncrono: o retorno é só o id da fila; resultado em
  -- net._http_response (mantido por ~6h pela extensão).
  SELECT net.http_post(
    url                  := rtrim(v_base, '/') || '/' || p_name,
    body                 := COALESCE(p_body, '{}'::jsonb),
    headers              := v_headers,
    timeout_milliseconds := 60000
  ) INTO v_req_id;

  RETURN v_req_id;
END;
$$;

COMMENT ON FUNCTION public.invoke_edge_function(text, jsonb) IS
  'Dispara POST assíncrono (pg_net) para a Edge Function <name> com o header x-internal-secret. URL e segredo vêm de app.settings.*.';

-- Só o cron (roda como postgres) e o servidor chamam isto.
REVOKE EXECUTE ON FUNCTION public.invoke_edge_function(text, jsonb) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_edge_function(text, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Agendamentos (cron.schedule por nome é idempotente no pg_cron ≥ 1.4:
--    o job de mesmo nome é atualizado, não duplicado)
-- ---------------------------------------------------------------------------
-- Horários em UTC (pg_cron ignora o fuso da sessão). 03:00/04:00/06:00 UTC =
-- 00:00/01:00/03:00 em America/Sao_Paulo, de madrugada como se pretende; as
-- functions que precisam do fuso do usuário (relatórios, lembretes) resolvem
-- isso sozinhas a partir de user_preferences / whatsapp_connections.timezone.
SELECT cron.schedule('ef-dispatch-reminders',           '*/5 * * * *',  $$SELECT public.invoke_edge_function('dispatch-reminders')$$);
SELECT cron.schedule('ef-process-recurring-schedules',  '*/5 * * * *',  $$SELECT public.invoke_edge_function('process-recurring-schedules')$$);
SELECT cron.schedule('ef-whatsapp-deadline-reminders',  '*/15 * * * *', $$SELECT public.invoke_edge_function('whatsapp-deadline-reminders')$$);
SELECT cron.schedule('ef-whatsapp-report',              '0 * * * *',    $$SELECT public.invoke_edge_function('whatsapp-report')$$);
SELECT cron.schedule('ef-cleanup-reminders',            '0 3 * * *',    $$SELECT public.invoke_edge_function('cleanup-reminders')$$);
SELECT cron.schedule('ef-generate-recurring-tasks',     '0 4 * * *',    $$SELECT public.invoke_edge_function('generate-recurring-tasks')$$);
SELECT cron.schedule('ef-reevaluate-deadlines',         '0 6 * * *',    $$SELECT public.invoke_edge_function('reevaluate-deadlines')$$);

-- ---------------------------------------------------------------------------
-- 3. Visão de operação: últimos disparos e respostas
-- ---------------------------------------------------------------------------
-- cron.job_run_details cresce sem limite; o pg_cron ≥ 1.5 tem
-- cron.log_run, mas a limpeza continua sendo nossa.
SELECT cron.schedule('ef-cleanup-cron-history', '30 2 * * *',
  $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '14 days'$$);
