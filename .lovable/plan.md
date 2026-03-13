

# Subtarefas/Checklists + Recorrência de Tarefas

## 1. Subtarefas e Checklists

### Database
Nova tabela `subtasks`:
```sql
CREATE TABLE subtasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title text NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- RLS: mesmas regras da task pai (via join com tasks)
```

### Código
| Arquivo | Mudança |
|---------|---------|
| `src/hooks/useSubtasks.ts` | Novo hook: CRUD de subtasks por task_id |
| `src/components/TaskDetailSheet.tsx` | Seção de checklist: listar subtasks com checkbox, input para adicionar nova, barra de progresso |
| `src/components/TaskCard.tsx` | Indicador "2/5" de subtasks completas quando existirem |
| `src/types/task.ts` | Interface `Subtask` |

### UX
- No detalhe da tarefa: lista de itens com checkbox + campo para adicionar
- Barra de progresso visual (ex: 3/5 = 60%)
- No card da tarefa na matrix: badge discreto "3/5 ✓"

---

## 2. Recorrência de Tarefas

### Database
Novos campos na tabela `tasks`:
```sql
ALTER TABLE tasks ADD COLUMN recurrence_rule text; -- 'daily', 'weekly', 'monthly', null
ALTER TABLE tasks ADD COLUMN recurrence_parent_id uuid REFERENCES tasks(id);
```

### Backend
Edge function `generate-recurring-tasks` executada via `pg_cron` (1x/dia):
- Busca tarefas com `recurrence_rule IS NOT NULL` e `status IN ('completed','eliminated')`
- Cria cópia com status `pending`, nova `due_date` calculada, linkando `recurrence_parent_id`

### Código
| Arquivo | Mudança |
|---------|---------|
| `src/components/CreateTaskDialog.tsx` | Select de recorrência: Nenhuma / Diária / Semanal / Mensal |
| `src/components/TaskDetailSheet.tsx` | Badge indicando recorrência + opção de remover recorrência |
| `src/components/TaskCard.tsx` | Ícone de recorrência (🔄) quando `recurrence_rule` existe |
| `src/types/task.ts` | Campos `recurrence_rule` e `recurrence_parent_id` na interface |
| `src/hooks/useTasks.ts` | Incluir novos campos no create |
| `supabase/functions/generate-recurring-tasks/index.ts` | Nova edge function |

### Fluxo
1. Usuário cria tarefa com recorrência "semanal"
2. Ao completar, o cron diário detecta e cria a próxima ocorrência automaticamente
3. A nova tarefa herda título, descrição, quadrante, tags, urgência e importância

---

## Ordem de implementação
1. Migration (subtasks table + recurrence columns)
2. Hook `useSubtasks` + UI de checklist no `TaskDetailSheet`
3. Indicador no `TaskCard`
4. Recorrência no `CreateTaskDialog` e `TaskDetailSheet`
5. Edge function + cron job para geração automática

