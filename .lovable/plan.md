

# Melhorar Visualização Mobile e Fluidez do App

## Problemas Identificados

1. **TaskCard** chama `useSubtasks(task.id)` para cada tarefa — isso gera uma query individual por card, causando lentidão (N+1 queries)
2. **TaskDetailSheet** no mobile (imagem do usuário) ocupa a tela inteira mas com muito espaço desperdiçado e scroll longo
3. **QuadrantDropZone** usa `max-h-[40vh]` que no mobile (grid 1 coluna) fica muito comprimido
4. **TaskCard** tem `animate-pulse` para in_progress — animação CSS contínua prejudica performance
5. **Drag grip** invisível no mobile (só aparece no hover) — touch não tem hover

## Solução

### 1. Eliminar N+1 queries nos TaskCards (`src/components/TaskCard.tsx`)
- Remover `useSubtasks(task.id)` do TaskCard — cada card faz uma query separada ao banco
- Mover a contagem de subtasks para dados pré-carregados ou simplesmente não exibir no card da matriz (exibir apenas no TaskDetailSheet)
- Impacto: reduz drasticamente o número de queries e melhora a fluidez de scroll

### 2. Melhorar TaskCard para mobile (`src/components/TaskCard.tsx`)
- Remover `animate-pulse` do status in_progress (substituir por indicador estático: bolinha verde pulsante via CSS `animate-ping` apenas no dot, não no card inteiro)
- Tornar o grip handle sempre visível no mobile via `opacity-60 md:opacity-0 md:group-hover:opacity-60`
- Adicionar info visual de prazo (due date) como badge compacto quando existir

### 3. Ajustar QuadrantDropZone para mobile (`src/components/QuadrantDropZone.tsx`)
- Mudar `max-h-[40vh]` para `max-h-[35vh] md:max-h-[calc(50vh-80px)]` — no mobile os 4 quadrantes empilhados precisam de altura controlada
- Reduzir padding do header de `py-3` para `py-2` no mobile para ganhar espaço
- Compactar a área vazia (reduzir `py-8` para `py-4`)

### 4. Melhorar TaskDetailSheet no mobile (`src/components/TaskDetailSheet.tsx`)
- Usar `side="bottom"` no Sheet para mobile (mais natural no celular, desliza de baixo para cima)
- Definir `max-h-[85dvh]` para não cobrir a tela inteira
- Agrupar campos em seções colapsáveis ou mais compactas

### 5. Otimizar a página Index para mobile (`src/pages/Index.tsx`)
- Reduzir padding de `p-4 md:p-6` para `p-2 md:p-6`
- Reduzir gap do grid de `gap-3` para `gap-2 md:gap-3`
- Seção In Progress: reduzir padding interno

### Arquivos modificados
- `src/components/TaskCard.tsx` — remover useSubtasks, melhorar visual mobile
- `src/components/QuadrantDropZone.tsx` — ajustar alturas e espaçamentos mobile
- `src/components/TaskDetailSheet.tsx` — sheet bottom no mobile, layout compacto
- `src/pages/Index.tsx` — reduzir espaçamentos no mobile

