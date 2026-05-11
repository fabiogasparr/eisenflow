-- Buckets
INSERT INTO storage.buckets (id, name, public) VALUES ('chat-attachments', 'chat-attachments', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public) VALUES ('task-attachments', 'task-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- chat-attachments policies: user folder = first segment of path
CREATE POLICY "chat-attachments user can read own"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'chat-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "chat-attachments user can upload own"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'chat-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "chat-attachments user can delete own"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'chat-attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

-- task_attachments table
CREATE TABLE public.task_attachments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL,
  uploaded_by UUID NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  ocr_text TEXT,
  ai_description TEXT,
  ai_analyzed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_attachments_task_id ON public.task_attachments(task_id);

ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View task attachments if can view task"
ON public.task_attachments FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = task_attachments.task_id
      AND (
        t.created_by = auth.uid()
        OR t.assigned_to = auth.uid()
        OR (t.tenant_id IS NOT NULL AND public.is_tenant_member(auth.uid(), t.tenant_id))
        OR public.is_task_shared_with(auth.uid(), t.id)
        OR public.is_super_admin()
      )
  )
);

CREATE POLICY "Insert task attachments if can edit task"
ON public.task_attachments FOR INSERT TO authenticated
WITH CHECK (
  uploaded_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = task_attachments.task_id
      AND (t.created_by = auth.uid() OR t.assigned_to = auth.uid())
  )
);

CREATE POLICY "Delete own task attachments"
ON public.task_attachments FOR DELETE TO authenticated
USING (uploaded_by = auth.uid());

CREATE POLICY "Update own task attachments"
ON public.task_attachments FOR UPDATE TO authenticated
USING (uploaded_by = auth.uid());

-- task-attachments storage policies: path format = {task_id}/{uuid.ext}
CREATE POLICY "task-attachments read if can view task"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'task-attachments'
  AND EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id::text = (storage.foldername(name))[1]
      AND (
        t.created_by = auth.uid()
        OR t.assigned_to = auth.uid()
        OR (t.tenant_id IS NOT NULL AND public.is_tenant_member(auth.uid(), t.tenant_id))
        OR public.is_task_shared_with(auth.uid(), t.id)
      )
  )
);

CREATE POLICY "task-attachments insert if can edit task"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'task-attachments'
  AND EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id::text = (storage.foldername(name))[1]
      AND (t.created_by = auth.uid() OR t.assigned_to = auth.uid())
  )
);

CREATE POLICY "task-attachments delete if can edit task"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'task-attachments'
  AND EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id::text = (storage.foldername(name))[1]
      AND (t.created_by = auth.uid() OR t.assigned_to = auth.uid())
  )
);