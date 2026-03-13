
-- Subtasks table
CREATE TABLE public.subtasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  title text NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.subtasks ENABLE ROW LEVEL SECURITY;

-- RLS: user can select subtasks of their own tasks
CREATE POLICY "Users can view subtasks of their tasks"
  ON public.subtasks FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = subtasks.task_id
      AND (t.created_by = auth.uid() OR t.assigned_to = auth.uid())
  ));

CREATE POLICY "Users can insert subtasks on their tasks"
  ON public.subtasks FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = subtasks.task_id
      AND (t.created_by = auth.uid() OR t.assigned_to = auth.uid())
  ));

CREATE POLICY "Users can update subtasks on their tasks"
  ON public.subtasks FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = subtasks.task_id
      AND (t.created_by = auth.uid() OR t.assigned_to = auth.uid())
  ));

CREATE POLICY "Users can delete subtasks on their tasks"
  ON public.subtasks FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = subtasks.task_id
      AND (t.created_by = auth.uid() OR t.assigned_to = auth.uid())
  ));

-- Recurrence columns on tasks
ALTER TABLE public.tasks ADD COLUMN recurrence_rule text;
ALTER TABLE public.tasks ADD COLUMN recurrence_parent_id uuid REFERENCES public.tasks(id);
