

# Horários Personalizados para Lembretes de Prazo do WhatsApp

## Situação Atual

Os lembretes de prazo são disparados por um cron job fixo nos horários 8h, 12h e 18h. O usuário não tem como personalizar esses horários. A tabela `whatsapp_connections` não possui campo para armazenar horários de lembrete customizados.

## Solução

### 1. Adicionar coluna na tabela `whatsapp_connections`

Adicionar `reminder_times` (tipo `text`, default `'08:00,12:00,18:00'`) para armazenar os horários escolhidos pelo usuário, separados por vírgula.

### 2. Atualizar a UI de configurações (SettingsPage.tsx)

Quando `reminders_enabled` estiver ativo, exibir um campo para gerenciar até 5 horários de lembrete. Cada horário será um input `type="time"` com botão de remover, e um botão "Adicionar horário".

### 3. Atualizar o hook useWhatsApp

Adicionar `reminder_times` ao tipo `WhatsAppConnection` e ao `updateSettings`.

### 4. Atualizar a Edge Function `whatsapp-deadline-reminders`

Em vez de rodar em horário fixo (cron roda a cada hora), a função verifica se o horário atual bate com algum dos `reminder_times` do usuário (com tolerância de ±30 min). Alterar o cron para rodar **a cada hora** para cobrir qualquer combinação de horários.

### 5. Atualizar o cron job

Mudar de `0 8,12,18 * * *` para `0 * * * *` (a cada hora cheia), e a função filtra apenas os usuários cujo `reminder_times` inclui a hora atual.

## Arquivos modificados

| Arquivo | Ação |
|---------|------|
| Migração SQL | Adicionar coluna `reminder_times` |
| `src/hooks/useWhatsApp.ts` | Adicionar campo ao tipo |
| `src/pages/SettingsPage.tsx` | UI para gerenciar horários |
| `supabase/functions/whatsapp-deadline-reminders/index.ts` | Filtrar por horário do usuário |
| Cron job (SQL insert) | Alterar para `0 * * * *` |

