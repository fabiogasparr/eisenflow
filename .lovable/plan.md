

# Cards mais compactos no Planejamento Semanal

Concordo — os cards estão alongados e com muito padding. Vou torná-los mais quadrados e compactos para caberem melhor nas colunas.

## Mudanças

**`src/pages/WeeklyPlanner.tsx`** — Componente `DraggableWeekTask`:
- Reduzir padding de `p-2` para `p-1.5`
- Reduzir gap interno de `gap-2` para `gap-1`
- Reduzir o ícone de grip de `h-3 w-3` para `h-2.5 w-2.5`
- Texto de `text-xs` para `text-[11px]`
- Reduzir border-left de `border-l-4` para `border-l-[3px]`
- Badge in_progress mais compacto
- Reduzir `rounded-lg` para `rounded-md`
- Reduzir espaçamento entre cards de `space-y-1.5` para `space-y-1`

Resultado: cards mais quadrados e densos, cabendo mais tarefas por coluna.

