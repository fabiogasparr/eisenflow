## Escopo

Cada **tenant** (workspace) decide se quer habilitar o MCP. Quando habilitado, o owner/admin do tenant gera **API keys do tenant** e usa essas chaves para conectar aplicações externas (Hermes, n8n, scripts próprios, etc.) ao EisenFlow.

A chave é do tenant, não do usuário. Toda chamada vinda da chave opera no contexto daquele tenant e respeita os papéis (owner/admin/member/guest).

## Contrato HTTP (compatível com o que o Hermes já espera)

Edge Function `hermes-mcp` em `supabase/functions/hermes-mcp/index.ts`:

- Auth header: `x-api-key: <token>` (formato `efk_<tenant_prefix>_<random>`).
- `GET  /mcp/health` — sem auth.
- `POST /mcp/tools/list` — body opcional `{ tools: ["nome", ...] }`. Resposta `{ tools: [{ name, description, inputSchema }] }`.
- `POST /mcp/tools/call` — body `{ name, arguments }`. Resposta `{ ok:true, name, result }` ou `{ ok:false, error, ... }`.
- Erros: 401 `unauthorized`, 403 `forbidden_scope`, 400 `missing_tool_name`, 404 `tool_not_found`, 422 `invalid_input` (com `path`), 429 `rate_limited`, 500 com `error`.

CORS aberto, `verify_jwt = false` (auth é pela API key do tenant).

## Modelo de dados (por tenant)

Tabela `tenant_mcp_settings` (1:1 com tenant):
- `tenant_id` (PK, FK), `enabled boolean`, `created_at`, `updated_at`, `updated_by`.

Tabela `tenant_api_keys`:
- `id`, `tenant_id`, `name`, `key_prefix` (8 chars visíveis para identificar), `key_hash` (sha256), `scopes text[]`, `created_by`, `last_used_at`, `last_used_ip`, `expires_at`, `revoked_at`, `created_at`.
- Índice único em `key_hash`; índice em `(tenant_id)`.

Tabela `tenant_api_audit_log`:
- `id`, `tenant_id`, `api_key_id`, `tool`, `status` (`ok`/`error`/`unauthorized`/`rate_limited`), `error`, `input_preview jsonb` (truncado, sem dados sensíveis), `created_at`.

RLS:
- `tenant_mcp_settings`: SELECT/UPDATE por membros do tenant; só **owner/admin** podem mudar `enabled`. `service_role` total.
- `tenant_api_keys`: SELECT/INSERT/UPDATE/DELETE somente para owner/admin do tenant. A UI nunca lê `key_hash` (omitir no select). `service_role` total.
- `tenant_api_audit_log`: SELECT só para owner/admin do tenant.

GRANTs corretos (`authenticated` + `service_role`) em todas, conforme regra do projeto.

## Escopos

`tasks:read`, `tasks:write`, `reminders:write`, `prioritize`, `projects:read`, `members:read`.

Owner/admin escolhe os escopos ao gerar a chave. Sem o escopo → 403 `forbidden_scope`.

## Fluxo de autenticação na função

1. Lê `x-api-key`.
2. `sha256(token)` → busca em `tenant_api_keys` ativo (`revoked_at IS NULL`, `expires_at` ok).
3. Carrega `tenant_id` e `scopes`; verifica `tenant_mcp_settings.enabled = true` (senão 401 `mcp_disabled`).
4. Atualiza `last_used_at` e `last_used_ip` (best-effort, sem bloquear).
5. Injeta nos handlers: `{ tenantId, scopes, apiKeyId }`.

Rate limit por `api_key_id` (ex.: 120 req/min) usando contador em tabela ou advisory lock; excesso → 429.

Auditoria: cada chamada (ok ou erro) grava em `tenant_api_audit_log`.

## Resolução de "qual usuário" para gravar

Como a chave é do tenant, ações precisam de um `created_by`. Estratégia:

- `create_task` / `update_task` / `add_task_reminder`: usar `created_by = api_key.created_by` por padrão. Permitir override via `arguments.assigned_to_user_id` apenas se esse usuário for membro do tenant.
- Listagens são escopadas por `tenant_id`, não por usuário (o Hermes vê o board do tenant — coerente com "conectar aplicação externa ao workspace").
- Tarefas pessoais (sem tenant) ficam fora do alcance da chave.

## Tools expostas (V1)

Tarefas
- `list_tasks` (filtros: quadrant, status, project_id, due_before/after, assigned_to, search, limit ≤ 100).
- `get_task`, `create_task`, `update_task`, `complete_task`, `start_task`, `delete_task`, `move_to_quadrant`.

Priorização
- `suggest_prioritization` (heurística: prazo + urgência + importância + esforço; sem grava­r).
- `apply_prioritization` (requer `tasks:write`).
- `reclassify_task`.

Projetos / membros
- `list_projects`, `list_team_members`.

Lembretes
- `add_task_reminder`, `list_task_reminders`, `remove_task_reminder` (usam as funções já corrigidas).

Cada tool com `inputSchema` JSON-Schema enxuto (campos suportados pelo validador do Hermes: `type`, `enum`, `minLength`, `maxLength`, `required`).

## UI (Settings → Integrações → MCP)

Acesso restrito a **owner/admin** do tenant ativo.

Página `IntegrationsMcpPage.tsx`:
- Toggle "Habilitar MCP para este workspace" (grava `tenant_mcp_settings.enabled`).
- Quando habilitado, mostra:
  - Bloco de instruções: URL base, header `x-api-key`, exemplo `curl` para `/mcp/tools/list` e `/mcp/tools/call`.
  - Lista de API keys: nome, prefixo (`efk_xxxx…`), escopos, criada por, last_used_at, expiração, ações (revogar).
  - Botão "Gerar nova chave" → modal (nome, escopos, expiração opcional). Após criar, mostra a chave UMA vez em destaque com botão copiar e aviso "não será exibida novamente".
- Aba "Atividade" com últimos N registros de `tenant_api_audit_log` (tool, status, quando).

Hooks: `useTenantMcpSettings`, `useTenantApiKeys`, `useTenantApiAudit`.

Entrada no `AppSidebar`/`SettingsPage` visível só para owner/admin.

## Migrations

`supabase/migrations/<ts>_tenant_mcp.sql` com:
- `CREATE TABLE` das três tabelas + GRANT (authenticated + service_role) + ENABLE RLS + POLICIES.
- Trigger `updated_at` em `tenant_mcp_settings`.
- Função `public.is_tenant_admin(_user_id, _tenant_id)` (security definer) reutilizando `get_tenant_role` para policies.

## Edge Function

`supabase/functions/hermes-mcp/index.ts`:
- Hono + roteador `/mcp/*`.
- `auth.ts` (hash + lookup + atualização de last_used).
- `tools/*.ts` (um arquivo por grupo).
- `validate.ts` reproduzindo o `invalidInput` do Hermes (mesmas regras e formato de erro 422).
- `audit.ts` para gravar `tenant_api_audit_log`.

Nenhuma alteração em `supabase/config.toml` além de registrar a função se necessário.

## Validação

- `curl` reproduzindo os comandos do Hermes (`/mcp/tools/list`, `/mcp/tools/call criar tarefa`).
- Testes manuais por tenant:
  - Owner habilita MCP, gera chave com escopo `tasks:read+write`.
  - Externo lista e cria tarefas; aparecem em tempo real no board (realtime já existe).
  - Chave de outro tenant nunca enxerga tarefas do primeiro.
  - Revogar chave → 401 imediato.
  - Tool fora do escopo → 403.
- `supabase--linter` após a migration; corrigir warnings dela.

## Perguntas antes de implementar

1. Permissão para gerar/revogar chaves: só **owner**, ou **owner + admin**?
2. Quer rate limit já na V1 (120 req/min por chave) ou só auditoria, deixando limite para depois?
3. Priorização `suggest_prioritization`: heurística pura agora, e IA (Lovable AI) numa V1.1, tudo bem?
