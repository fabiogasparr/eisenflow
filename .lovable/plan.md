

# Visualizar Usuários por Tenant (Time)

## Problema
O super admin não consegue ver os times e seus membros porque as políticas RLS das tabelas `teams` e `team_members` só permitem acesso a membros do próprio time.

## Solução

### 1. Migração — RLS para super admin ler todos os times e membros

```sql
CREATE POLICY "Super admins can view all teams"
ON public.teams FOR SELECT TO authenticated
USING (is_super_admin());

CREATE POLICY "Super admins can view all team members"
ON public.team_members FOR SELECT TO authenticated
USING (is_super_admin());
```

### 2. Adicionar aba "Tenants" na página Admin (`src/pages/AdminPage.tsx`)

- Nova aba entre "Usuários" e "Planos" com ícone `Building2`
- Fetch de `teams` (todos os times) e `team_members` com join em `profiles` para mostrar nomes
- Cada time exibido como um Card com:
  - Nome do time, descrição, data de criação
  - Contagem de membros
  - Lista expansível de membros com nome, papel (admin/manager/member) e data de entrada
- Dados carregados junto com o fetch inicial no `useEffect`

### Arquivos modificados
- `src/pages/AdminPage.tsx` — adicionar estado, fetch e aba "Tenants"
- 1 migração SQL — políticas RLS para `teams` e `team_members`

