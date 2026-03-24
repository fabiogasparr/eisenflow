

# Arquitetura Multi-Tenant

## Situação Atual

Não existe conceito de **tenant** no banco de dados. A aba "Tenants" no Admin apenas lista os **times**. O modelo atual trata times como a unidade organizacional principal, sem isolamento de dados entre organizações.

## Modelo Proposto

```text
┌─────────────────────────────────────────────────────┐
│                    TENANT (Org)                     │
│  - Configurações isoladas                           │
│  - Vários usuários (tenant_members)                 │
│  - Vários times internos                            │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Time A   │  │ Time B   │  │ Time C   │          │
│  │ usr1,2,3 │  │ usr2,4   │  │ usr1,5   │          │
│  └──────────┘  └──────────┘  └──────────┘          │
└─────────────────────────────────────────────────────┘

Relações cross-tenant:
- Usr6 (Tenant B) pode participar do Time A (Tenant A)
- Usr7 (sem tenant) pode ser convidado como guest em um Time/Projeto
```

## Mudanças no Banco de Dados

### 1. Tabela `tenants`
- `id`, `name`, `slug` (unique), `logo_url`, `created_by`, `created_at`, `updated_at`
- RLS: membros veem seu tenant; super_admin vê todos

### 2. Tabela `tenant_members`
- `id`, `tenant_id` (FK tenants), `user_id`, `role` (enum: `owner`, `admin`, `member`, `guest`), `joined_at`
- `UNIQUE(tenant_id, user_id)`
- RLS: membros do tenant veem membros do mesmo tenant; super_admin vê todos

### 3. Alterar tabela `teams`
- Adicionar coluna `tenant_id` (uuid, nullable, FK tenants)
- Times com `tenant_id` pertencem a um tenant
- Times sem `tenant_id` são times independentes (cross-tenant ou pessoais)
- Ajustar RLS: membros do tenant podem ver times do tenant

### 4. Alterar tabela `tasks`
- Adicionar coluna `tenant_id` (uuid, nullable, FK tenants)
- Tarefas criadas por membro de um tenant herdam o `tenant_id`
- RLS adicional: membros do tenant veem tarefas do tenant (se no mesmo projeto/time)
- **Guest: pode SELECT e UPDATE, mas NÃO pode DELETE**

### 5. Alterar tabela `projects`
- Adicionar coluna `tenant_id` (uuid, nullable, FK tenants)
- Projetos de um tenant ficam isolados via RLS

### 6. Funções auxiliares (SECURITY DEFINER)
- `get_user_tenant_id(uuid)` → retorna tenant_id do usuário
- `is_tenant_member(uuid, uuid)` → verifica se user é membro do tenant
- `get_tenant_role(uuid, uuid)` → retorna role do user no tenant

### 7. Políticas RLS atualizadas

**Princípio**: dados de um tenant só visíveis para membros daquele tenant. Guests veem apenas o que foi explicitamente compartilhado (time/projeto que foram adicionados).

- `tasks`: adicionar policy "Tenant members can view tenant tasks" usando `is_tenant_member`
- `tasks`: guest policy — SELECT e UPDATE sim, DELETE não
- `projects`: adicionar policy para isolamento por tenant
- `teams`: adicionar policy para times do tenant

## Mudanças no Frontend

### 8. Hook `useTenants` (novo)
- CRUD de tenants
- Listar membros do tenant
- Convidar/remover membros
- Gerenciar configurações do tenant

### 9. Página de Gestão do Tenant
- Novo item no menu lateral "Organização" ou ajustar a página existente
- Listar membros, times, projetos do tenant
- Configurações do tenant (nome, logo, slug)

### 10. Atualizar Admin Page
- Aba "Tenants" passa a listar tenants reais (não times)
- Exibir membros, times e projetos por tenant

### 11. Atualizar fluxo de criação
- Ao criar tarefa/projeto, se o usuário pertence a um tenant, o `tenant_id` é preenchido automaticamente
- Ao criar time, permitir associar a um tenant

### 12. Contexto de Tenant no App
- Hook `useTenantContext` para saber o tenant ativo do usuário logado
- Usado em queries para filtrar dados por tenant

## Arquivos

| Arquivo | Ação |
|---------|------|
| Migração SQL | Criar tabelas `tenants`, `tenant_members`, colunas `tenant_id`, funções, RLS |
| `src/hooks/useTenants.ts` | Criar — CRUD tenants + membros |
| `src/hooks/useTenantContext.ts` | Criar — contexto do tenant ativo |
| `src/pages/AdminPage.tsx` | Modificar — aba Tenants real |
| `src/pages/TeamsPage.tsx` | Modificar — associar times a tenants |
| `src/components/CreateTaskDialog.tsx` | Modificar — preencher tenant_id |
| `src/pages/Projects.tsx` | Modificar — preencher tenant_id |
| `src/components/AppSidebar.tsx` | Modificar — item "Organização" |
| `src/hooks/useTasks.ts` | Modificar — incluir tenant_id nas queries |

## Observações

- Migração retroativa: tarefas/projetos/times existentes ficarão sem `tenant_id` (pessoais). O super_admin poderá associá-los a tenants depois.
- O enum `guest` no `tenant_members.role` permite que convidados externos tenham acesso controlado (view + edit, sem delete).
- Configurações de perfil (`profiles`) permanecem isoladas por usuário, independente do tenant.

