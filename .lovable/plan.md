

# Swipe Gestures nos Task Cards (Mobile)

## O que será feito

Adicionar gestos de deslizar (swipe) nos task cards no mobile:
- **Swipe para a direita** → Completar tarefa (ícone verde com check)
- **Swipe para a esquerda** → Deletar tarefa (ícone vermelho com lixeira)

A implementação será feita com CSS transforms e touch events nativos (sem dependência externa), mantendo compatibilidade com o drag-and-drop existente do dnd-kit.

## Mudanças

### 1. Criar hook `useSwipeGesture` (`src/hooks/useSwipeGesture.ts`)
- Detecta touch start/move/end com threshold de 80px para ativar ação
- Retorna o offset X atual e handlers de touch
- Só ativa no mobile (ignora se `pointer: fine` / mouse)
- Cancela o swipe se o movimento vertical for maior que o horizontal (scroll)

### 2. Atualizar `TaskCard` (`src/components/TaskCard.tsx`)
- Aceitar novos props opcionais: `onComplete?(task)` e `onDelete?(task)`
- Envolver o card num container com `overflow-hidden` que revela fundo colorido:
  - Fundo verde com ícone `CheckCircle` aparece ao deslizar direita
  - Fundo vermelho com ícone `Trash2` aparece ao deslizar esquerda
- Aplicar o hook de swipe no card; ao soltar acima do threshold, executar ação com animação de saída
- No desktop (sem touch), comportamento inalterado

### 3. Atualizar `QuadrantDropZone` (`src/components/QuadrantDropZone.tsx`)
- Passar `onComplete` e `onDelete` para cada `TaskCard`

### 4. Atualizar `Index.tsx` (`src/pages/Index.tsx`)
- Passar callbacks `onSwipeComplete` e `onSwipeDelete` para `QuadrantDropZone`
- Reutilizar a lógica existente de `updateTask` e `deleteTask`

### 5. Atualizar `WeeklyPlanner.tsx`
- Passar os mesmos callbacks para os `DraggableWeekTask` que usam a mesma lógica

### Detalhes técnicos
- Touch events nativos (`onTouchStart/Move/End`) para zero dependências
- `transform: translateX(offset)` com `transition` no release para animação suave
- Threshold de 80px para evitar ativação acidental
- Swipe desabilitado durante drag do dnd-kit (checar `isDragging`)
- Ações com feedback visual: card desliza para fora + toast de confirmação

