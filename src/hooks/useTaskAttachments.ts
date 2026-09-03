import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { create, update, remove, listDocs, getById, Query } from '@/integrations/appwrite/database';
import { uploadFile, deleteFile, fileViewUrl, fileOwnerPermissions, type BucketId } from '@/integrations/appwrite/files';
import { inheritFrom, ownerOnly } from '@/integrations/appwrite/permissions';
import { invoke } from '@/integrations/appwrite/functions';

export interface TaskAttachment {
  id: string;
  task_id: string;
  uploaded_by: string;
  /** Nome original do arquivo. Antes era o caminho `{task_id}/{uuid}.ext`. */
  storage_path: string;
  bucket_id: string | null;
  file_id: string | null;
  mime_type: string;
  size_bytes: number;
  ocr_text: string | null;
  ai_description: string | null;
  ai_analyzed_at: string | null;
  created_at: string;
  /** Mantém o nome antigo para não mexer nos componentes; hoje é a URL de view. */
  signed_url?: string;
}

const BUCKET = 'task-attachments' as const;
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/jpg'];

/** O bucket gravado no documento é texto livre no schema; aqui vira BucketId. */
const bucketOf = (b: string | null | undefined): BucketId => (b ?? BUCKET) as BucketId;

/**
 * Substitui o `createSignedUrls`. No Supabase a URL precisava ser assinada
 * porque a permissão morava numa policy sobre o CAMINHO do objeto; no Appwrite a
 * permissão está gravada NO ARQUIVO, então a URL de view é fixa e quem não pode
 * ler simplesmente recebe 401 ao carregar a imagem — não há o que assinar.
 */
function withViewUrls(rows: TaskAttachment[]): TaskAttachment[] {
  return rows.map((r) => ({
    ...r,
    // Anexos legados (gravados antes da migração) só têm storage_path e ficam
    // sem preview até que o arquivo seja reenviado.
    signed_url: r.file_id ? fileViewUrl(bucketOf(r.bucket_id), r.file_id) : undefined,
  }));
}

export function useTaskAttachments(taskId: string | null) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ['task-attachments', taskId],
    enabled: !!taskId,
    queryFn: async () => {
      const docs = await listDocs('task_attachments', [
        Query.equal('task_id', taskId!),
        Query.orderDesc('created_at'),
      ]);
      return withViewUrls(docs as unknown as TaskAttachment[]);
    },
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!taskId || !user) throw new Error('Missing task or user');
      if (file.size > MAX_BYTES) throw new Error('Imagem maior que 10 MB');
      if (!ALLOWED.includes(file.type)) throw new Error('Formato não suportado');

      const parent = await getById('tasks', taskId);

      // PERMISSÕES DO ARQUIVO: substituem a storage policy
      // "task-attachments read if can view task", que era avaliada a cada
      // request casando o prefixo `{task_id}/` do caminho com a tarefa.
      // No Appwrite não existe caminho nem policy: os leitores têm que ser
      // listados no upload. Quem enviou manda no arquivo; criador e responsável
      // pela tarefa leem.
      const leitores = [parent.created_by, parent.assigned_to].filter(
        (id): id is string => !!id && id !== user.$id,
      );
      const uploaded = await uploadFile(BUCKET, file, fileOwnerPermissions(user.$id, leitores));

      try {
        // PERMISSÕES DO DOCUMENTO: a policy "View task attachments if can view
        // task" olhava a tarefa pai a cada SELECT — aqui o anexo herda as
        // permissões da tarefa. Somado a isso, "Delete/Update own task
        // attachments" (uploaded_by = auth.uid()) vira o ownerOnly de quem
        // enviou, que pode não ser o criador da tarefa.
        const doc = await create(
          'task_attachments',
          {
            task_id: taskId,
            uploaded_by: user.$id,
            // O identificador real agora é bucket_id + file_id. storage_path
            // segue preenchido — com o nome original — só por compatibilidade.
            storage_path: file.name,
            bucket_id: BUCKET,
            file_id: uploaded.$id,
            mime_type: file.type,
            size_bytes: file.size,
          },
          [...new Set([...inheritFrom(parent.$permissions), ...ownerOnly(user.$id)])],
        );
        return withViewUrls([doc as unknown as TaskAttachment])[0];
      } catch (err) {
        // Sem transação entre Storage e Database: se o documento falhar, o
        // arquivo órfão sai na mão.
        await deleteFile(BUCKET, uploaded.$id).catch(() => undefined);
        throw err;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task-attachments', taskId] }),
  });

  const removeAttachment = useMutation({
    mutationFn: async (att: TaskAttachment) => {
      // Não há CASCADE entre Storage e Database: apaga o arquivo e depois o
      // documento. Falha no arquivo não impede a remoção do registro.
      if (att.file_id) {
        await deleteFile(bucketOf(att.bucket_id), att.file_id).catch(() => undefined);
      }
      await remove('task_attachments', att.id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task-attachments', taskId] }),
  });

  const updateOcr = useMutation({
    mutationFn: async ({ id, ocr_text }: { id: string; ocr_text: string }) => {
      await update('task_attachments', id, { ocr_text });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task-attachments', taskId] }),
  });

  const analyze = useMutation({
    mutationFn: async (attachment_id: string) => {
      // invoke já lança em caso de erro (o par { data, error } do Supabase sumiu).
      return invoke<{ ocr_text: string; description: string; suggested_subtasks: string[] }>(
        'analyze-task-image',
        { attachment_id },
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task-attachments', taskId] }),
  });

  return {
    attachments: query.data ?? [],
    isLoading: query.isLoading,
    upload,
    remove: removeAttachment,
    analyze,
    updateOcr,
  };
}
