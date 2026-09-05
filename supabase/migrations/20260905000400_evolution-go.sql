-- ============================================================================
-- 20260905000400 — Colunas exigidas pelo porte para Evolution GO
-- ============================================================================
-- O Evolution GO (Go/whatsmeow) não é a Evolution API v2: não existe
-- `{instance}` no caminho da URL. Cada instância tem um TOKEN próprio, enviado
-- no header `apikey`, e é ele que identifica a instância — a GLOBAL_API_KEY só
-- cria/lista/deleta, não envia mensagem. Sem guardar o token, a function não
-- consegue enviar mensagem nem ler status (responde 409 pedindo reconexão).
--
-- O webhook também não tem assinatura: a defesa é o segredo na query da URL
-- MAIS a conferência de que o `instanceToken` do corpo bate com o gravado.
-- Por isso o índice em instance_token: o webhook procura a conexão por ele.
--
-- `whatsapp_processed_messages.message_id` já é PRIMARY KEY (portanto UNIQUE)
-- desde 20260326170831; aqui só se confere.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- whatsapp_connections (pessoal)
-- ---------------------------------------------------------------------------
ALTER TABLE public.whatsapp_connections
  ADD COLUMN IF NOT EXISTS instance_token text,
  ADD COLUMN IF NOT EXISTS instance_id text;

CREATE INDEX IF NOT EXISTS idx_whatsapp_connections_instance_token
  ON public.whatsapp_connections(instance_token)
  WHERE instance_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_connections_instance_name
  ON public.whatsapp_connections(instance_name);

COMMENT ON COLUMN public.whatsapp_connections.instance_token IS
  'Token da instância no Evolution GO (header apikey). É a credencial da instância: só as functions (service_role) devem usá-lo.';
COMMENT ON COLUMN public.whatsapp_connections.instance_id IS
  'ID interno da instância no Evolution GO (vem em /instance/create e nos webhooks).';

-- ---------------------------------------------------------------------------
-- tenant_whatsapp_connections
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenant_whatsapp_connections
  ADD COLUMN IF NOT EXISTS instance_token text,
  ADD COLUMN IF NOT EXISTS instance_id text;

CREATE INDEX IF NOT EXISTS idx_tenant_whatsapp_connections_instance_token
  ON public.tenant_whatsapp_connections(instance_token)
  WHERE instance_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tenant_whatsapp_connections_instance_name
  ON public.tenant_whatsapp_connections(instance_name);

COMMENT ON COLUMN public.tenant_whatsapp_connections.instance_token IS
  'Token da instância no Evolution GO (header apikey). Credencial: só as functions (service_role) devem usá-lo.';
COMMENT ON COLUMN public.tenant_whatsapp_connections.instance_id IS
  'ID interno da instância no Evolution GO.';

-- As functions (service_role) são quem escreve status/QR/token vindos do
-- webhook; as tabelas só tinham policies para authenticated.
DROP POLICY IF EXISTS "Service role full access" ON public.whatsapp_connections;
CREATE POLICY "Service role full access"
  ON public.whatsapp_connections FOR ALL
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access" ON public.tenant_whatsapp_connections;
CREATE POLICY "Service role full access"
  ON public.tenant_whatsapp_connections FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- whatsapp_processed_messages: dedup do webhook exige UNIQUE em message_id
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'whatsapp_processed_messages'
      AND c.contype IN ('p', 'u')
      AND c.conkey = ARRAY[(
        SELECT attnum FROM pg_attribute
        WHERE attrelid = t.oid AND attname = 'message_id'
      )]
  ) THEN
    ALTER TABLE public.whatsapp_processed_messages
      ADD CONSTRAINT whatsapp_processed_messages_message_id_key UNIQUE (message_id);
  END IF;
END
$$;

-- O webhook grava (message_id, instance_name) e ignora duplicata com
-- ON CONFLICT (message_id) DO NOTHING; a PK garante isso.
COMMENT ON TABLE public.whatsapp_processed_messages IS
  'Deduplicação do webhook do Evolution GO. message_id é PK/UNIQUE — o webhook usa ON CONFLICT DO NOTHING.';
