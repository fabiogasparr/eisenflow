
CREATE TABLE public.whatsapp_chat_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'user',
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_chat_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own chat history" ON public.whatsapp_chat_history
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Service role full access" ON public.whatsapp_chat_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_whatsapp_chat_history_user_created ON public.whatsapp_chat_history (user_id, created_at DESC);
