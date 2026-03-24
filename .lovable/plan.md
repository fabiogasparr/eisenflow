

# Integração Bidirecional com Google Calendar

## Visão Geral

Cada usuário poderá conectar sua conta Google para sincronizar tarefas com o Google Calendar. Não existe um conector nativo do Google Calendar na plataforma, então a integração será feita via Google OAuth2 + API REST do Google Calendar através de Edge Functions.

## Pré-requisitos (ação do usuário)

Será necessário criar credenciais OAuth2 no Google Cloud Console:
1. Criar projeto no Google Cloud Console
2. Ativar a Google Calendar API
3. Criar credenciais OAuth2 (Web Application)
4. Configurar redirect URI apontando para a edge function de callback
5. Fornecer `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` como secrets do projeto

## Arquitetura

```text
┌─────────────┐    OAuth2     ┌──────────────────┐    API    ┌─────────────┐
│  Frontend   │ ──────────▶   │  Edge Functions  │ ───────▶  │ Google Cal  │
│  (Settings) │  ◀──────────  │  (token mgmt)    │ ◀───────  │    API      │
└─────────────┘               └──────────────────┘           └─────────────┘
                                      │
                              ┌───────┴───────┐
                              │ google_tokens  │
                              │   (tabela)     │
                              └───────────────┘
```

## Mudanças

### 1. Migração — Tabela `google_calendar_tokens`

Armazena tokens OAuth2 por usuário:
- `user_id` (uuid, FK profiles, unique)
- `access_token` (text, encrypted)
- `refresh_token` (text, encrypted)
- `token_expires_at` (timestamptz)
- `calendar_id` (text, default 'primary')
- `sync_enabled` (boolean, default true)
- `last_synced_at` (timestamptz)

RLS: usuário lê/atualiza apenas seu próprio registro; super_admin lê todos.

### 2. Edge Function `google-calendar-auth` — Fluxo OAuth2

- **GET** `?action=authorize`: Gera URL de autorização Google e redireciona o usuário
- **GET** `?action=callback&code=...`: Recebe o código, troca por tokens, salva na tabela
- **POST** `?action=disconnect`: Remove tokens do usuário

### 3. Edge Function `google-calendar-sync` — Sincronização

- **POST** `?action=list-events`: Lista eventos do Calendar (período configurável)
- **POST** `?action=create-event`: Cria evento a partir de uma tarefa (título, data, descrição)
- **POST** `?action=update-event`: Atualiza evento existente
- **POST** `?action=delete-event`: Remove evento
- **POST** `?action=sync-tasks`: Sincroniza todas as tarefas com due_date para o Calendar

Lógica de refresh automático: antes de cada chamada à API, verifica se o `access_token` expirou e usa o `refresh_token` para renovar.

### 4. Migração — Coluna `google_event_id` na tabela `tasks`

Adicionar coluna `google_event_id text` na tabela `tasks` para mapear tarefa ↔ evento do Calendar. Quando uma tarefa com due_date é criada/atualizada, sincroniza automaticamente.

### 5. Hook `useGoogleCalendar` (`src/hooks/useGoogleCalendar.ts`)

- `isConnected`: verifica se existe token válido
- `connect()`: redireciona para a edge function de auth
- `disconnect()`: remove tokens
- `listEvents(start, end)`: lista eventos
- `syncTask(task)`: cria/atualiza evento a partir de tarefa
- `syncAllTasks()`: sincroniza todas as tarefas com due_date

### 6. Seção "Google Calendar" na página Settings (`src/pages/SettingsPage.tsx`)

Novo Card com:
- Botão "Conectar Google Calendar" (quando desconectado)
- Status da conexão + email conectado (quando conectado)
- Toggle para ativar/desativar sincronização automática
- Botão "Sincronizar agora" para forçar sync manual
- Botão "Desconectar"

### 7. Integração automática — Trigger no `useTasks`

Quando uma tarefa com `due_date` for criada ou atualizada:
- Se o usuário tem Calendar conectado e sync_enabled = true
- Automaticamente cria/atualiza o evento correspondente no Google Calendar
- Armazena o `google_event_id` na tarefa

### 8. Secrets necessários

- `GOOGLE_CLIENT_ID` — ID do cliente OAuth2
- `GOOGLE_CLIENT_SECRET` — Secret do cliente OAuth2

### Arquivos criados/modificados
- 1 migração SQL (tabela `google_calendar_tokens` + coluna `google_event_id` em tasks)
- `supabase/functions/google-calendar-auth/index.ts` — fluxo OAuth2
- `supabase/functions/google-calendar-sync/index.ts` — operações Calendar API
- `src/hooks/useGoogleCalendar.ts` — hook frontend
- `src/pages/SettingsPage.tsx` — nova seção Google Calendar
- `src/hooks/useTasks.ts` — auto-sync ao criar/atualizar tarefa com due_date
- `supabase/config.toml` — config das novas edge functions

### Limitações
- Tokens ficam no banco (criptografia via pgcrypto recomendada para produção)
- Rate limits da Google Calendar API (1M queries/dia gratuito, suficiente)
- Cada usuário precisa autorizar individualmente sua conta Google

