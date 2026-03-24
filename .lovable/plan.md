

# Pull-to-Refresh na Matriz de Tarefas (Mobile)

## O que será feito

Adicionar gesto de pull-to-refresh na página principal para que o usuário possa puxar a tela para baixo e atualizar as tarefas no mobile — padrão nativo de apps móveis.

## Mudanças

### 1. Criar hook `usePullToRefresh` (`src/hooks/usePullToRefresh.ts`)
- Touch events nativos para detectar pull-down quando scroll está no topo
- Estado: `pullDistance`, `isRefreshing`, `isPulling`
- Threshold de 60px para acionar refresh
- Spinner visual com ícone `RefreshCw` rotacionando durante refresh
- Resistência progressiva ao puxar (easing)
- Retorna ref do container + componente indicador

### 2. Atualizar `Index.tsx` (`src/pages/Index.tsx`)
- Usar `usePullToRefresh` no container principal da matriz
- No callback de refresh, chamar `queryClient.invalidateQueries(['tasks'])` via `useTasks` (expor `refetch`)
- Renderizar indicador de pull acima do conteúdo (spinner animado + texto "Atualizando...")
- Só ativar no mobile (via `useIsMobile`)

### 3. Expor `refetch` no `useTasks` (`src/hooks/useTasks.ts`)
- Retornar `refetch: tasksQuery.refetch` no objeto de retorno do hook

### Detalhes técnicos
- Touch events com `onTouchStart/Move/End` no wrapper scrollável
- Só ativa quando `scrollTop === 0` e direção é para baixo
- `transform: translateY(pullDistance)` no conteúdo durante o pull
- Ícone `RefreshCw` com `animate-spin` durante refresh
- Timeout mínimo de 500ms para feedback visual mesmo em refresh rápido
- Desabilitado no desktop (mouse não faz pull-to-refresh)

### Arquivos modificados
- `src/hooks/usePullToRefresh.ts` — novo hook
- `src/hooks/useTasks.ts` — expor refetch
- `src/pages/Index.tsx` — integrar pull-to-refresh

