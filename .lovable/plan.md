

# Fix: Tarefas criadas via WhatsApp não aparecem no dashboard em tempo real

## Problema
Quando o webhook do WhatsApp cria uma tarefa usando `service_role` (que bypassa RLS), o Supabase Realtime pode não notificar o cliente porque a subscription do lado do cliente usa a sessão do usuário autenticado. Há uma incompatibilidade conhecida entre inserções feitas via `service_role` e subscriptions filtradas por RLS.

## Solução
Duas medidas complementares:

1. **Adicionar filtro explícito na subscription Realtime** — especificar `filter: 'created_by=eq.{userId}'` para que o Supabase saiba exatamente quais mudanças enviar ao cliente
2. **Adicionar polling como fallback** — `refetchInterval: 30000` (30s) garante que mesmo se o Realtime falhar, os dados apareçam em no máximo 30 segundos

## Arquivo alterado
- `src/hooks/useTasks.ts` — ajustar o canal Realtime com filtro e adicionar refetchInterval na query

