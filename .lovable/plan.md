

## Plano: Responsividade Mobile Completa

### Problemas identificados

1. **Index (Matriz)**: Grid 2x2 fica apertado em telas pequenas; seção "Em Andamento" usa grid fixo
2. **WeeklyPlanner**: Backlog lateral fixo `w-56` não funciona em mobile; grid de 5-7 colunas ilegível
3. **AppHeader**: Barra de busca + botões ocupam muito espaço horizontal
4. **Metrics**: Grid `grid-cols-2 md:grid-cols-4` ok, mas gráficos podem cortar; Pomodoro stats `grid-cols-2 md:grid-cols-3` com texto grande
5. **Gamification**: Life Score layout horizontal (`flex items-center gap-8`) quebra em telas estreitas
6. **SettingsPage**: `max-w-xs` nos toggles ok, mas `w-60`/`w-48` fixos podem não caber
7. **Sidebar**: Já usa `collapsible="icon"`, precisa verificar se fecha automaticamente no mobile

### Mudanças por arquivo

**`src/pages/Index.tsx`**
- Matriz: mudar para `grid-cols-1 sm:grid-cols-2 grid-rows-none` em mobile (empilha quadrantes verticalmente)
- In Progress: `grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4`

**`src/pages/WeeklyPlanner.tsx`**
- Mobile: esconder backlog lateral, mostrar como seção colapsável acima
- Semana: `grid-cols-1 sm:grid-cols-2 md:grid-cols-${colCount}` com scroll horizontal em mobile
- Header de navegação: empilhar título e controles em mobile
- Alternativa mais simples: backlog como drawer/collapsible no mobile, dias em scroll horizontal

**`src/components/AppHeader.tsx`**
- Busca: esconder em mobile, mostrar com toggle
- Ou: busca ocupa linha inteira em mobile, botões em linha separada

**`src/pages/Metrics.tsx`**
- Stats cards: `grid-cols-2` já funciona
- Pomodoro: `grid-cols-1 sm:grid-cols-3` para números grandes
- Gráficos: altura menor em mobile (`h-[200px] md:h-[300px]`)

**`src/pages/Gamification.tsx`**
- Life Score: empilhar score e barras verticalmente em mobile (`flex-col md:flex-row`)
- Badges grid: `grid-cols-2 sm:grid-cols-3`

**`src/pages/SettingsPage.tsx`**
- Selects com largura `w-full sm:w-48/60`
- Layout dos toggles: `flex-col sm:flex-row` quando necessário

**`src/components/QuadrantDropZone.tsx`**
- `max-h` ajustado para mobile: `max-h-[40vh] sm:max-h-[calc(50vh-80px)]`

**`src/index.css` / `tailwind.config.ts`**
- Sem mudanças necessárias

### Resumo
~7 arquivos modificados, foco em classes Tailwind responsivas (`sm:`, `md:`, `lg:`). Nenhuma mudança de lógica, apenas layout adaptativo.

