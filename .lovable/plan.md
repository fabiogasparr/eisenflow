

# Atribuir times a projetos — visão pelo lado do Time

A funcionalidade de vincular um time a um projeto já existe nos formulários de criação e edição de projetos. O que falta é a **visão pelo lado do time**: ao abrir um time, ver seus projetos e poder vincular projetos existentes.

## Alterações

### 1. `src/pages/TeamsPage.tsx` — nova aba "Projetos" no TeamDetailSheet
- Adicionar uma terceira aba `projects` no `Tabs` (ao lado de "Membros" e "Dashboard")
- Buscar projetos onde `team_id = team.id` usando query existente
- Listar os projetos do time com cards clicáveis (navegam para `/projects/:id`)
- Botão "Vincular projeto" que abre um dialog com select dos projetos pessoais do usuário (sem time) para associar ao time atual (`UPDATE projects SET team_id = ?`)
- Botão "Desvincular" em cada projeto (seta `team_id = null`)

### 2. Nenhuma alteração no banco
- A coluna `team_id` já existe na tabela `projects`
- RLS já permite o owner fazer UPDATE nos seus projetos

### Fluxo do usuário
1. Abre um time → aba "Projetos"
2. Vê todos os projetos vinculados ao time
3. Clica "Vincular projeto" → seleciona um projeto pessoal → projeto passa a ser do time
4. Pode desvincular clicando no botão ao lado do projeto

