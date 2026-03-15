

# Fix: Erro RLS ao criar time

## Diagnóstico

O erro "new row violates row-level security policy for table 'teams'" ocorre ao inserir na tabela `teams`. A política INSERT verifica `auth.uid() = created_by`, e o código define `created_by: user.id` — tudo parece correto.

Após investigação detalhada, a causa mais provável é que o PostgreSQL, ao processar `INSERT ... RETURNING` (causado pelo `.select().single()` encadeado), também avalia as políticas SELECT sobre a nova linha. A política SELECT de `teams` exige `is_team_member(auth.uid(), id)`. Embora o trigger `handle_new_team` adicione o membro APÓS o insert, há uma possível condição de corrida na avaliação.

## Correção

### 1. Migração SQL
- Adicionar uma política SELECT permissiva para criadores do time: `auth.uid() = created_by`
- Definir valor padrão `auth.uid()` na coluna `created_by` como segurança adicional

```sql
-- Permitir ao criador ver o time recém-criado (evita falha no RETURNING)
CREATE POLICY "Creators can view their teams"
ON public.teams FOR SELECT TO authenticated
USING (auth.uid() = created_by);

-- Default defensivo
ALTER TABLE public.teams ALTER COLUMN created_by SET DEFAULT auth.uid();
```

### 2. Nenhuma alteração no frontend
O código em `useTeams.ts` já está correto.

### Arquivos modificados
- Nova migração SQL (1 arquivo)

