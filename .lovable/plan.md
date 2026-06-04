
# Plano: Agendamentos & Lembretes Unificados

## Objetivo
Criar uma camada única de agendamento que dispara lembretes em múltiplos canais (in-app, browser, WhatsApp pessoal e WhatsApp do tenant), cobrindo:
- Prazo (due_date): D-1, 1h antes, no vencimento
- Início agendado (started_at)
- Lembretes customizados por tarefa (N horários)
- Recorrentes diários/semanais (resumo, plano da semana)

Destinatários configuráveis por tarefa: criador, assignee, compartilhados.

---

## 1. Modelo de dados (novas tabelas)

### `tenant_whatsapp_connections`
Conexão oficial do tenant (paralela à `whatsapp_connections` que continua pessoal).
- `tenant_id`, `instance_name`, `phone_number`, `status`, `qr_code`
- `default_sender` (bool) — usado para broadcasts/relatórios do tenant
- Apenas owner/admin do tenant pode gerenciar
- `member_phone_map` separada: `tenant_member_phones (tenant_id, user_id, phone_number, verified)` para o tenant enviar a cada membro

### `task_reminders`
Lembretes configurados (por tarefa, criados pelo usuário ou automaticamente).
- `task_id`, `created_by`
- `kind`: `due_d1` | `due_1h` | `due_now` | `start_now` | `start_5min` | `custom`
- `scheduled_at` (timestamptz) — calculado/persistido para custom; para auto-tipos recalculado em trigger quando due_date/started_at muda
- `recipients`: array enum (`creator`, `assignee`, `shared`)
- `channels`: array enum (`in_app`, `browser`, `whatsapp_personal`, `whatsapp_tenant`, `email`)
- `enabled` bool

### `scheduled_reminders` (fila de execução)
Materialização do que precisa ser enviado. Uma linha por (lembrete × destinatário × canal).
- `task_reminder_id` (nullable — recorrentes não têm)
- `user_id` (destinatário), `tenant_id`
- `kind`, `channel`, `scheduled_at`
- `status`: `pending` | `sent` | `failed` | `skipped` | `cancelled`
- `attempts`, `last_error`, `sent_at`
- índice composto em (status, scheduled_at)
- UNIQUE (task_reminder_id, user_id, channel) para evitar duplicidade

### `recurring_schedules`
Agendamentos recorrentes (resumo diário, plano semanal, follow-ups personalizados do usuário).
- `user_id`, `tenant_id` (opcional)
- `kind`: `daily_summary` | `weekly_plan` | `custom`
- `cron_local` (ex: "08:00"), `weekday` (0-6 quando aplicável), `timezone`
- `channels[]`, `enabled`

RLS: usuário só vê/edita os seus; service_role total. `task_reminders` segue mesmas regras de acesso da tarefa.

---

## 2. Materialização & manutenção da fila

**Trigger no `tasks`**: ao inserir/alterar `due_date`/`started_at`/`assigned_to`:
- gera/atualiza `task_reminders` automáticos (D-1, 1h, due, start) respeitando preferências do usuário (defaults configuráveis em `user_reminder_preferences`)
- (re)expande `scheduled_reminders` futuras pendentes para esse `task_reminder_id` (cancela antigas com status=pending e cria novas com base nos novos `scheduled_at`, recipients e channels)

**Trigger no `task_reminders`**: insert/update/delete reexpande linhas em `scheduled_reminders`.

**Função `expand_task_reminder(task_reminder_id)`** (SECURITY DEFINER):
- resolve destinatários reais (creator/assignee/lista de task_shares)
- resolve canais habilitados por destinatário (consulta preferências e conexões disponíveis)
- insere/upserta em `scheduled_reminders`

---

## 3. Execução híbrida (pg_cron + edge functions)

### Cron a cada 1 minuto → `dispatch-reminders`
- Seleciona `scheduled_reminders` com `status='pending'` e `scheduled_at <= now()` (janela 5min, limit 200)
- Para cada um:
  - in_app → insere em `notifications`
  - browser → realtime via Supabase (cliente assina e dispara `Notification`)
  - whatsapp_personal → chama `whatsapp-send` usando a `whatsapp_connections` do destinatário
  - whatsapp_tenant → usa `tenant_whatsapp_connections` ativa + telefone mapeado em `tenant_member_phones`
  - email → fila pgmq (se infra de email estiver setada)
- Marca `sent` / `failed` com backoff (retry até 3x)

### Cron a cada 5 minutos → `process-recurring-schedules`
- Avalia `recurring_schedules` ativos cujo horário local (timezone) caia na janela
- Monta o conteúdo (resumo do dia, plano da semana, etc.) e insere em `scheduled_reminders` com `scheduled_at=now()`

### Cron horário → `cleanup-reminders`
- Apaga `scheduled_reminders` sent/failed > 7 dias
- Re-sincroniza tarefas onde a trigger falhou (safety net)

---

## 4. WhatsApp por tenant (híbrido)

- `whatsapp_connections` (existente) → canal **pessoal** opt-in por usuário.
- `tenant_whatsapp_connections` (novo) → instância oficial gerida por owner/admin.
- Quando uma tarefa pertence a tenant e o destinatário não tem WA pessoal conectado, usa o tenant (se ele tiver telefone do membro em `tenant_member_phones`, validado por código OTP).
- Configuração em "Workspace → WhatsApp": conecta QR, valida telefones dos membros, define se broadcasts diários usam tenant.

---

## 5. UI

### Por tarefa (em `TaskDetailSheet` / `CreateTaskDialog`)
- Seção "Lembretes" com:
  - Toggles automáticos: D-1, 1h, no vencimento, no início (defaults vêm das prefs do usuário)
  - Botão "Adicionar lembrete customizado" → popover de data/hora (custom, não native)
  - Multi-select destinatários (Criador / Responsável / Compartilhados)
  - Multi-select canais (ícones)
- Reaproveita o `ReminderTimesEditor` existente como base visual.

### Configurações do usuário (`SettingsPage`)
- "Preferências de lembrete" → defaults por tipo, canais padrão
- "Agendamentos recorrentes" → cria/edita resumo diário, plano semanal
- Tabs separadas para WhatsApp pessoal e WhatsApp do tenant (se admin)

### Tenant admin (`OrganizationPage` ou nova "WhatsApp do Workspace")
- Conectar instância oficial via QR
- Gerenciar telefones dos membros (lista, validação OTP)
- Toggle "Usar WhatsApp do workspace para membros sem conexão pessoal"

---

## 6. Notificações in-app (realtime)
- `dispatch-reminders` insere em `notifications`; `useNotifications` já tem polling.
- Adicionar canal realtime supabase para latência <1s e disparar `Notification` no browser sem polling.

---

## 7. Migração & rollout
1. Migration 1: cria tabelas + RLS + GRANTs + triggers + função `expand_task_reminder`.
2. Migration 2: pg_cron jobs (dispatch 1min, recurring 5min, cleanup 1h).
3. Edge functions: `dispatch-reminders`, `process-recurring-schedules`, `cleanup-reminders`, `tenant-whatsapp-connect`, `tenant-whatsapp-verify-phone`.
4. Backfill: para tarefas ativas com due_date futura, popular `task_reminders` automáticos.
5. Migrar lógica do `whatsapp-deadline-reminders` atual para a nova fila e desativar o cron antigo.
6. UI: TaskDetailSheet → SettingsPage → OrganizationPage.

---

## Detalhes técnicos

- Idempotência: UNIQUE em `scheduled_reminders(task_reminder_id, user_id, channel)` + upsert.
- Timezone: cada usuário/tenant tem `timezone`; horários custom guardados em UTC com origem timezone.
- Falhas WhatsApp: 3 tentativas com backoff exponencial; após falha, registra em `notifications` para o usuário ver "lembrete não entregue".
- Permissões: trigger em `tasks` roda SECURITY DEFINER mas valida `created_by`/`assigned_to`/shares ao expandir destinatários.
- Performance: índice parcial `WHERE status='pending'` em `scheduled_reminders(scheduled_at)`.
- Custos cron: dispatch 1min é leve (query indexada + limit 200); pode aumentar para 30s no futuro.

---

## Fora de escopo (futuras iterações)
- SMS, push mobile nativo (PWA push pode entrar depois)
- Snooze de lembretes via WhatsApp ("/adiar 10min")
- IA decidindo melhor horário com base no padrão do usuário
