ALTER TABLE public.scheduled_reminders REPLICA IDENTITY FULL;
ALTER TABLE public.task_reminders REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.scheduled_reminders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_reminders;