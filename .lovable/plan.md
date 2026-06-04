# Lembretes no WhatsApp com confirmação rápida

## Objetivo

Quando você pedir um lembrete pelo WhatsApp, o bot vai:
1. Criar o lembrete normalmente.
2. Responder com uma **mensagem de confirmação rica** mostrando: título da tarefa, texto do lembrete, data e hora.
3. Oferecer **3 ações rápidas numeradas** para você responder sem digitar nada complexo.
4. Garantir que, no horário marcado, o lembrete chega via WhatsApp automaticamente (não só quando solicitado).

## Como vai aparecer no WhatsApp

Exemplo de confirmação após você dizer *"me lembra da reunião amanhã às 14h"*:

```text
⏰ Lembrete criado

📌 Tarefa: Reunião com cliente
🗓️ Quando: amanhã (05/06) às 14:00
📢 Canais: WhatsApp + App

Responda:
1️⃣ Confirmar
2️⃣ Reagendar +1h
3️⃣ Cancelar
```

Se você responder `1`, `2` ou `3` (ou `sim`, `reagendar`, `cancelar`), o bot age na hora sobre o último lembrete criado, sem precisar repetir o nome da tarefa.

Se você ignorar e mandar outra coisa, a opção rápida simplesmente expira em 15 minutos e a conversa segue normal.

## Comportamento dos lembretes no horário

Confirmação importante: os lembretes **já são disparados automaticamente no horário agendado** pelo cron `dispatch-reminders`, usando o canal `whatsapp_personal` quando configurado. O fluxo continua exatamente assim — esta mudança só melhora a *confirmação* no momento da criação, não substitui o disparo automático.

Vamos validar com um teste rápido depois de implementar:
- Criar um lembrete para daqui 2 minutos
- Confirmar que o WhatsApp recebe a mensagem no horário

## Detalhes técnicos

**Único arquivo alterado:** `supabase/functions/whatsapp-webhook/index.ts`

1. **Mensagem de confirmação enriquecida** no handler `add_task_reminder`:
   - Formatar data/hora em pt-BR com dia da semana relativo ("hoje", "amanhã", ou data).
   - Incluir título da tarefa em negrito, canais escolhidos e bloco de ações.
   - Devolver `reminder_id` junto, para guardar como ação pendente.

2. **Estado de "ação pendente"** — armazenado em `whatsapp_chat_history` como uma mensagem de role `system` com payload JSON (`{pending_reminder_id, expires_at}`). Sem nova tabela.

3. **Pré-processador de quick-reply** no início do webhook (antes de chamar o LLM):
   - Se a mensagem do usuário for `1`/`2`/`3`/`sim`/`s`/`confirmar`/`reagendar`/`cancelar` (case-insensitive, trim), procurar a última ação pendente não expirada.
   - `1`/`sim`/`confirmar` → responder `✅ Lembrete confirmado`.
   - `2`/`reagendar` → atualizar `task_reminders.scheduled_at` para +1h e responder com nova data/hora.
   - `3`/`cancelar` → `enabled=false` e responder `🚫 Lembrete cancelado`.
   - Marcar a ação como consumida (nova linha system no histórico).
   - Se não houver pendência válida, deixar o LLM processar normalmente.

4. **TTL de 15 min** para a ação pendente, para não confundir com mensagens futuras.

## Fora do escopo

- Botões interativos nativos do WhatsApp (Evolution API tem suporte irregular entre versões; respostas numeradas funcionam em 100% dos casos).
- Mudanças no `dispatch-reminders` (já entrega no horário).
- Mudanças de UI no app web.
- Mudanças no banco ou RLS.
