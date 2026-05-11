## Objetivo

Tirar tarefas concluídas dos quadrantes da Matriz e mover para uma nova área "Concluídas" com relatório e estatísticas (incluindo tempo de execução).

## Mudanças

### 1. `src/pages/Index.tsx` — esconder concluídas da Matriz
- No `matrixTasks` e `inProgressTasks`, filtrar fora `status === 'completed'` (e também `eliminated`, que já tem o quadrante "Eliminar" como destino — manter `eliminated` apenas se estiver no quadrante eliminate? **Decisão:** apenas `completed` sai da matriz; `eliminated` continua aparecendo no quadrante Eliminar como hoje).
- Resultado: as tarefas riscadas mostradas no print (Inauguração da quadra, etc.) deixam de aparecer na Matriz.

### 2. Nova página `src/pages/CompletedTasks.tsx`
Rota: `/completed`. Item no `AppSidebar` com ícone `CheckCircle2` ("Concluídas" / "Completed"), entre **Métricas** e **Conquistas**.

**Cabeçalho com cards de estatísticas** (cobre o período selecionado):
- Total concluídas
- Tempo médio de execução (`completed_at − started_at`, ignorando tarefas sem `started_at`)
- Tempo total acumulado em foco/execução
- Distribuição por quadrante (mini barra/pills com contagem)
- Concluídas por dia (gráfico de barras simples dos últimos 14 dias usando `recharts`, já no projeto via `chart.tsx`)

**Filtros**:
- Período: Hoje · 7 dias · 30 dias · Tudo (default 30 dias)
- Quadrante: todos · Fazer · Agendar · Delegar · Eliminar
- Busca por título

**Lista/tabela**:
- Coluna: título, quadrante (chip colorido), data de conclusão, tempo de execução (formatado `2h 15min` ou `—` se sem `started_at`), botão "Reabrir" (volta status para `pending`).
- Ordenação por `completed_at desc`.
- Estado vazio amigável.

### 3. Hook utilitário (inline na página)
Reusar `useTasks()` e derivar `completedTasks = tasks.filter(t => t.status === 'completed')`. Sem novo hook.

### 4. `src/components/AppSidebar.tsx` + `src/components/BottomNav.tsx`
Adicionar entrada "Concluídas" → `/completed` (ícone `CheckCircle2`).

### 5. `src/App.tsx`
Adicionar `<Route path="/completed" ... />`.

### 6. i18n `src/i18n/translations.ts`
Strings novas: `completed.title`, `completed.empty`, `completed.reopen`, `completed.avgTime`, `completed.totalTime`, `completed.totalCount`, `completed.byDay`, `completed.byQuadrant`, `completed.filter.period.*`, `completed.executionTime`, `nav.completed`.

## Fora de escopo
- Não alterar schema do banco (já temos `started_at` e `completed_at`).
- Não mexer em sync Google Calendar.
- Não tocar em "Eliminar" (continua como quadrante).
- Métricas existentes em `/metrics` permanecem; a nova página foca no histórico de concluídas.
