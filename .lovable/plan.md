

# Correção do Arrastar e Soltar

## Problema

O drag-and-drop usa apenas `PointerSensor`, que não funciona bem em dispositivos touch. Além disso, o `useSwipeGesture` no `TaskCard` captura os eventos de toque (`onTouchStart/Move/End`) antes do sensor de drag conseguir ativá-los, criando um conflito.

## Solução

### 1. Adicionar `TouchSensor` nos sensores (Index.tsx e WeeklyPlanner.tsx)

Importar `TouchSensor` do `@dnd-kit/core` e adicioná-lo ao array de sensores com `activationConstraint: { delay: 250, tolerance: 5 }`. O delay permite distinguir entre toque rápido (swipe) e toque longo (drag).

### 2. Desabilitar swipe quando drag está ativo

No `TaskCard`, o `useSwipeGesture` já recebe `disabled: isDragging`. Isso está correto, mas o conflito ocorre porque ambos reagem ao mesmo evento. Com o `TouchSensor` usando delay, o drag só ativa após segurar 250ms, permitindo que o swipe funcione normalmente em toques rápidos.

### 3. Melhorar o grip handle no TaskCard

O botão de grip (`GripVertical`) tem `opacity-0` no desktop com hover. No mobile, ele deveria estar sempre visível para indicar que é arrastável.

### Arquivos modificados

| Arquivo | Mudança |
|---------|---------|
| `src/pages/Index.tsx` | Adicionar `TouchSensor` com delay de 250ms |
| `src/pages/WeeklyPlanner.tsx` | Adicionar `TouchSensor` com delay de 250ms |

