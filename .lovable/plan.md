

# Compartilhamento Inteligente da Matriz de Eisenhower

## Análise: O que compartilhar?

Na Matriz de Eisenhower, cada quadrante tem uma natureza diferente para compartilhamento:

| Quadrante | Compartilhável? | Justificativa |
|-----------|-----------------|---------------|
| **Fazer (Do)** | Parcial | Tarefas pessoais urgentes/importantes - compartilhar apenas progresso |
| **Agendar (Schedule)** | Parcial | Planejamento pessoal - compartilhar apenas prazos/calendário |
| **Delegar (Delegate)** | **Sim - Principal** | Naturalmente feito para ser atribuído a outros |
| **Eliminar (Eliminate)** | Não | Tarefas descartáveis, sem valor para outros |

O quadrante **Delegar** é o candidato natural e principal para compartilhamento.

## Proposta: Sistema de Compartilhamento Granular

### 1. Compartilhamento por Projeto (já parcialmente existe)
O sistema já tem times e projetos vinculados a times. Tarefas dentro de projetos de time são visíveis para membros. Podemos melhorar isso.

### 2. Novo: Compartilhamento Individual de Tarefas
Permitir compartilhar tarefas específicas com pessoas específicas, sem expor toda a matriz.

### 3. Novo: "Vista de Delegação" para convidados
Uma view limitada onde a pessoa só vê tarefas delegadas a ela, sem acesso ao resto.

## Dados exigidos para acesso

Para manter simplicidade e segurança:
- **E-mail** (obrigatório) - para autenticação
- **Senha** (obrigatório) - para login
- **Nome de exibição** (opcional) - para identificação no time

Já existe no sistema atual via Auth. Não precisamos de mais dados.

## Implementação Técnica

### Banco de Dados
- Criar tabela `task_shares` para compartilhamento individual de tarefas
- Campos: `task_id`, `shared_by`, `shared_with` (user_id ou email), `permission` (view/edit), `created_at`
- RLS: usuários só veem compartilhamentos onde são `shared_by` ou `shared_with`

### Frontend
- Botão "Compartilhar" no `TaskDetailSheet` para tarefas do quadrante Delegate
- Modal com campo de e-mail + nível de permissão (ver/editar)
- Nova aba "Compartilhadas comigo" no dashboard mostrando apenas tarefas delegadas/compartilhadas
- Filtro na matriz para mostrar/ocultar tarefas compartilhadas

### Segurança
- Tarefas compartilhadas aparecem apenas na vista dedicada, nunca na matriz completa do outro usuário
- Permissões granulares: somente visualizar ou visualizar+editar status
- O proprietário pode revogar acesso a qualquer momento

### Arquivos a criar/modificar
1. **Migração SQL** - tabela `task_shares` com RLS
2. **`src/hooks/useTaskShares.ts`** - hook para CRUD de compartilhamentos
3. **`src/components/ShareTaskDialog.tsx`** - modal de compartilhamento
4. **`src/components/SharedTasksView.tsx`** - vista "Compartilhadas comigo"
5. **`src/components/TaskDetailSheet.tsx`** - adicionar botão compartilhar
6. **`src/pages/Index.tsx`** - adicionar aba/seção de tarefas compartilhadas

