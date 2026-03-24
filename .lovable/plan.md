

# Calendário Unificado: App + Google Calendar

## Problema

1. **Eventos do Google não aparecem no calendário** — O calendário atual (`WeeklyPlanner`) só mostra tarefas do banco de dados. Eventos do Google Calendar só aparecem se forem importados como tarefas (criando duplicação).
2. **Sem visualização mesclada** — Não há forma de ver eventos nativos do Google Calendar lado a lado com as tarefas do app.
3. **Evento de 24/abril pode não ter sido importado** — A importação automática roda uma vez por sessão e pode ter falhado ou o evento pode estar fora do range de 30 dias.

## Solução

Criar um calendário unificado que busca eventos diretamente da API do Google Calendar (via edge function) e os exibe junto com as tarefas do app, sem precisar importá-los como tarefas.

## Mudanças

### 1. Hook `useGoogleCalendarEvents` (novo: `src/hooks/useGoogleCalendarEvents.ts`)

- Query que chama `google-calendar-sync` com action `list-events`, passando `timeMin`/`timeMax` baseados no período visível (semana ou mês atual)
- Retorna array de eventos Google com `{ id, summary, description, start, end, htmlLink }`
- Re-fetches quando o período muda (navegação semana/mês)
- Só ativa se Google Calendar estiver conectado

### 2. Tipo `CalendarItem` (union type)

```text
CalendarItem = 
  | { type: 'task'; data: Task }
  | { type: 'google-event'; data: GoogleEvent }
```

Permite diferenciar visualmente e tratar cada tipo de item.

### 3. Atualizar `WeeklyPlanner.tsx`

- Importar `useGoogleCalendar` e o novo `useGoogleCalendarEvents`
- Passar `timeMin`/`timeMax` baseados no período visível
- No `getTasksForDay`, mesclar tarefas + eventos Google, ordenados por horário
- Renderizar eventos Google com estilo diferenciado (ícone do Google Calendar, cor azul, sem drag-and-drop)
- Eventos Google são read-only no calendário (clicáveis para abrir no Google Calendar via `htmlLink`)

### 4. Componente `GoogleEventCard` (inline no WeeklyPlanner ou componente separado)

- Visual diferente das tarefas: borda azul Google, ícone de calendário, horário visível
- Sem grip/drag (não são arrastáveis)
- Click abre o evento no Google Calendar (nova aba)
- Tooltip com detalhes (horário, descrição)

### 5. Ajustar edge function `google-calendar-sync`

- A action `list-events` já existe e funciona
- Garantir que aceita `timeMin`/`timeMax` como parâmetros do body (já aceita)
- Nenhuma mudança necessária na edge function

### 6. Indicador de loading

- Skeleton sutil enquanto eventos Google carregam
- Badge "Google Calendar" no header quando eventos estão sendo exibidos

## Arquivos

| Arquivo | Ação |
|---------|------|
| `src/hooks/useGoogleCalendarEvents.ts` | Criar — query de eventos por período |
| `src/pages/WeeklyPlanner.tsx` | Modificar — mesclar eventos Google + tarefas |
| `src/hooks/useGoogleCalendar.ts` | Sem mudanças |
| `supabase/functions/google-calendar-sync/index.ts` | Sem mudanças |

## Detalhes técnicos

- Eventos Google são buscados via `supabase.functions.invoke('google-calendar-sync', { body: { action: 'list-events', timeMin, timeMax } })`
- O período é recalculado quando o usuário navega (semana anterior/próxima, mês anterior/próximo)
- `staleTime` de 5 minutos para evitar chamadas excessivas à API do Google
- Eventos Google sem `dateTime` (eventos de dia inteiro) usam `date` como referência

