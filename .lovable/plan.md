

# Auto-criar Tenant Pessoal para cada Usuário

## Problema

Atualmente, um usuário precisa ir manualmente à página de Organização para criar um tenant. O usuário espera que, ao se cadastrar, já tenha automaticamente seu próprio "workspace pessoal" (tenant), pois ele é tanto um usuário quanto uma organização.

## Solução

Criar automaticamente um tenant pessoal para cada novo usuário no momento do cadastro, via trigger no banco de dados.

## Mudanças

### 1. Trigger no banco: auto-criar tenant ao criar profile

Criar uma função `handle_new_user_tenant()` que dispara após INSERT na tabela `profiles`:
- Cria um tenant com `name = display_name`, `slug = user_id` (garante unicidade), `created_by = user_id`
- O trigger existente `handle_new_tenant` já insere o usuário como `owner` em `tenant_members` automaticamente

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.tenants (name, slug, created_by)
  VALUES (
    COALESCE(NEW.display_name, 'Meu Workspace'),
    NEW.user_id::text,
    NEW.user_id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_profile_created_create_tenant
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_tenant();
```

### 2. Migração para usuários existentes

Script SQL que cria tenants para todos os usuários que ainda não possuem um:
- Para cada `profiles.user_id` que não está em `tenant_members`, cria um tenant pessoal

### 3. Ajustar `useTenantContext` — auto-selecionar tenant

Já existe a lógica de auto-selecionar o primeiro tenant. Com o tenant pessoal sempre existindo, o contexto será preenchido automaticamente ao logar.

### Arquivos modificados
| Arquivo | Ação |
|---------|------|
| Migração SQL | Trigger + backfill de tenants existentes |
| Nenhum arquivo frontend | O comportamento já funciona com o tenant auto-criado |

