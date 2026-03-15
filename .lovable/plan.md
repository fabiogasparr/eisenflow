

# Excluir, editar e arquivar projetos

## Alterações necessárias

### 1. Banco de dados — adicionar coluna `archived`
- Migração: `ALTER TABLE projects ADD COLUMN archived boolean NOT NULL DEFAULT false;`
- Sem mudança em RLS (políticas existentes já cobrem update/delete para o owner)

### 2. `src/pages/ProjectDetail.tsx` — ações no header
- Adicionar menu dropdown (DropdownMenu) no header com 3 opções:
  - **Editar** — abre dialog para renomear, trocar cor e time
  - **Arquivar/Desarquivar** — toggle do campo `archived`
  - **Excluir** — abre AlertDialog de confirmação, deleta o projeto e redireciona para `/projects`
- Mutations: `updateProject` (name, color, team_id, archived) e `deleteProject`

### 3. `src/pages/Projects.tsx` — filtrar arquivados
- Filtrar `archived = false` na query por padrão
- Adicionar toggle/botão para mostrar projetos arquivados (com visual diferenciado — opacidade reduzida)

### 4. Componentes utilizados
- `DropdownMenu` (já existe em ui/)
- `AlertDialog` (já existe em ui/)
- `Dialog` para edição (reutilizar estrutura do dialog de criação)

Nenhuma mudança em RLS — o owner já pode fazer UPDATE e DELETE.

