

# Adicionar seletor de time ao criar projeto

## Alterações

### 1. `src/pages/Projects.tsx`
- Importar `useTeams` de `@/hooks/useTeams`
- Importar componentes `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`
- Adicionar estado `teamId` (string | null, default null)
- No dialog de criação, adicionar um `Select` opcional para escolher o time (com opção "Pessoal / Nenhum")
- Passar `team_id: teamId || null` no insert
- Resetar `teamId` ao fechar o dialog
- No card do projeto, mostrar o nome do time associado (se houver) — buscar via join ou exibir badge

### 2. Exibição nos cards
- Alterar a query para incluir dados do time: `select('*, teams(name)')` ou fazer lookup local com os times já carregados via `useTeams`
- Mostrar badge com nome do time no card quando `team_id` não for null

Nenhuma alteração no banco — a coluna `team_id` já existe na tabela `projects` e aceita null.

