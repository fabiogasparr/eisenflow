# Edge Functions (Deno) — EisenFlow no Supabase self-hosted

Backend do EisenFlow depois da reversão do Appwrite (05/09/2026). As melhorias
feitas no porte Appwrite (`functions/*`, node) foram absorvidas aqui; o
diretório `functions/` pode ser descartado.

No self-hosted **não existe `supabase functions deploy`**: copie este diretório
para o volume `volumes/functions` do container `edge-runtime` e reinicie o
container. As variáveis abaixo viram env desse container.

## Módulos compartilhados (`_shared/`)

| Arquivo | Papel |
|---|---|
| `supabase.ts` | client service-role, `requireUser` (JWT), `isInternalCall` (segredo/service role), papéis de tenant |
| `http.ts` | CORS, `json()`, `HttpError`, leitura tolerante de corpo/query |
| `evolution.ts` | camada **Evolution GO** (token por instância no header `apikey`, webhook declarado no `connect`, `parseWebhook`, `webhookUrl`, `webhookAutorizado`) |
| `ai.ts` | IA pelo **OmniRoute** (protocolo OpenAI): `chat()` com tools, `imagePart()`, `transcrever()`; modelos por finalidade (`MODELOS`) |
| `cripto.ts` | AES-256-GCM (tokens do Google) e HMAC do `state` do OAuth — WebCrypto |
| `google.ts` | conexão (user_id, tenant_id), refresh automático, `invalid_grant` → `is_revoked`, auditoria |
| `relatorios.ts` | relatório diário/semanal de WhatsApp (cron e comando `/relatorio`) |
| `bytes.ts` | base64/base64url/hex sem `Buffer` |

## Functions

**Autenticação:** todas validam a identidade *dentro* da function. O
`verify_jwt` do `config.toml` é defesa em profundidade no gateway — se o
container rodar com `VERIFY_JWT=false` global, nada fica aberto.

| Function | Como é chamada | Auth | Entrada → Saída |
|---|---|---|---|
| `whatsapp-connect` | front `invoke` | JWT | `{timezone?}` → `{status, qr_code, instance_name, webhook_registered}` |
| `whatsapp-status` | front (polling 4s) | JWT | — → `{status, connected, logged_in, phone_number, qr_code, webhook_reregistered?}` |
| `whatsapp-disconnect` | front | JWT | `{keep_instance?}` → `{status:'disconnected', instance_deleted, logged_out}` |
| `whatsapp-send` | interno (`x-internal-secret`) ou usuário pela própria conexão | segredo/service role ou JWT | `{instance_token\|instance_name, phone_number, message}` → `{success, data}` |
| `whatsapp-webhook` | Evolution GO (`?secret=`) | segredo na query + `instanceToken` | envelope Evolution GO → `{ok, ...}` |
| `whatsapp-deadline-reminders` | pg_cron `*/15 * * * *` | interno | — → `{ok, sent}` |
| `whatsapp-report` | pg_cron `0 * * * *` | interno | `{type?}` → `{ok, daily, weekly}` |
| `tenant-whatsapp-connect` | front | JWT + owner/admin | `{tenant_id}` → `{ok, instance_name, qr_code, status}` |
| `tenant-whatsapp-verify-phone` | front | JWT + **membro do tenant** | `{action:'send'\|'verify', tenant_id, phone_number?, code?}` → `{ok}` / `{ok, verified}` |
| `ai-task-chat` | front | JWT | `{messages, context?, images?}` → `{type:'tasks', tasks, summary}` \| `{type:'chat', message}` |
| `analyze-task-image` | front | JWT + acesso à tarefa | `{attachment_id}` → `{ocr_text, description, suggested_subtasks}` |
| `classify-task` | front | JWT | `{title, description?}` → `{quadrant, urgency, importance}` |
| `reevaluate-deadlines` | pg_cron `0 6 * * *` **e** front | interno (todos) ou JWT (só o usuário) | `{user_id?, limit?, dry_run?}` → `{processed, urgencyApplied, suggestionsCreated, errors, truncated}` |
| `google-calendar-auth` | front (POST) + redirect do Google (GET) | JWT nas actions; `state` HMAC no callback | `{action:'authorize'\|'status'\|'list-calendars'\|'update-settings'\|'disconnect', tenant_id?}`; `authorize` → `{url}` |
| `google-calendar-sync` | front | JWT + membro do tenant | `{action, tenant_id?, ...}` (list-calendars, list-events, create/update/delete-event, import-events, sync-tasks) |
| `dispatch-reminders` | pg_cron `*/5 * * * *` | interno | `{limite?}` → `{ok, processed, sent, failed, skipped, cancelled, restantes}` |
| `process-recurring-schedules` | pg_cron `*/5 * * * *` | interno | — → `{ok, enqueued}` |
| `generate-recurring-tasks` | pg_cron `0 4 * * *` | interno | — → `{ok, created, skipped, examined}` |
| `cleanup-reminders` | pg_cron `0 3 * * *` | interno | `{days?}` → `{ok, deleted}` |
| `hermes-mcp` | cliente MCP externo | `x-api-key` do tenant + whitelist de IP + rate limit | `POST /mcp/tools/list`, `POST /mcp/tools/call`, `GET /mcp/health` |

`tenant_id` opcional: quando o front não manda (hooks antigos), a function usa o
tenant mais antigo do usuário (o pessoal, criado pelo trigger
`handle_new_user_tenant`).

### Fluxo do Google Calendar (mudou)

1. Front: `invoke('google-calendar-auth', { body: { action: 'authorize', tenant_id } })` → `{ url }`.
2. Front abre `url` num popup. O `state` é `{user_id, tenant_id, nonce, exp}` assinado (HMAC).
3. Google redireciona para `${PUBLIC_FUNCTIONS_URL}/google-calendar-auth?action=callback` — **cadastre essa URL exata no Google Cloud Console**.
4. A página de retorno faz `postMessage({type:'google-calendar-connected'})` e fecha.

### Como o pg_cron chama uma function

A migration `20260905000600_cron-edge-functions.sql` cria
`public.invoke_edge_function(name)` (pg_net, header `x-internal-secret`) e os
`cron.schedule` de todos os crons acima. Ela lê `app.settings.functions_url` e
`app.settings.internal_secret` — este último tem de ser **o mesmo valor** de
`INTERNAL_FUNCTION_SECRET` no env da edge-runtime. `Authorization: Bearer
<SUPABASE_SERVICE_ROLE_KEY>` também é aceito pelas functions no lugar do
segredo.

## Variáveis de ambiente do container `edge-runtime`

| Variável | Obrigatória | Usada por | Descrição |
|---|---|---|---|
| `SUPABASE_URL` | sim | todas | URL interna/pública da API (Kong) |
| `SUPABASE_ANON_KEY` | sim | todas com JWT | valida o JWT do usuário |
| `SUPABASE_SERVICE_ROLE_KEY` | sim | todas | escrita ignorando RLS; também autentica crons |
| `INTERNAL_FUNCTION_SECRET` | sim | crons, `whatsapp-send` | segredo das chamadas servidor-a-servidor (`x-internal-secret`); deve ser igual a `app.settings.internal_secret` no Postgres. `INTERNAL_SECRET` é aceito como sinônimo |
| `PUBLIC_FUNCTIONS_URL` | sim | whatsapp-*, google-calendar-* | base pública das functions, ex. `https://supabase-eisenflow.kz3solucoes.cloud/functions/v1` |
| `EVOLUTION_API_URL` | sim | whatsapp-* | ex. `https://evo-eisenflow.kz3solucoes.cloud` |
| `EVOLUTION_API_KEY` | sim | connect/status/disconnect | `GLOBAL_API_KEY` do Evolution GO (só cria/lista/deleta instância) |
| `EVOLUTION_WEBHOOK_SECRET` | sim | connect, webhook | segredo que viaja em `?secret=` na URL do webhook |
| `EVOLUTION_WEBHOOK_URL` | não | connect | URL exata do `whatsapp-webhook` (vence `PUBLIC_FUNCTIONS_URL`) |
| `AI_API_KEY` | sim | ai-task-chat, analyze-task-image, classify-task, reevaluate-deadlines, whatsapp-webhook | chave do OmniRoute |
| `AI_BASE_URL` | não | idem | default `https://omniroute.kz3solucoes.cloud/v1` |
| `AI_PROVIDER` | não | idem | `omniroute` (padrão) \| `openai` \| `anthropic` \| `google` \| `openai-compat` |
| `AI_MODEL_CLASSIFICAR` | não | classify-task | default `auto/fast` |
| `AI_MODEL_CONVERSAR` | não | ai-task-chat, whatsapp-webhook | default `auto/best-chat` |
| `AI_MODEL_VISAO` | não | analyze-task-image, chat/webhook com imagem | default `auto/best-vision` |
| `AI_MODEL_JULGAR` | não | reevaluate-deadlines | default `auto/reasoning` |
| `AI_MODEL_TRANSCREVER` | não | whatsapp-webhook (áudio) | default `huggingface/openai/whisper-large-v3-turbo` |
| `GOOGLE_CLIENT_ID` | sim* | google-calendar-* | OAuth client do EisenFlow |
| `GOOGLE_CLIENT_SECRET` | sim* | google-calendar-* | idem |
| `GOOGLE_TOKENS_ENCRYPTION_KEY` | sim* | google-calendar-* | chave (texto livre) da cifra AES-256-GCM dos tokens |
| `GOOGLE_STATE_SECRET` | não | google-calendar-auth | HMAC do `state`; cai para `GOOGLE_TOKENS_ENCRYPTION_KEY` se ausente |
| `REEVAL_MAX_TAREFAS` | não | reevaluate-deadlines | default 150 |
| `REEVAL_ORCAMENTO_MS` | não | reevaluate-deadlines | default 100000 |

\* obrigatória só se o Google Calendar for usado.

`LOVABLE_API_KEY` não existe mais.
