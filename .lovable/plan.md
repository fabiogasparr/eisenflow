

## Plano: Implementar processamento por IA no webhook do WhatsApp

### Problema atual
O `whatsapp-webhook` na linha 101 descarta silenciosamente **todas as mensagens que não começam com `/`**. O usuário escolheu que o bot deve aceitar **linguagem natural** e **sempre responder**.

### Solução
Refatorar `whatsapp-webhook/index.ts` para:

1. **Manter comandos com `/`** funcionando como estão (retrocompatibilidade)
2. **Processar mensagens sem `/` via IA** usando o Lovable AI Gateway (`LOVABLE_API_KEY` já configurado)
3. **Sempre responder** ao usuário, mesmo que a mensagem não seja reconhecida

### Fluxo de processamento

```text
Mensagem recebida
       │
       ├── Começa com /  → Processar comando estruturado (como hoje)
       │
       └── Texto livre   → Enviar para IA com contexto das tarefas do usuário
                                │
                                ├── IA retorna create_task    → Criar tarefa no banco
                                ├── IA retorna list_tasks     → Listar tarefas
                                ├── IA retorna complete_task  → Concluir tarefa
                                ├── IA retorna delete_task    → Excluir tarefa
                                ├── IA retorna update_task    → Editar tarefa
                                ├── IA retorna delegate_task  → Delegar tarefa
                                ├── IA retorna schedule_task  → Agendar com prazo
                                └── IA retorna chat_response  → Resposta conversacional
```

### Implementação

O webhook usará o Lovable AI Gateway com tool calling. O system prompt incluirá:
- As tarefas atuais do usuário (para referência por nome/número)
- Os membros dos times (para delegação)
- Instruções para mapear intenções para ações estruturadas

Tools disponíveis para a IA:
- `create_task(title, description, quadrant, urgency, importance, due_date)`
- `list_tasks(filter?)` 
- `complete_task(task_index)`
- `update_task(task_index, fields)`
- `delete_task(task_index)`
- `delegate_task(task_index, member_name)`
- `schedule_task(task_index, due_date)`
- `chat_response(message)`

Após a IA retornar a ação, o webhook executa no banco e envia a resposta formatada via Evolution API.

### Arquivo modificado
- `supabase/functions/whatsapp-webhook/index.ts` -- adicionar processamento IA para mensagens em linguagem natural, mantendo comandos `/` existentes

