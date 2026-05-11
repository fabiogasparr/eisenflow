## Objetivo

Garantir que **todas** as tarefas apareçam no Google Agenda (não só as que têm `due_date`), e refletir o status de conclusão/eliminação no próprio evento.

## Regras

- **Tarefa com `due_date`** → evento com horário no `due_date` (comportamento atual).
- **Tarefa sem `due_date`** → evento *all-day* na data de criação (`created_at`).
- **Tarefa concluída/eliminada** → manter o evento, mas prefixar o título com `✅ ` (concluída) ou `❌ ` (eliminada). Ao reabrir, remover o prefixo.
- Sync continua condicionado a `sync_enabled = true` no token do Google.

## Mudanças

### 1. `src/hooks/useGoogleCalendar.ts` — `syncTask`
- Aceitar `due_date` opcional e receber também `created_at` e `status`.
- Calcular:
  - `startDateTime = due_date ?? created_at`
  - `allDay = !due_date`
  - `displayTitle = (status==='completed' ? '✅ ' : status==='eliminated' ? '❌ ' : '') + title`
- Enviar `allDay` no body para a edge function.

### 2. `src/hooks/useTasks.ts`
- Remover o gate `if (data?.due_date)` em `createTask` e `updateTask`. Sempre chamar `syncTaskToCalendar?.(data)`.

### 3. `supabase/functions/google-calendar-sync/index.ts` — `create-event` / `update-event`
- Aceitar `allDay: boolean` no body.
- Quando `allDay`, montar o evento com `start.date` / `end.date` (formato `YYYY-MM-DD`, end = start+1 dia) em vez de `start.dateTime` / `end.dateTime`.
- Caso contrário, manter `dateTime` atual.

### 4. Backfill (opcional, recomendado)
- Adicionar botão "Sincronizar todas" já existe (`syncAllTasks`). Ajustar `sync-tasks` na edge function para **não** filtrar `.not("due_date", "is", null)` — incluir todas as tarefas do usuário e usar o mesmo fallback (`created_at` + all-day).

## Fora de escopo
- Não alterar import de eventos do Google → tarefas.
- Não alterar schema do banco.
- Não mudar UI de configurações do Google Agenda.
