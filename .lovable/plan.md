

# Adicionar Data de Início e Conclusão nas Tarefas

## Problema

Tarefas só têm `due_date`, `created_at` e `updated_at` — não registram quando foram iniciadas ou concluídas.

## Mudanças

### Banco de Dados
Migração: adicionar `started_at` e `completed_at` (timestamptz, nullable) à tabela `tasks`.

### Frontend

| Arquivo | Mudança |
|---------|---------|
| `src/types/task.ts` | Adicionar `started_at` e `completed_at` ao tipo `Task` |
| `src/hooks/useTasks.ts` | Ao mudar status para `in_progress` → setar `started_at`. Ao mudar para `completed`/`eliminated` → setar `completed_at` |
| `src/components/TaskDetailSheet.tsx` | Exibir datas de início e conclusão quando existirem |

As datas são preenchidas automaticamente quando o status muda — sem input manual.

