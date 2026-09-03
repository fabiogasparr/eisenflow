import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  create, update, remove, listDocs, getById, loadRelated, Query,
} from '@/integrations/appwrite/database';
import { taskPermissions, ownerOnly } from '@/integrations/appwrite/permissions';
import type { SharePermission } from '@/integrations/appwrite/types';

export interface TaskShare {
  id: string;
  task_id: string;
  shared_by: string;
  shared_with_email: string;
  shared_with_user_id: string | null;
  permission: 'view' | 'edit';
  created_at: string;
}

/**
 * Recalcula as permissões da TAREFA a partir da lista atual de shares.
 *
 * No Postgres a policy "Users can view shared tasks" / "Users can update shared
 * tasks" chamava `is_task_shared_with(auth.uid(), t.id)` a cada SELECT/UPDATE —
 * bastava existir a linha em `task_shares` para o acesso valer.
 * No Appwrite não existe consulta no momento da leitura: quem pode ler a tarefa
 * está gravado nas permissões DELA. Logo, toda mudança na lista de shares
 * (criar, mudar view->edit, remover) precisa reescrever essas permissões do
 * zero — é exatamente o "recalcular permissões na mudança de titularidade" do
 * guia. Sem isso o compartilhamento não tem efeito nenhum.
 */
async function sincronizarPermissoesDaTarefa(taskId: string) {
  const task = await getById('tasks', taskId);
  const shares = await listDocs('task_shares', [Query.equal('task_id', taskId)]);

  // TODO(migração): um share por e-mail de alguém que ainda não tem conta fica
  // SEM permissão de documento — o cliente não consegue traduzir e-mail em
  // userId (a collection `profiles` não guarda e-mail e a Users API do Appwrite
  // é server-side). Enquanto `shared_with_user_id` for null o convidado não
  // enxerga a tarefa; quem precisa preencher esse campo (e rechamar esta
  // sincronização) é uma Function no aceite do convite.
  const comConta = shares
    .filter((s) => !!s.shared_with_user_id)
    .map((s) => ({
      userId: s.shared_with_user_id as string,
      permission: (s.permission ?? 'view') as SharePermission,
    }));

  await update(
    'tasks',
    taskId,
    {},
    taskPermissions({
      createdBy: task.created_by,
      assignedTo: task.assigned_to ?? null,
      tenantTeamId: task.tenant_id ?? null,
      shares: comConta,
    }),
  );
}

export function useTaskShares(taskId: string | null) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const sharesQuery = useQuery({
    queryKey: ['task-shares', taskId],
    queryFn: async (): Promise<TaskShare[]> => {
      if (!taskId) return [];
      const docs = await listDocs('task_shares', [Query.equal('task_id', taskId)]);
      return docs as unknown as TaskShare[];
    },
    enabled: !!taskId && !!user,
  });

  const shareTask = useMutation({
    mutationFn: async ({ taskId, email, permission }: { taskId: string; email: string; permission: 'view' | 'edit' }) => {
      if (!user) throw new Error('Not authenticated');

      // PERMISSÕES DO PRÓPRIO SHARE: substituem as policies
      // "Users can view their shares" (shared_by OU shared_with_user_id OU
      // e-mail do convidado) e "Task owners can create/update/delete shares".
      // Quem compartilhou manda no registro; o convidado, quando já tem conta,
      // só lê. O ramo "shared_with_email = meu e-mail" da policy antiga não tem
      // como ser expresso aqui — ver o TODO em sincronizarPermissoesDaTarefa.
      const doc = await create(
        'task_shares',
        {
          task_id: taskId,
          shared_by: user.$id,
          shared_with_email: email.toLowerCase().trim(),
          permission,
        },
        ownerOnly(user.$id),
      );

      // O share só vira acesso de verdade depois deste passo.
      await sincronizarPermissoesDaTarefa(taskId);
      return doc as unknown as TaskShare;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-shares'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast({ title: '✅', description: 'Tarefa compartilhada com sucesso!' });
    },
    onError: (err: Error) => {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    },
  });

  const updatePermission = useMutation({
    mutationFn: async ({ shareId, permission }: { shareId: string; permission: 'view' | 'edit' }) => {
      const share = await getById('task_shares', shareId);
      await update('task_shares', shareId, { permission });
      // view -> edit muda quem pode ESCREVER na tarefa: as permissões do
      // documento tarefa precisam ser reescritas junto.
      await sincronizarPermissoesDaTarefa(share.task_id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-shares'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (err: Error) => {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    },
  });

  const removeShare = useMutation({
    mutationFn: async (shareId: string) => {
      const share = await getById('task_shares', shareId);
      await remove('task_shares', shareId);
      // Revogar o share tem que TIRAR a permissão da tarefa — apagar só a linha
      // deixaria o ex-convidado enxergando tudo.
      await sincronizarPermissoesDaTarefa(share.task_id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-shares'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  return {
    shares: sharesQuery.data ?? [],
    isLoading: sharesQuery.isLoading,
    shareTask,
    updatePermission,
    removeShare,
  };
}

export function useSharedWithMe() {
  const { user } = useAuth();

  const sharedTasksQuery = useQuery({
    queryKey: ['shared-with-me', user?.$id],
    queryFn: async () => {
      if (!user) return [];

      // Shares em que eu sou o destinatário. O `.or()` do PostgREST vira
      // Query.or; o ramo por e-mail continua existindo porque o convite pode ter
      // sido criado antes de a conta existir.
      const email = (user.email ?? '').toLowerCase();
      const shares = await listDocs('task_shares', [
        email
          ? Query.or([
              Query.equal('shared_with_user_id', user.$id),
              Query.equal('shared_with_email', email),
            ])
          : Query.equal('shared_with_user_id', user.$id),
      ]);
      if (shares.length === 0) return [];

      // Sem join embutido: as tarefas vêm em uma query separada e a junção é
      // feita em memória. loadRelated já quebra em lotes de 100.
      const taskMap = await loadRelated('tasks', shares.map((s) => s.task_id));

      // Idem para o nome de quem compartilhou.
      const sharerIds = [...new Set(shares.map((s) => s.shared_by))];
      const profiles = sharerIds.length
        ? await listDocs('profiles', [Query.equal('user_id', sharerIds)])
        : [];
      const profileMap = new Map(profiles.map((p) => [p.user_id, p.display_name ?? null]));

      return [...taskMap.values()].map((task) => {
        const share = shares.find((s) => s.task_id === task.id);
        return {
          ...task,
          _share: {
            permission: share?.permission ?? 'view',
            shared_by_name: (share && profileMap.get(share.shared_by)) ?? 'Unknown',
          },
        };
      });
    },
    enabled: !!user,
  });

  return {
    sharedTasks: sharedTasksQuery.data ?? [],
    isLoading: sharedTasksQuery.isLoading,
  };
}
