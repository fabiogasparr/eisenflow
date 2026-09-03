import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import { useToast } from './use-toast';
import { update, remove, listDocs, parseJson, toRow, Query } from '@/integrations/appwrite/database';
import { subscribeCollection } from '@/integrations/appwrite/realtime';
import type { Notifications } from '@/integrations/appwrite/types';

export interface DbNotification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  read: boolean;
  created_at: string;
}

/**
 * `metadata` era jsonb no Postgres e viaja como string JSON no Appwrite —
 * o componente continua recebendo um objeto.
 */
function toNotification(doc: Notifications & { id?: string }): DbNotification {
  const row = doc.id ? doc : toRow(doc);
  return {
    ...row,
    metadata: parseJson<Record<string, unknown>>(doc.metadata, {}),
  } as unknown as DbNotification;
}

export function useNotifications() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<DbNotification[]>([]);

  // Fetch notifications
  useEffect(() => {
    if (!user) return undefined;

    const fetchNotifications = async () => {
      // `notifications` é server-doc: quem cria é a Function (dispatch-reminders,
      // reevaluate-deadlines). O cliente lê os documentos que o servidor lhe deu
      // permissão de ler — o Query.equal só acha as linhas, o recorte de
      // segurança já está na permissão do documento.
      const docs = await listDocs('notifications', [
        Query.equal('user_id', user.$id),
        Query.orderDesc('created_at'),
        Query.limit(50),
      ]);
      setNotifications(docs.map((d) => toNotification(d)));
    };

    fetchNotifications();

    // Realtime: o filtro `user_id=eq.<uid>` do Supabase desapareceu porque o
    // Appwrite só entrega evento de documento que a sessão pode LER. O payload
    // vem cru do servidor (com $id e sem o `id` sintético), por isso toRow().
    return subscribeCollection('notifications', ({ event, document }) => {
      if (event !== 'create') return;
      const novo = toNotification(document);
      setNotifications((prev) => (prev.some((n) => n.id === novo.id) ? prev : [novo, ...prev]));

      // Toast + browser notification
      toast({ title: `🔔 ${novo.title}`, description: novo.body });

      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(novo.title, { body: novo.body, icon: '/favicon.ico' });
        } catch { /* aba sem permissão de notificação: ignora */ }
      }
    });
  }, [user, toast]);

  const markAsRead = useCallback(async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    // Server-doc, mas marcar como lida é a exceção: o servidor concede UPDATE
    // ao dono no próprio documento (substitui a policy
    // "Users can update their own notifications"). Nada de permissões no
    // terceiro argumento — o dono do documento não muda.
    await update('notifications', id, { read: true });
  }, []);

  const markAllAsRead = useCallback(async () => {
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    // O `.in('id', ids)` do Supabase atualizava tudo em uma query. O Appwrite não
    // tem UPDATE em lote por filtro: é um request por documento.
    await Promise.all(unreadIds.map((id) => update('notifications', id, { read: true }).catch(() => undefined)));
  }, [notifications]);

  const clearAll = useCallback(async () => {
    const ids = notifications.map((n) => n.id);
    if (ids.length === 0) return;
    setNotifications([]);
    // TODO(migração): `notifications` é server-doc e o servidor concede ao dono
    // leitura e update (o `read`), não delete. Estes removes falham em silêncio
    // e as notificações voltam no próximo fetch. Apagar de verdade precisa de
    // uma Function (ou de trocar "limpar" por "marcar todas como lidas").
    await Promise.all(ids.map((id) => remove('notifications', id).catch(() => undefined)));
  }, [notifications]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return { notifications, unreadCount, markAsRead, markAllAsRead, clearAll };
}
