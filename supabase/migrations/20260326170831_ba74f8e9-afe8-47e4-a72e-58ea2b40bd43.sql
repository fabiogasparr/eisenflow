
CREATE TABLE public.whatsapp_processed_messages (
  message_id TEXT PRIMARY KEY,
  instance_name TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_wpm_processed_at ON public.whatsapp_processed_messages(processed_at);

ALTER TABLE public.whatsapp_processed_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.whatsapp_processed_messages
  FOR ALL TO service_role USING (true) WITH CHECK (true);
