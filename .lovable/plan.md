

# Chat de IA para Criação Inteligente de Tarefas

## Visão Geral

Uma nova página "/chat" com interface de chat onde o usuário descreve o que precisa fazer em linguagem natural. A IA analisa o texto, cria tarefas automaticamente (classificando quadrante, urgência, importância), e para tarefas complexas, quebra em subtarefas que podem ser atribuídas a membros de times.

## Arquitetura

```text
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Chat UI    │────▶│  Edge Function   │────▶│  Lovable AI     │
│  /chat page │     │  ai-task-chat    │     │  Gateway        │
└─────────────┘     └──────────────────┘     └─────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  Supabase DB │
                    │  (tasks)     │
                    └──────────────┘
```

## Componentes

### 1. Edge Function `ai-task-chat`
- Recebe mensagem do usuário + contexto (times, membros)
- Usa Lovable AI (google/gemini-3-flash-preview) com tool calling
- Duas tools:
  - `create_tasks`: retorna array de tarefas com título, descrição, quadrante, urgência, importância, assigned_to opcional
  - `chat_response`: resposta conversacional quando não é uma criação de tarefa
- Streaming SSE para resposta fluida

### 2. Página `/chat` (AIChatPage)
- Interface de chat com histórico de mensagens
- Mensagens do usuário e da IA renderizadas com markdown
- Quando a IA cria tarefas, mostra cards de preview antes de confirmar
- Seletor de time/projeto no topo para contexto
- Botão de confirmar criação das tarefas sugeridas

### 3. Componente `TaskPreviewCard`
- Card mostrando tarefa sugerida pela IA (título, quadrante, membro atribuído)
- Toggle para incluir/excluir da criação
- Editável inline antes de confirmar

### 4. Integração
- Nova rota `/chat` no App.tsx
- Novo item "AI Chat" no sidebar com ícone MessageSquare
- Usa `useTasks.createTask` para persistir tarefas confirmadas
- Usa `useTeams` para listar times/membros disponíveis

## Mudanças Necessárias

| Arquivo | Ação |
|---------|------|
| `supabase/functions/ai-task-chat/index.ts` | Criar — edge function com tool calling |
| `supabase/config.toml` | Editar — adicionar função |
| `src/pages/AIChatPage.tsx` | Criar — página do chat |
| `src/components/TaskPreviewCard.tsx` | Criar — card de preview de tarefa |
| `src/App.tsx` | Editar — adicionar rota |
| `src/components/AppSidebar.tsx` | Editar — adicionar item no menu |
| `src/i18n/translations.ts` | Editar — adicionar strings |

## Fluxo do Usuário

1. Abre "/chat" no sidebar
2. Digita: "Preciso preparar a apresentação do Q2 para sexta-feira"
3. IA responde com sugestão de tarefas:
   - "Coletar dados de vendas Q2" (Do, urgência 4, importância 5)
   - "Criar slides da apresentação" (Schedule, urgência 3, importância 4)
   - "Revisar com o gerente" (Delegate, urgência 2, importância 3)
4. Usuário revisa, ajusta se quiser, e confirma
5. Tarefas são criadas na Matriz de Eisenhower

## Detalhes Técnicos

- Edge function usa tool calling com duas funções: `create_tasks` (array de tarefas estruturadas) e `chat_response` (texto livre)
- Prompt inclui contexto dos times/membros para atribuição inteligente
- Streaming para UX responsiva
- Mensagens não são persistidas no banco (stateless por sessão), mantendo simplicidade

