# Reavaliação automática por proximidade de prazo

## Objetivo
Tarefas com `due_date` próximo são reavaliadas 1x/dia (e sob demanda). A **urgência** sobe automaticamente por regra de tempo; a **importância** e o **quadrante sugerido** são julgados pela IA com base em múltiplos sinais. O usuário aprova/rejeita as mudanças de importância na UI.

## Modelo de classificação

### Parte 1 — Urgência (determinística, automática)
Calculada a partir de `due_date - now()`:

```text
≤ 24h → urgency = 5  (crítica)
≤ 72h → urgency = 4  (alta)
≤ 7d  → urgency = 3  (média)
> 7d  → mantém valor atual
vencida → urgency = 5 + flag "overdue"
```

Sem IA: regra pura, barata, previsível. Aplicada direto no banco.

### Parte 2 — Importância (sugerida pela IA)
A IA recebe um **dossiê** da tarefa e devolve `importance (1-5)` + justificativa curta.

Sinais enviados ao modelo:
- **Conteúdo**: título, descrição, tags
- **Contexto organizacional**: nome do projeto, se faz parte de equipe/tenant compartilhado
- **Estrutura**: nº de subtarefas, nº de anexos, presença de OCR/descrição visual
- **Histórico do usuário (agregado, anonimizado)**:
  - Taxa de conclusão por tag/projeto (tags que o usuário tipicamente conclui = mais importantes)
  - Taxa de eliminação por tag (tags que ele costuma eliminar = menos importantes)
  - Importância média histórica das tarefas do mesmo projeto
- **Sinais derivados**: tarefa delegada para outros, tarefa recorrente, tarefa com Google Calendar event

### Parte 3 — Quadrante final
Recalculado pela mesma regra já existente no app (urgência≥3 + importância≥3):

```text
urgency ≥3 AND importance ≥3 → do
urgency <3 AND importance ≥3 → schedule
urgency ≥3 AND importance <3 → delegate
urgency <3 AND importance <3 → eliminate
```

## Fluxo de aplicação

```text
cron diário (08:00 user TZ)
        │
        ▼
1. Buscar tasks com due_date em ≤7d, status pending/in_progress
2. Para cada uma:
   ├─ aplicar nova urgency por regra (UPDATE direto)
   ├─ se quadrante mudou só por urgência → aplicar e notificar
   └─ chamar IA para reavaliar importância
        │
        ▼
3. Se IA sugerir importance diferente (Δ ≥1):
   └─ criar registro em task_reclassification_suggestions (pendente)
        │
        ▼
4. Notificação no app: "N tarefas têm sugestões de reclassificação"
        │
        ▼
5. UI: usuário vê card com diff (antes → depois + motivo) e aprova/rejeita em lote
```

Botão **"Reavaliar agora"** na Matriz dispara o mesmo fluxo manualmente para o usuário corrente.

## Mudanças técnicas

### Banco
- Nova tabela `task_reclassification_suggestions`:
  - `task_id`, `user_id`, `current_quadrant`, `suggested_quadrant`
  - `current_importance`, `suggested_importance`
  - `current_urgency`, `applied_urgency` (urgência já aplicada por regra)
  - `reason` (texto curto da IA), `signals` (jsonb)
  - `status` ('pending' | 'accepted' | 'rejected' | 'expired')
  - `created_at`, `resolved_at`
- RLS: usuário só vê/edita as próprias sugestões.
- Índice em `(user_id, status)`.

### Edge functions
- **`reevaluate-deadlines`** (nova):
  - Roda a regra de urgência em SQL bulk.
  - Para cada task elegível, monta dossiê (faz queries agregadas de histórico) e chama Lovable AI (`google/gemini-3-flash-preview`) com tool calling para retornar `{ importance, reason }`.
  - Cria sugestões pendentes; aplica direto só as mudanças puramente de urgência.
  - Aceita parâmetro `user_id` opcional para o modo manual.
- **Cron pg_cron**: dispara `reevaluate-deadlines` 1x/dia para todos usuários ativos.

### Frontend
- Botão **"Reavaliar agora"** no header da Matriz (dispara função p/ user atual).
- Banner/sheet **"Sugestões da IA"** listando cada sugestão com: tarefa, badge antigo→novo quadrante, motivo, botões Aceitar/Rejeitar/Aceitar todas.
- Notificação in-app quando há sugestões novas.
- i18n PT-BR/EN para todas as strings.

## Por que esse design
- **Custo controlado**: IA só roda 1x/dia em tarefas a ≤7d do prazo (não toda a base).
- **Sem surpresa**: usuário aprova mudanças de importância; só urgência muda automaticamente (que é objetiva).
- **Aprende com o usuário** sem ML pesado: histórico agregado vai como contexto no prompt.
- **Reaproveita** a função `classify-task` existente (estendendo o prompt com os sinais novos).
