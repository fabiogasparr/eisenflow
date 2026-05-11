import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface TaskAttachment {
  id: string;
  task_id: string;
  uploaded_by: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  ocr_text: string | null;
  ai_description: string | null;
  ai_analyzed_at: string | null;
  created_at: string;
  signed_url?: string;
}

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/jpg'];

async function withSignedUrls(rows: TaskAttachment[]): Promise<TaskAttachment[]> {
  if (!rows.length) return rows;
  const paths = rows.map((r) => r.storage_path);
  const { data } = await supabase.storage
    .from('task-attachments')
    .createSignedUrls(paths, 60 * 60);
  return rows.map((r, i) => ({ ...r, signed_url: data?.[i]?.signedUrl }));
}

export function useTaskAttachments(taskId: string | null) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ['task-attachments', taskId],
    enabled: !!taskId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_attachments')
        .select('*')
        .eq('task_id', taskId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return withSignedUrls((data || []) as TaskAttachment[]);
    },
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!taskId || !user) throw new Error('Missing task or user');
      if (file.size > MAX_BYTES) throw new Error('Imagem maior que 10 MB');
      if (!ALLOWED.includes(file.type)) throw new Error('Formato não suportado');

      const ext = file.name.split('.').pop() || 'png';
      const path = `${taskId}/${crypto.randomUUID()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('task-attachments')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;

      const { data, error } = await supabase
        .from('task_attachments')
        .insert({
          task_id: taskId,
          uploaded_by: user.id,
          storage_path: path,
          mime_type: file.type,
          size_bytes: file.size,
        })
        .select()
        .single();
      if (error) {
        await supabase.storage.from('task-attachments').remove([path]);
        throw error;
      }
      return data as TaskAttachment;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task-attachments', taskId] }),
  });

  const remove = useMutation({
    mutationFn: async (att: TaskAttachment) => {
      await supabase.storage.from('task-attachments').remove([att.storage_path]);
      const { error } = await supabase
        .from('task_attachments')
        .delete()
        .eq('id', att.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task-attachments', taskId] }),
  });

  const updateOcr = useMutation({
    mutationFn: async ({ id, ocr_text }: { id: string; ocr_text: string }) => {
      const { error } = await supabase
        .from('task_attachments')
        .update({ ocr_text })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task-attachments', taskId] }),
  });

  const analyze = useMutation({
    mutationFn: async (attachment_id: string) => {
      const { data, error } = await supabase.functions.invoke('analyze-task-image', {
        body: { attachment_id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { ocr_text: string; description: string; suggested_subtasks: string[] };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task-attachments', taskId] }),
  });

  return {
    attachments: query.data ?? [],
    isLoading: query.isLoading,
    upload,
    remove,
    analyze,
    updateOcr,
  };
}
