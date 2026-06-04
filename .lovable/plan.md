## Diagnóstico

As mensagens do WhatsApp mostram dois problemas diferentes no fluxo de lembretes:

1. `DELETE requires a WHERE clause`
   - Vem da função de banco `expand_task_reminder`.
   - Ela usa uma tabela temporária `_recipients` e faz `DELETE FROM _recipients` sem `WHERE`, algo bloqueado pelo backend por segurança.

2. `ON CONFLICT does not support deferrable unique constraints/exclusion constraints as arbiters`
   - Vem do `ON CONFLICT (task_id, kind)` em `sync_task_auto_reminders`.
   - A constraint `UNIQUE (task_id, kind)` foi criada como `DEFERRABLE`, e Postgres não aceita esse tipo de constraint como alvo de `ON CONFLICT`.

Além disso, a criação de lembrete manual pelo WhatsApp sempre usa `kind: 'custom'`, mas a tabela tem unicidade em `(task_id, kind)`, o que impede mais de um lembrete personalizado por tarefa. Isso conflita com a expectativa de criar vários lembretes/agendamentos.

## Plano de correção

1. Criar uma migration no backend para ajustar a modelagem de lembretes:
   - Remover a constraint deferrable atual de `task_reminders`.
   - Criar um índice único parcial apenas para lembretes automáticos por tarefa/tipo:
     - único quando `auto_generated = true`
     - permite múltiplos lembretes `custom` na mesma tarefa.

2. Reescrever `public.expand_task_reminder` para não usar tabela temporária nem `DELETE` sem `WHERE`:
   - calcular destinatários com CTE/loops seguros;
   - manter a expansão idempotente para `scheduled_reminders`;
   - continuar cancelando filas pendentes quando horário/canal/destinatário muda.

3. Ajustar `public.sync_task_auto_reminders`:
   - trocar o `ON CONFLICT (task_id, kind)` problemático por lógica explícita de `SELECT/UPDATE/INSERT`;
   - manter o comportamento automático de lembretes baseados em prazo/início;
   - evitar falhas causadas por constraints deferrable.

4. Revisar o webhook `whatsapp-webhook` para melhorar a resposta ao usuário:
   - quando a criação falhar, retornar uma mensagem amigável em português sem expor erro técnico bruto;
   - manter a confirmação com data, horário, tarefa e opções rápidas;
   - garantir que pedidos como “me lembre 1h antes” continuem criando agendamento para envio automático no horário pedido.

5. Validar depois da implementação:
   - rodar o linter do backend se disponível;
   - conferir que a migration contém os ajustes sem alterar permissões/RLS indevidamente;
   - orientar um teste real: criar uma tarefa/lembrete pelo WhatsApp e confirmar que ele agenda sem os erros mostrados no print.