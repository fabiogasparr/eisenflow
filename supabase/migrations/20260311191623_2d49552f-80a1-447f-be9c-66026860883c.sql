
-- Also ensure the existing notify_task_assigned trigger exists
CREATE TRIGGER trg_notify_task_assigned
  AFTER UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_task_assigned();
