

## Plano: Substituir input de data por Calendar Picker

Substituir o `<Input type="datetime-local">` do campo "Prazo" por um **Popover com Calendar + seletores de hora/minuto**, otimizado para mobile.

### Mudanças em `src/components/CreateTaskDialog.tsx`

1. **Trocar o estado `dueDate`** de string ISO para `Date | undefined` + hora/minuto separados (ou manter string e converter)
2. **Substituir o input** por um `Popover` com:
   - `Calendar` (mode="single") para escolher a data
   - Dois `Select` (hora 0-23, minuto 0-59) abaixo do calendário
3. **Botão trigger** mostra a data formatada ou placeholder "dd/mm/aaaa, --:--"
4. **Na submissão**, converter `Date` + hora/minuto para string ISO
5. **Mobile**: usar `className="w-full"` no trigger, `pointer-events-auto` no Calendar

### Imports adicionais
- `Calendar` de `@/components/ui/calendar`
- `Popover`, `PopoverTrigger`, `PopoverContent` de `@/components/ui/popover`
- `format` de `date-fns`
- `CalendarIcon` de `lucide-react`

### Layout mobile
- O grid `grid-cols-2` do prazo + tempo estimado muda para `grid-cols-1` em telas pequenas via `sm:grid-cols-2`

