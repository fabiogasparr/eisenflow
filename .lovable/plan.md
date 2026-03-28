

# Correção: Lembretes WhatsApp Duplicados a cada 15 min

## Problema

1. **Dois cron jobs duplicados** chamando `whatsapp-deadline-reminders`: um a cada 15 min (job 5) e outro a cada 30 min (job 3)
2. **Sem controle de deduplicação** — a função envia o mesmo lembrete toda vez que roda, sem verificar se já enviou

## Solução

### 1. Remover cron jobs duplicados e criar um único com frequência adequada

Deletar ambos os jobs (3 e 5) e criar um único job que roda **a cada 4 horas** (3x ao dia: manhã, tarde, noite). Lembretes de 24h não precisam ser enviados a cada 15 minutos.

```sql
SELECT cron.unschedule(3);
SELECT cron.unschedule(5);

SELECT cron.schedule(
  'whatsapp-deadline-reminders-4h',
  '0 8,12,18 * * *',  -- 8h, 12h, 18h
  $$ ... $$
);
```

### 2. Adicionar tabela de controle de lembretes enviados

Criar `whatsapp_sent_reminders` para rastrear quais lembretes já foram enviados por tarefa/usuário/tipo, evitando reenvio.

```sql
CREATE TABLE public.whatsapp_sent_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  reminder_type text NOT NULL, -- '24h', '1h', 'now'
  sent_at timestamptz DEFAULT now(),
  UNIQUE(user_id, task_id, reminder_type)
);
```

### 3. Atualizar edge function para verificar antes de enviar

Na `whatsapp-deadline-reminders/index.ts`:
- Antes de enviar, consultar `whatsapp_sent_reminders` para ver se o lembrete daquela tarefa/tipo já foi enviado
- Após enviar com sucesso, inserir registro na tabela
- Cleanup automático: deletar registros com mais de 48h

### Arquivos modificados

| Recurso | Ação |
|---------|------|
| Cron jobs (SQL direto) | Deletar jobs 3 e 5, criar 1 novo |
| Migração SQL | Tabela `whatsapp_sent_reminders` |
| `supabase/functions/whatsapp-deadline-reminders/index.ts` | Dedup check antes de enviar |

