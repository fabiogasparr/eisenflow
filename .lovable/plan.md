

# Configurações do Calendário: Visualização e Dias Exibidos

## Resumo

Adicionar nas Configurações opções para o usuário personalizar o calendário do Planejamento Semanal:
1. **Modo de exibição**: Semanal ou Mensal
2. **Dias visíveis**: Semana completa (Seg-Dom) ou apenas dias úteis (Seg-Sex)

As preferências serão salvas no `localStorage` e consumidas pelo `WeeklyPlanner`.

## Mudanças

### 1. Criar hook `useCalendarSettings`
**Novo arquivo: `src/hooks/useCalendarSettings.ts`**
- Estado com duas preferências: `viewMode` (`'weekly' | 'monthly'`) e `showWeekends` (`boolean`)
- Persistência em `localStorage` (chave `eisenflow-calendar-settings`)
- Exporta getter e setter

### 2. Atualizar SettingsPage
**`src/pages/SettingsPage.tsx`**
- Novo card "Calendário" com dois selects:
  - Modo de exibição: Semanal / Mensal
  - Mostrar fins de semana: Sim / Não (switch)

### 3. Atualizar WeeklyPlanner
**`src/pages/WeeklyPlanner.tsx`**
- Consumir `useCalendarSettings`
- **Modo semanal (atual)**: Grid de 5 ou 7 colunas conforme `showWeekends`
- **Modo mensal**: Gerar todos os dias do mês atual, distribuir em grid de calendário (7 colunas, 4-6 linhas), com navegação mês anterior/próximo
- Quando `showWeekends = false`: filtrar sábado e domingo do array de dias (tanto semanal quanto mensal)

### 4. Traduções
**`src/i18n/translations.ts`**
- Adicionar chaves: `calendarSettings`, `viewMode`, `weekly`, `monthly`, `showWeekends`

## Arquivos

| Arquivo | Ação |
|---------|------|
| `src/hooks/useCalendarSettings.ts` | Criar |
| `src/pages/SettingsPage.tsx` | Editar — card calendário |
| `src/pages/WeeklyPlanner.tsx` | Editar — respeitar viewMode e showWeekends |
| `src/i18n/translations.ts` | Editar — novas chaves |

