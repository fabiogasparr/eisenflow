

# Dashboard de Produtividade do Time

## Visão Geral

Adicionar um componente `TeamDashboard` dentro do `TeamDetailSheet` que mostra métricas agregadas de produtividade por membro do time. Os dados vêm das tabelas `tasks` e `productivity_metrics` existentes.

## Componentes

### 1. `src/components/TeamDashboard.tsx` (Novo)

Dashboard com:
- **Resumo geral do time**: total de tarefas, concluídas, pendentes, taxa de conclusão
- **Tabela por membro**: nome, tarefas concluídas, pendentes, em progresso, taxa de conclusão, barra de progresso
- **Distribuição por quadrante**: quantas tarefas do time em cada quadrante (Do/Schedule/Delegate/Eliminate)

Busca tarefas do time via projetos vinculados ao `team_id`, usando a query:
```sql
SELECT t.* FROM tasks t
JOIN projects p ON t.project_id = p.id
WHERE p.team_id = :teamId
```

### 2. `src/pages/TeamsPage.tsx` (Editar)

Adicionar aba/seção "Dashboard" no `TeamDetailSheet`, usando `Tabs` para alternar entre "Membros", "Convites" e "Dashboard".

### 3. `src/i18n/translations.ts` (Editar)

Adicionar strings: `teamDashboard`, `completionRate`, `tasksCompleted`, `tasksPending`, `inProgress`, `teamOverview`, `memberPerformance`, `quadrantDistribution`.

## Dados

Não requer mudanças no banco. Usa tabelas existentes (`tasks`, `projects`, `team_members`, `profiles`). As RLS policies existentes já permitem que membros do time vejam tarefas de projetos do time.

## Mudanças

| Arquivo | Ação |
|---------|------|
| `src/components/TeamDashboard.tsx` | Criar — dashboard com métricas por membro |
| `src/pages/TeamsPage.tsx` | Editar — adicionar tab Dashboard no sheet |
| `src/i18n/translations.ts` | Editar — strings do dashboard |

