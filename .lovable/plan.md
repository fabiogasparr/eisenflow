

# Notificação de Delegação de Tarefas

## Visão Geral

Criar uma tabela `notifications` no banco para persistir notificações entre usuários. Quando `assigned_to` é definido em uma tarefa, uma notificação é inserida para o membro delegado. O frontend escuta notificações em tempo real e as exibe no `NotificationCenter` existente.

## Arquitetura

```text
Task update (assigned_to) 
  → DB trigger inserts notification row
  → Realtime subscription picks it up
  → NotificationCenter shows it
```

## Mudanças no Banco

**Nova tabela `notifications`:**
- `id` uuid PK
- `user_id` uuid (destinatário)
- `type` text ('task_delegated', extensível)
- `title` text
- `body` text
- `metadata` jsonb (task_id, delegated_by, etc.)
- `read` boolean default false
- `created_at` timestamptz

**RLS:** Usuários veem/atualizam apenas suas notificações.

**Trigger `on_task_assigned`:** Quando `tasks.assigned_to` muda de NULL ou valor diferente, insere notificação para o novo assignee. Usa `SECURITY DEFINER` para bypass de RLS na inserção.

**Realtime:** `ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;`

## Mudanças no Frontend

| Arquivo | Ação |
|---------|------|
| `src/hooks/useNotifications.ts` | Criar — hook para buscar notificações do banco + realtime subscription |
| `src/hooks/useReminders.ts` | Editar — integrar notificações do banco no sistema existente |
| `src/components/NotificationCenter.tsx` | Editar — renderizar notificações de delegação (ícone UserPlus, nome do delegador) |

### Hook `useNotifications`
- Query notificações do usuário logado (`read = false` ou últimas 50)
- Subscribe ao canal realtime para `notifications` filtrado por `user_id`
- Funções: `markAsRead`, `markAllAsRead`
- Quando nova notificação chega via realtime, dispara toast + browser notification

### NotificationCenter
- Combinar reminders (local) + notifications (banco) em lista unificada ordenada por data
- Notificação de delegação mostra ícone `UserPlus` e texto "X delegou uma tarefa para você"

## Detalhes Técnicos

O trigger no banco garante que notificações são criadas independente de qual cliente fez a atribuição (chat IA, formulário, drag & drop). O realtime garante entrega instantânea sem polling.

