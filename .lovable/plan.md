

# Atualização automática dos quadrantes via Realtime

## Problema
Quando o webhook do WhatsApp cria/atualiza/exclui tarefas, a interface só reflete as mudanças após refresh manual ou navegação.

## Solução
Habilitar Supabase Realtime na tabela `tasks` e adicionar uma subscription no hook `useTasks.ts` que invalida o cache automaticamente quando qualquer mudança ocorre.

## Alterações

### 1. Migration SQL
Adicionar a tabela `tasks` à publicação Realtime:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
```

### 2. `src/hooks/useTasks.ts`
Adicionar `useEffect` que cria um channel Realtime escutando `postgres_changes` na tabela `tasks` filtrado pelo `created_by` do usuário. Ao receber qualquer evento (`INSERT`, `UPDATE`, `DELETE`), chamar `queryClient.invalidateQueries({ queryKey: ['tasks'] })` para atualizar os quadrantes instantaneamente.

```typescript
useEffect(() => {
  if (!user) return;
  const channel = supabase
    .channel('tasks-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}, [user, queryClient]);
```

## Arquivos
- Migration SQL (nova) -- habilitar realtime
- `src/hooks/useTasks.ts` -- adicionar subscription realtime

