

## Plano de Implementação

O usuário quer duas coisas:

1. **Lembretes automáticos de prazo via WhatsApp** — quando tarefas com `due_date` estão próximas de vencer (1h antes, 1 dia antes, no momento)
2. **Configuração de origem de mensagens** — adicionar um campo `accept_messages_from` na tabela `whatsapp_connections` com opções: `self_only` (só mensagens do próprio número) ou `all` (qualquer número). No webhook, filtrar mensagens com base nessa configuração.

### Bug existente no webhook
Há uma variável `state` declarada duas vezes (linhas 39 e 41) no bloco `isConnectionUpdate`. Isso causa erro de compilação. Será corrigido.

---

### 1. Migração: adicionar coluna `accept_messages_from`

```sql
ALTER TABLE public.whatsapp_connections 
ADD COLUMN accept_messages_from text NOT NULL DEFAULT 'self_only';
```

Valores possíveis: `'self_only'` ou `'all'`.

### 2. Edge Function: `whatsapp-deadline-reminders` (nova)

Uma function agendada via pg_cron que:
- Busca todos os usuários com `reminders_enabled = true` e `status = 'connected'`
- Para cada usuário, busca tarefas com `due_date` próximo (dentro de 1 hora, dentro de 24 horas) e `status` pendente/em andamento
- Envia mensagem WhatsApp com os lembretes formatados
- Será chamada a cada 30 minutos via cron job

### 3. Webhook: filtrar por `accept_messages_from`

No `whatsapp-webhook/index.ts`, ao processar mensagens:
- Buscar o campo `accept_messages_from` junto com `user_id` e `phone_number`
- Se `accept_messages_from === 'self_only'`, só processar se `fromMe === true`
- Se `accept_messages_from === 'all'`, processar todas as mensagens (inclusive de outros números)
- Corrigir o bug da variável `state` duplicada

### 4. UI: toggle na página de configurações

Adicionar um seletor no `SettingsPage.tsx` (seção WhatsApp, quando conectado) para alternar entre "Somente minhas mensagens" e "Todas as mensagens".

### 5. Atualizar hook e tipos

Adicionar `accept_messages_from` ao tipo `WhatsAppConnection` no `useWhatsApp.ts`.

---

### Arquivos modificados
- `supabase/functions/whatsapp-webhook/index.ts` — filtro de origem + fix bug `state` duplicado
- `supabase/functions/whatsapp-deadline-reminders/index.ts` — nova function
- `supabase/config.toml` — registrar nova function
- `src/hooks/useWhatsApp.ts` — adicionar campo ao tipo
- `src/pages/SettingsPage.tsx` — toggle de configuração
- `src/i18n/translations.ts` — novas strings (se necessário)
- Migração SQL — nova coluna
- Cron job SQL — agendamento a cada 30 min

