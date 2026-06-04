## Problema

O bot do WhatsApp respondeu "Não tenho a funcionalidade de criar lembretes ou alarmes" mesmo após termos construído todo o sistema de lembretes (tabelas `task_reminders` / `scheduled_reminders`, triggers, edge function `dispatch-reminders` com canal `whatsapp_personal`, etc.).

Causa: o edge function `supabase/functions/whatsapp-webhook/index.ts` declara apenas tools de tarefa (`create_task`, `schedule_task`, `complete_task`, etc.) e o `systemPrompt` não diz que o assistente pode programar lembretes. Como o modelo só age via tools disponíveis, ele honestamente diz que não sabe.

## O que vamos mudar

Tudo dentro de `supabase/functions/whatsapp-webhook/index.ts` (sem alterar banco — a infraestrutura já existe).

### 1. Novas tools de lembrete em `AI_TOOLS`

- **`add_task_reminder`** — cria lembrete para a tarefa indicada.
  - args: `task_index` (1-based), `when` (enum: `1d_before` | `1h_before` | `at_due` | `at_start` | `custom`), `custom_datetime` (ISO, obrigatório só se `when=custom`), `channels` (opcional, default `["whatsapp_personal","in_app"]`).
  - Faz `INSERT` em `public.task_reminders` com `kind='custom'` e `scheduled_at` calculado a partir do `due_date`/`started_at` da tarefa (ou do `custom_datetime`). Recipients = `['creator']`. Trigger `task_reminders_expand_trg` materializa em `scheduled_reminders`.
  - Resposta: `⏰ Lembrete criado: 1h antes de "{título}" ({data/hora local})`.
- **`list_task_reminders`** — lista os lembretes ativos da tarefa (`SELECT * FROM task_reminders WHERE task_id = ... AND enabled = true ORDER BY scheduled_at`). Resposta formatada com índice 1-based dos lembretes.
- **`remove_task_reminder`** — `task_index` + `reminder_index`. Faz `UPDATE task_reminders SET enabled=false` (o trigger cancela a fila). Resposta: `🚫 Lembrete cancelado`.

### 2. Atualizar `systemPrompt`

Adicionar uma seção curta no prompt:

> CAPACIDADES DE LEMBRETE: Você pode criar, listar e cancelar lembretes para tarefas usando add_task_reminder, list_task_reminders e remove_task_reminder. Quando o usuário pedir "me lembre", "me avise", "manda um alerta", interprete e use a tool correta. Padrões: "1 hora antes" → when=1h_before; "amanhã" / "1 dia antes" → when=1d_before; "no horário" / "na hora" → when=at_due; "quando começar" → when=at_start; data/hora específica → when=custom + custom_datetime ISO. Se a tarefa não tem due_date e o usuário pediu relativo ao prazo, peça primeiro o prazo via chat_response (ou sugira schedule_task).

E acrescentar uma linha à descrição do estado: para cada tarefa listada incluir `Prazo: ...` e `Início: ...` quando existirem (o prompt já mostra prazo; adicionar `started_at` ajuda `at_start`).

### 3. Executor `executeToolCall`

Adicionar três `case` novos chamando helpers internos:

```text
case 'add_task_reminder' → resolve task pelo index, calcula scheduled_at, insere row, retorna confirmação formatada em pt-BR.
case 'list_task_reminders' → busca task_reminders da task, formata "1. 1h antes (06/06 14:00)\n2. ...".
case 'remove_task_reminder' → busca lista ordenada igual ao list_, marca enabled=false na posição.
```

Todos usam `supabaseAdmin` (service_role) — bypassa RLS, mas grava `created_by = userId` para auditoria.

### 4. Mensagem do `/ajuda`

Acrescentar duas linhas explicando os novos comandos em linguagem natural:
- "Me lembre 1h antes da tarefa 2"
- "Cancela o lembrete da tarefa 3"

Sem novo comando barra-slash neste passo (linguagem natural cobre o caso).

## Fora de escopo

- Não mexer em banco, triggers, RLS ou edge functions de dispatch — já funcionam.
- Não criar nova UI; isto é só o bot do WhatsApp.
- Não mudar prefs do usuário automaticamente (auto-reminders continuam controlados em Configurações).

## Validação

Após a build:
1. Mandar "Me lembre uma hora antes" para uma tarefa com `due_date` definido → bot deve responder `⏰ Lembrete criado...` e a fila `scheduled_reminders` deve ter uma linha `pending` para o canal `whatsapp_personal`.
2. Mandar "Quais lembretes da tarefa 1?" → lista numerada.
3. Mandar "Cancela o lembrete 1 da tarefa 1" → confirmação e linha vira `cancelled` na fila.