

# Promover fabio.gasparr@gmail.com a Super Admin

O usuário foi encontrado: **Fabio** (`ebaffc33-ad4b-45e1-bde3-e42e62cde9d9`).

O valor `super_admin` ainda não existe no enum `app_role` (atual: `admin`, `member`), então precisa de uma migração primeiro.

## Passos

### 1. Migração — Adicionar `super_admin` ao enum + função `is_super_admin()`

```sql
ALTER TYPE public.app_role ADD VALUE 'super_admin';
```

Criar função auxiliar:
```sql
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'super_admin'
  )
$$;
```

### 2. Migração — RLS para super_admin acessar dados globais

Políticas permitindo super_admin ler todas as `profiles`, `user_roles`, `tasks` e `gamification`.

### 3. Inserir role para o usuário Fabio

```sql
INSERT INTO public.user_roles (user_id, role)
VALUES ('ebaffc33-ad4b-45e1-bde3-e42e62cde9d9', 'super_admin');
```

### 4. Criar página Admin e hook de guarda

- `src/hooks/useAdminGuard.ts` — verifica se usuário tem role `super_admin`
- `src/pages/AdminPage.tsx` — dashboard com abas: Usuários, Visão Geral, Planos (em breve)
- Atualizar `src/App.tsx` com rota `/admin`
- Atualizar `src/components/AppSidebar.tsx` com link condicional para Admin

