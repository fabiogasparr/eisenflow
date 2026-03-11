

# Melhorias Visuais: Cards, Backlog Semanal e Indicador de Status

## Mudanças

### 1. TaskCard (Matriz) — Simplificar e adicionar indicador de status
**`src/components/TaskCard.tsx`**
- Mostrar apenas o título no card (remover descrição, tags, tempo estimado, impact_score)
- Adicionar borda lateral colorida por quadrante (border-left com cor do quadrante)
- Tarefas `in_progress`: borda pulsante + badge "Em progresso"
- Tarefas `completed`: texto riscado + opacidade reduzida
- Detalhes só aparecem ao clicar (já abre o TaskDetailSheet)

### 2. WeeklyPlanner — Transformar sidebar em Backlog e distribuir por `started_at`
**`src/pages/WeeklyPlanner.tsx`**
- **Sidebar "Backlog"**: Renomear para "Backlog" e mostrar TODAS as tarefas sem `due_date` E sem `started_at` (não iniciadas)
- **Distribuição nos dias**: Tarefas aparecem no dia correspondente ao `started_at` (data de início) OU `due_date`
- **DraggableWeekTask simplificado**: Mostrar só título + borda lateral colorida por quadrante
- Cores dos cards por quadrante: borda esquerda verde (do), laranja (schedule), azul (delegate), vermelho (eliminate)
- Badge visual para `in_progress` nos cards do planejamento semanal

### 3. Cores dos quadrantes nos cards
Ambos os componentes usarão uma borda esquerda com a cor do quadrante (usando as CSS vars `--quadrant-do`, `--quadrant-schedule`, etc.) para identificar visualmente a categoria da tarefa.

## Arquivos

| Arquivo | Mudança |
|---------|---------|
| `src/components/TaskCard.tsx` | Simplificar card (só título), borda colorida por quadrante, badge in_progress |
| `src/pages/WeeklyPlanner.tsx` | Sidebar → Backlog, distribuir por `started_at`, cards simplificados com cor |

