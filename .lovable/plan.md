
# EisenFlow – Sistema de Gestão de Tarefas com Matriz de Eisenhower

## Visão Geral
Plataforma de produtividade inteligente que substitui o Kanban pela Matriz de Eisenhower interativa, com classificação automática por IA, delegação e métricas de produtividade. Interface em PT-BR e EN.

---

## 1. Autenticação & Perfil
- Login/cadastro com email e senha (Supabase Auth)
- Tabela `profiles` com nome, avatar, idioma preferido
- Tabela `user_roles` para permissões futuras (admin, member)

## 2. Estrutura de Dados (Supabase)
- **tasks**: id, title, description, urgency (1-5), importance (1-5), quadrant (1-4), due_date, estimated_time, status, project_id, created_by, assigned_to, tags, impact_score
- **projects**: id, name, owner_id, color
- **delegations**: id, task_id, delegated_by, delegated_to, status, notes
- **productivity_metrics**: id, user_id, date, tasks_completed, tasks_eliminated, tasks_delegated, time_in_important

## 3. Interface Principal – Matriz Interativa
- **Tela principal**: Grid 2x2 com os 4 quadrantes coloridos (🟩 Fazer, 🟧 Agendar, 🟦 Delegar, 🟥 Eliminar)
- **Drag & drop** entre quadrantes para reclassificar tarefas
- Cards de tarefa com título, prazo, tags, score de impacto
- Filtros por projeto, tags, responsável
- Barra de busca global

## 4. Criação & Classificação de Tarefas
- Modal de criação: título, descrição, prazo, projeto, tags, tempo estimado
- **Classificação por IA (Lovable AI)**: ao criar tarefa, edge function envia dados para IA que responde com urgência/importância/quadrante sugerido baseado em prazo, descrição e contexto
- Usuário pode aceitar ou ajustar a sugestão da IA

## 5. Execução Rápida
- Ao clicar na tarefa: painel lateral com detalhes
- Ações rápidas: iniciar, concluir, delegar, reagendar, eliminar
- Timer integrado para tracking de tempo

## 6. Delegação
- Atribuir tarefa a outro membro do projeto
- Notificações via toast/badge
- Status de delegação: pendente, aceita, concluída

## 7. Dashboard de Métricas
- Gráficos (Recharts): tarefas por quadrante, concluídas vs criadas, tempo em tarefas importantes
- Score de produtividade semanal
- Tendências ao longo do tempo

## 8. Internacionalização (i18n)
- Sistema de tradução PT-BR / EN com context provider
- Seletor de idioma no header
- Todas as strings da interface traduzidas

## 9. Layout & Navegação
- Sidebar com: Matriz, Projetos, Métricas, Configurações
- Header com busca, notificações, seletor de idioma, avatar/perfil
- Design limpo e moderno com as cores dos quadrantes como identidade visual
- Responsivo para desktop e mobile

## 10. Edge Functions (Lovable Cloud)
- `classify-task`: recebe dados da tarefa, usa Lovable AI para sugerir quadrante
- `ai-suggestions`: analisa carga de trabalho e sugere reorganização

## Paleta de Cores
- Fazer (Q1): Verde (#9ACD32)
- Agendar (Q2): Laranja (#FF8C00)
- Delegar (Q3): Azul claro (#ADD8E6)
- Eliminar (Q4): Vermelho (#DC143C)
- Background: escuro/claro com dark mode
