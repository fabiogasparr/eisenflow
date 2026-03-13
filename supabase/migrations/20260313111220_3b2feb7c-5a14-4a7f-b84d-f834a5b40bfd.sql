CREATE TABLE public.whatsapp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  instance_name text NOT NULL,
  phone_number text,
  status text NOT NULL DEFAULT 'disconnected',
  qr_code text,
  reminders_enabled boolean NOT NULL DEFAULT false,
  daily_report_enabled boolean NOT NULL DEFAULT false,
  report_time time DEFAULT '08:00',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own whatsapp connection"
  ON public.whatsapp_connections FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own whatsapp connection"
  ON public.whatsapp_connections FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own whatsapp connection"
  ON public.whatsapp_connections FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own whatsapp connection"
  ON public.whatsapp_connections FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_whatsapp_connections_updated_at
  BEFORE UPDATE ON public.whatsapp_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();