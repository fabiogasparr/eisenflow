# Reordenar imagens anexadas por arrastar-e-soltar

## Objetivo
No Chat de IA, permitir reorganizar as miniaturas das imagens pendentes (antes de enviar) com drag-and-drop, mantendo todas as ações já existentes (ampliar, remover, "Limpar tudo").

## Implementação

### Biblioteca
Usar `@dnd-kit/core` + `@dnd-kit/sortable` (já instalados no projeto, mesmo padrão da Matriz).

### Arquivo único: `src/pages/AIChatPage.tsx`
- Adicionar `id` estável a cada `PendingImage` (gerar `crypto.randomUUID()` ao aceitar o arquivo) para servir de chave do `SortableContext`.
- Envolver a grade de miniaturas (linhas ~417) em `<DndContext>` + `<SortableContext strategy={rectSortingStrategy}>`.
- Extrair cada miniatura para um pequeno componente `SortableThumb` que usa `useSortable({ id })` e aplica `transform`/`transition` via `CSS.Transform`.
- Sensores: `PointerSensor` (distance: 8) + `TouchSensor` (delay: 200, tolerance: 5) — ativação por delay no toque para não conflitar com o tap que abre o preview.
- `onDragEnd`: usa `arrayMove` para reordenar `pending` mantendo o estado.
- `removePending` passa a buscar por `id` em vez de índice.
- Cursor `grab`/`grabbing` e leve `ring`/elevação enquanto arrasta para feedback visual.

### Comportamento preservado
- Clique simples na miniatura → abre o `Dialog` de preview.
- Botão "X" por imagem → remove (agora por id).
- Botão "Limpar tudo" → inalterado.
- Ordem reordenada é a ordem usada no upload e no envio para a IA.

### Acessibilidade
- `KeyboardSensor` com `sortableKeyboardCoordinates` para reordenar via teclado (Tab + Setas).
- `aria-label` nas miniaturas com posição atual ("Imagem 2 de 4").

## O que NÃO muda
- Lógica de upload, envio, preview, validação de limite, OCR/análise.
- Componente de mensagens anteriores ou histórico.

## Arquivos tocados
- `src/pages/AIChatPage.tsx` (único)
