

# Seletor de Calendários + Sync Bidirecional

## Problemas Identificados

1. **Sem seletor de calendário**: Após conectar, o usuário não pode escolher qual calendário usar — sempre usa "primary". A API do Google permite listar todos os calendários do usuário.
2. **Sync unidirecional**: Atualmente só sincroniza Tarefas → Google Calendar. Não importa eventos do Google Calendar como tarefas.

## Mudanças

### 1. Adicionar ação `list-calendars` na Edge Function `google-calendar-sync`

Novo action que chama `GET /calendar/v3/users/me/calendarList` com o access_token do usuário e retorna a lista de calendários (id, summary, primary, backgroundColor).

### 2. Adicionar `listCalendars` no hook `useGoogleCalendar`

Nova query que busca a lista de calendários quando o usuário está conectado. Retorna array de `{ id, summary, primary }`.

### 3. Adicionar seletor de calendário na Settings

Após conectar, exibir um `<Select>` com os calendários disponíveis. Ao selecionar, atualiza `calendar_id` na tabela `google_calendar_tokens` via `updateSettings`.

### 4. Adicionar sync bidirecional (Google → Tarefas)

Nova ação `import-events` na edge function `google-calendar-sync`:
- Busca eventos do Google Calendar do período (próximos 30 dias)
- Para cada evento que não tenha uma tarefa correspondente (verificando por `google_event_id`), cria uma nova tarefa com:
  - `title` = event summary
  - `description` = event description
  - `due_date` = event start dateTime
  - `google_event_id` = event id
  - `quadrant` = 'schedule' (padrão para eventos importados)
  - `status` = 'pending'
- Eventos que já têm tarefa correspondente: atualiza título/descrição/data se modificados no Google

### 5. Botão "Importar eventos" na Settings + opção no sync

- Adicionar botão "Importar do Calendar" na seção Google Calendar das Settings
- O "Sincronizar agora" passará a fazer sync bidirecional (exporta tarefas + importa eventos)

### 6. Hook `useGoogleCalendar` — expor `importEvents`

Nova mutation que chama a action `import-events`.

### Arquivos modificados
- `supabase/functions/google-calendar-sync/index.ts` — actions `list-calendars` e `import-events`
- `src/hooks/useGoogleCalendar.ts` — `listCalendars` query + `importEvents` mutation
- `src/pages/SettingsPage.tsx` — seletor de calendário + botão importar

