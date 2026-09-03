# EisenFlow — migração Supabase → Appwrite self-hosted

Reconstrução completa do backend do EisenFlow no Appwrite self-hospedado
(`appwrite.kz3solucoes.cloud`, versão 1.7.4, rodando no Coolify).

---

## Por que esta migração existe

O projeto Supabase original (`zmquepmvnelffcwvsuqv`) está **pausado e sem acesso** —
o login da conta se perdeu. O banco não pôde ser exportado.

O schema, porém, **não se perdeu**: ele estava inteiro no código do projeto, em
58 migrations SQL e no `src/integrations/supabase/types.ts` gerado. Este pacote
reconstrói esse schema no Appwrite a partir do código, sem depender de acesso ao
Supabase.

**O que se recupera:** 100% da estrutura — tabelas, colunas, tipos, defaults,
enums, índices, constraints, buckets e a intenção de cada política de acesso.
**O que não se recupera:** os dados. O banco novo nasce vazio.

Se um dia o acesso à conta Supabase voltar, a pista mais forte é o workspace
Lovable `fabio.a.gasparr@uel.br` — foi de lá que o projeto Supabase foi
autorizado, então a conta é provavelmente a mesma identidade usada ali.

---

## O que está neste pacote

```
appwrite/
  schema.mjs          Schema declarativo — a fonte da verdade
  migrate.mjs         Cria tudo no Appwrite. Idempotente. Zero dependências.
  verify.mjs          Confere o servidor contra o schema
  gen-types.mjs       Regenera os tipos TypeScript
  gen-functions.mjs   Regenera os esqueletos das functions e o appwrite.json
  README.md           Como rodar

src/integrations/appwrite/
  client.ts           Cliente Appwrite (substitui supabase/client.ts)
  types.ts            41 interfaces + enums — GERADO, não edite
  auth.ts             Login, OAuth, MFA, recuperação, ensureProfile
  database.ts         CRUD tipado, paginação por cursor, substituto de joins
  permissions.ts      Tradução das políticas RLS para permissões de documento
  realtime.ts         Substituto do postgres_changes
  index.ts            Barrel

functions/
  _shared/            appwrite.js, auth.js, evolution.js, ai.js, http.js
  <20 funções>/       src/main.js + package.json

appwrite.json         Config do Appwrite CLI: 20 functions, 7 agendamentos
```

---

## Números da migração

| | Postgres (origem) | Appwrite (destino) |
|---|---|---|
| Tabelas | 47 | **41 collections** (34 core + 7 extras) |
| Colunas | ~380 | 355 atributos |
| Índices | ~50 | 86 |
| Enums | 15 tipos | 15 enums |
| Buckets | 3 | 4 |
| Funções SQL | 16 | portadas para código de aplicação |
| Triggers | 31 | portados para código de aplicação |
| Edge Functions | 20 | 20 Appwrite Functions (3 prontas, 17 esqueletos) |
| Jobs pg_cron | 3 | agendamentos nativos de Function |

---

## Decisões de tradução

### 1. Chaves estrangeiras → referências soltas

O Appwrite não tem foreign keys com integridade referencial. Cada `uuid` que
apontava para outra tabela virou `string(36)` com índice. Existe o tipo
*Relationship* no Appwrite, mas ele impõe carregamento implícito e limites de
profundidade — para 30+ relações, referência solta é mais previsível.

**Consequência:** deletar um documento **não** cascateia. Onde havia
`ON DELETE CASCADE`, a limpeza tem que ser feita em código. Os pontos que
importam: apagar uma tarefa deve apagar `subtasks`, `task_shares`,
`task_attachments`, `task_reminders`, `delegations` e `task_focus_sessions`.

### 2. RLS → permissões de documento + Teams

Esta é a mudança conceitual mais profunda.

No Postgres a regra ficava **no banco** e era avaliada a cada query.
No Appwrite a regra fica **no documento**, gravada no momento da criação.

```
Postgres:  USING (auth.uid() = created_by OR auth.uid() = assigned_to)
Appwrite:  permissions: [read(user:A), update(user:A), read(user:B), update(user:B)]
```

**Consequência que morde:** sempre que a titularidade muda — delegar uma tarefa,
compartilhar, mover de tenant — é preciso **atualizar as permissões do documento**.
No Postgres isso era automático; aqui não é. `src/integrations/appwrite/permissions.ts`
centraliza esse cálculo justamente para o app nunca ter que reinventá-lo.

**Tenants viraram Teams nativos do Appwrite.** É o encaixe mais limpo: um Team
tem papéis (`owner`, `admin`, `member`, `guest` — exatamente o enum `tenant_role`),
convites com e-mail e expiração, e `Role.team(id, 'admin')` funciona direto nas
permissões. A collection `tenants` continua existindo para os metadados (nome,
slug, logo) e guarda o `appwrite_team_id`.

Os "times" internos (`teams`) continuam como collection — são um segundo nível
dentro do tenant, e Teams do Appwrite não aninham.

### 3. Funções e triggers do Postgres → código de aplicação

As 16 funções SQL e 31 triggers não têm equivalente no Appwrite. Onde cada uma foi parar:

| Origem (SQL) | Destino |
|---|---|
| `update_updated_at_column` (12 triggers) | `withStamps()` em `database.ts` — automático em todo create/update |
| `handle_new_user` | `ensureProfile()` em `auth.ts`, chamado após o login |
| `handle_new_team` / `handle_new_tenant` | criação do Team + membership no fluxo do app |
| `handle_new_user_tenant` | criação do tenant pessoal no primeiro login |
| `notify_task_assigned` | ao gravar `assigned_to`, cria a notificação e atualiza permissões |
| `notify_task_status_changed` | idem, na mudança de status |
| `has_role` / `is_super_admin` | labels do Appwrite (`user.labels.includes('admin')`) |
| `is_team_member` / `get_team_role` | consulta a `team_members` |
| `is_tenant_member` / `get_tenant_role` / `is_tenant_admin` | `getTenantRole()` em `functions/_shared/auth.js` |
| `is_task_shared_with` | as permissões do documento já resolvem |
| `award_badge_if_earned` | function server-side (collection `user_badges` é server-only) |
| `compute_reminder_scheduled_at` / `expand_task_reminder` / `sync_task_auto_reminders` | lógica de `dispatch-reminders` e `process-recurring-schedules` |
| `encrypt_token` / `decrypt_token` (pgcrypto) | `node:crypto` dentro de `google-calendar-auth` |
| 3 jobs `pg_cron` | agendamentos nativos das Functions |

### 4. Tipos

| Postgres | Appwrite | Observação |
|---|---|---|
| `uuid` | `string(36)` | |
| `text` | `string(N)` | tamanho dimensionado por campo |
| `timestamptz` | `datetime` | ISO 8601 |
| `date` | `string(10)` | `YYYY-MM-DD` — permite índice único composto com `user_id` |
| `time` | `string(8)` | `HH:MM:SS` |
| `jsonb` | `string(65535)` | JSON serializado; use `parseJson()` / `toJson()` |
| `text[]`, `enum[]` | atributo array | **arrays não aceitam default no Appwrite** |
| `inet` | `string(45)` | |
| `interval` | `integer` (segundos) | |

**A pegadinha dos arrays:** no Postgres, `channels` tinha
`DEFAULT ARRAY['in_app']`. No Appwrite, atributo array não pode ter default nem
ser required. O app precisa aplicar o default ao criar o documento. Campos
afetados: `tasks.tags`, `task_reminders.channels`, `task_reminders.recipients`,
`recurring_schedules.channels`, `user_reminder_preferences.default_channels`,
`user_reminder_preferences.default_recipients`, `tenant_api_keys.scopes`.

### 5. Sem joins

O PostgREST fazia `select('*, projects(name)')` numa query. O Appwrite não faz.
`db.loadRelated()` (nas functions) e `loadRelated()` (no front) resolvem: uma
query para os pais, uma para os filhos, junção em memória. A função
`reevaluate-deadlines` é a que mais depende disso.

### 6. Realtime

`postgres_changes` → canais do Appwrite. A filtragem por permissão é automática:
a sessão só recebe evento de documento que ela pode ler. É mais seguro que o
realtime do Supabase, onde a publicação `supabase_realtime` era global e o filtro
dependia da RLS estar correta.

---

## O que NÃO foi migrado, de propósito

As migrations de 02/09/2026 (2FA, rate limit, rotação de token, validação de IP)
criaram 13 tabelas que **duplicam recursos nativos do Appwrite**. Recriá-las seria
reimplementar em collection o que a plataforma já entrega:

| Tabela | Substituto nativo |
|---|---|
| `user_2fa` | MFA do Appwrite — `account.createMfaAuthenticator('totp')` |
| `admin_2fa_enforcement` | política de MFA do projeto (Auth → Security) |
| `failed_2fa_attempts` | abuse limits nativos |
| `session_tokens` | sessões nativas — `account.listSessions()` |
| `token_rotation_log` | logs de sessão nativos |
| `rate_limit_ips` | rate limit por IP nativo |
| `auth.users.timezone` | `user_preferences.timezone` |

`ip_whitelist`, `ip_access_log`, `suspicious_ips`, `rate_limit_buckets` e
`rate_limit_events` **foram** migradas (grupo `extras`, opcionais) porque são
regra de negócio por tenant, não infraestrutura — a whitelist e o rate limit da
API do `hermes-mcp` continuam fazendo sentido.

### Três defeitos do schema original que ficaram para trás

A leitura das migrations encontrou problemas que valem registro — nenhum deles
foi reproduzido no Appwrite:

1. **`CHECK valid_timezone` corrompido.** A migration de timezone alterava
   `auth.users` (schema gerenciado pelo Supabase) com uma lista de fusos IANA
   contendo dezenas de nomes inventados — `America/Nerja`, `America/Nersbergen`,
   `America/Nerolic`. Fusos reais como `America/Sao_Paulo` teriam sido rejeitados.
2. **Três tabelas de segurança sem RLS.** `suspicious_ips`,
   `admin_2fa_enforcement` e `failed_2fa_attempts` foram criadas sem
   `ENABLE ROW LEVEL SECURITY` e sem nenhuma policy — ficavam legíveis por
   qualquer usuário autenticado. No Appwrite são server-only.
3. **Segredos TOTP em texto plano.** `user_2fa.totp_secret` coexistia com
   `totp_secret_encrypted`, com a chave mestra literal `'REPLACE_WITH_VAULT_KEY'`
   deixada no código. Resolvido por não existir: o MFA agora é do Appwrite.

Somando: essas quatro migrations provavelmente **nunca rodaram** no Supabase — o
`types.ts` gerado não conhece nenhuma das tabelas que elas criam.

### Duas falhas de segurança corrigidas no porte

Estas não são do schema, são das Edge Functions, e valia corrigir em vez de
reproduzir:

- **`whatsapp-send` não tinha autenticação nenhuma.** Qualquer pessoa com a URL
  disparava mensagem por qualquer instância conectada. Agora exige
  `x-internal-secret`.
- **`whatsapp-webhook` não verificava a origem do payload.** Aceitava qualquer
  POST como se fosse da Evolution API. Agora valida `EVOLUTION_WEBHOOK_SECRET`.

---

## As 20 Functions

Três estão **portadas e prontas**: `whatsapp-send`, `classify-task`,
`cleanup-reminders`. As outras 17 são **esqueletos**: trazem o contrato exato
(entrada, saída, secrets, collections tocadas, armadilhas), o scaffold de auth e
os helpers já ligados — mas a lógica de negócio continua no `.ts` Deno original e
precisa ser transposta. Cada arquivo marca o ponto com um bloco `PORTAR:` e a
tabela de equivalências.

Isto é deliberado: portar as 17 restantes às cegas, sem rodar contra o servidor,
produziria código que compila e não funciona.

### Agendamentos

| Function | Cron |
|---|---|
| `dispatch-reminders` | a cada 5 min |
| `process-recurring-schedules` | a cada 5 min |
| `whatsapp-deadline-reminders` | a cada 15 min |
| `whatsapp-report` | de hora em hora |
| `cleanup-reminders` | 03:00 |
| `generate-recurring-tasks` | 04:00 |
| `reevaluate-deadlines` | 06:00 |

### O Lovable AI Gateway não sobrevive ao self-host

Cinco funções (`ai-task-chat`, `analyze-task-image`, `classify-task`,
`reevaluate-deadlines`, `whatsapp-webhook`) chamavam o gateway de IA da Lovable
com `LOVABLE_API_KEY`. Esse gateway é proprietário e só funciona dentro da
plataforma.

`functions/_shared/ai.js` substitui o gateway mantendo o mesmo contrato
(mensagens estilo OpenAI + function calling) e aponta, por padrão, para o
**OmniRoute self-hospedado** — `https://omniroute.kz3solucoes.cloud/v1`.

Isso mantém a IA na mesma infraestrutura do resto: o Appwrite e o OmniRoute
vivem no mesmo servidor, e trocar de modelo passa a ser mudar `AI_MODEL`,
sem tocar em nenhuma das cinco funções. Como o OmniRoute fala o protocolo
OpenAI, o módulo aceita como alternativa direta OpenAI, Anthropic, Google ou
qualquer endpoint compatível, via `AI_PROVIDER`.

---

## Dados reais do servidor

Confirmados rodando contra o servidor, não copiados da URL:

| | |
|---|---|
| Endpoint | `https://appwrite.kz3solucoes.cloud/v1` |
| Versão | 1.7.4 |
| **Project ID** | `6a987e930039a4a13bea` |
| **Database ID** | `6a9887fe000ab0ab3b2e` (nome: `eisenflow`) |

**Cuidado com o ID do projeto.** Na URL do console aparece
`/console/project-default-6a987e930039a4a13bea`. O `default` ali é a **região**,
não faz parte do ID. Usar `default-6a987e930039a4a13bea` devolve
*"Project with the requested ID could not be found"*.

**O database já existia**, vazio, criado pelo console — por isso o ID é gerado e
não o literal `eisenflow`. A migração reaproveitou esse database em vez de criar
outro; nada foi apagado. `DATABASE_ID` vem de `APPWRITE_DATABASE_ID`, com esse
ID como padrão.

**Formato de query.** O Appwrite 1.7.4 rejeita o formato string antigo
(`limit(500)`) com *"Invalid query: Syntax error"*. O correto é JSON:
`queries[]={"method":"limit","values":[500]}`. Os scripts já usam o formato novo.

## Ordem de execução

```bash
# 1. Variáveis (cole a API key você mesmo)
export APPWRITE_ENDPOINT="https://appwrite.kz3solucoes.cloud/v1"
export APPWRITE_PROJECT_ID="6a987e930039a4a13bea"
export APPWRITE_DATABASE_ID="6a9887fe000ab0ab3b2e"
export APPWRITE_API_KEY="..."

# 2. Ver o plano sem tocar no servidor
node appwrite/migrate.mjs --dry-run

# 3. Criar o banco (só o core)
node appwrite/migrate.mjs

# 4. Conferir
node appwrite/verify.mjs

# 5. Opcional: as 7 collections extras de segurança
node appwrite/migrate.mjs --extras

# 6. Functions (precisa do Appwrite CLI)
appwrite login
appwrite push functions
```

O script é idempotente: rodar de novo não duplica nada, só relata o que já existe.

### Depois de criar o banco

1. **Auth** — habilitar Email/Password no console; configurar SMTP (Resend, que
   você já usa); se quiser OAuth Google, cadastrar o provider.
2. **Platform** — registrar a URL do app em *Settings → Platforms* (senão o
   browser é bloqueado por CORS).
3. **Secrets das functions** — as 9 variáveis, cadastradas por function no
   console ou via CLI.
4. **Webhook da Evolution** — reapontar para a URL da function
   `whatsapp-webhook` no Appwrite.
5. **Google Cloud Console** — o redirect URI do OAuth do Calendar precisa apontar
   para a nova URL de `google-calendar-auth`.

---

## Variáveis de ambiente

**Frontend** (`.env`):
```
VITE_APPWRITE_ENDPOINT=https://appwrite.kz3solucoes.cloud/v1
VITE_APPWRITE_PROJECT_ID=default-6a987e930039a4a13bea
```

**Functions** (9 secrets):
```
AI_PROVIDER=omniroute, AI_BASE_URL, AI_API_KEY, AI_MODEL   substituem LOVABLE_API_KEY
EVOLUTION_API_URL, EVOLUTION_API_KEY                WhatsApp
EVOLUTION_WEBHOOK_SECRET                            novo — valida o webhook
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET              Calendar
GOOGLE_TOKENS_ENCRYPTION_KEY                        cifra os tokens do Google
INTERNAL_FUNCTION_SECRET                            novo — chamadas entre functions
PUBLIC_WEBHOOK_BASE_URL                             base pública das functions
APPWRITE_API_KEY                                    acesso server-side ao banco
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` deixam de
existir.

---

## O que falta para o app rodar

Este pacote entrega backend e camada de integração. Falta reescrever os hooks do
front, que hoje importam `@/integrations/supabase/client`:

`useTasks`, `useSubtasks`, `useTaskShares`, `useTaskReminders`, `useReminders`,
`useTeams`, `useTenants`, `useTenantContext`, `useGamification`,
`useNotifications`, `useAuth`, `useAdminGuard`, `useGoogleCalendar`,
`useGoogleCalendarEvents`, `useFocusSessions`, `useTaskAttachments`,
`useWhatsApp`, `useTenantMcp`, `useCalendarSettings`, `usePomodoroSettings`,
`useTimezone`.

O padrão da conversão está inteiro em `database.ts` e `permissions.ts` — a
tradução é mecânica, com uma exceção que merece atenção: **todo ponto onde a
titularidade de um documento muda precisa recalcular as permissões**. É aí que
uma migração Supabase→Appwrite costuma quebrar em silêncio.
