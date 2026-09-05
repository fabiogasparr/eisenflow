# Migrations — EisenFlow em Supabase self-hosted

66 arquivos SQL, aplicados em ordem lexicográfica (o timestamp do nome).
O banco nasce vazio; não há dados a preservar.

## Pré-requisitos (antes da primeira migration)

1. **Stack de pé pelo menos uma vez.** `auth.users` é criada pelo GoTrue e
   `storage.buckets`/`storage.objects` pelo storage-api, na primeira subida dos
   containers — não pela imagem do Postgres. Migrations rodadas antes disso
   falham em `REFERENCES auth.users(id)` (1ª migration) e em `INSERT INTO
   storage.buckets` (20260324180319).
2. **Extensões da imagem `supabase/postgres`:** `pgcrypto` e `uuid-ossp` já no
   schema `extensions` (a imagem faz isso), `pg_cron` em
   `shared_preload_libraries` com `cron.database_name = postgres`, e `pg_net`
   disponível. As migrations fazem o `CREATE EXTENSION` de pg_cron/pg_net.
3. **Publicação `supabase_realtime`** existente (a imagem cria; a migration
   20260311183702 faz `ALTER PUBLICATION ... ADD TABLE`).
4. **Role de aplicação:** rodar como `postgres` (não superuser na imagem
   Supabase; é o que `supabase db push`/`db reset` usam). Não rodar como
   `supabase_admin`: mascara erros de privilégio que aparecerão depois.

## Aplicar

```bash
# opção A — CLI apontando para o banco remoto
supabase db push --db-url "postgresql://postgres:<senha>@<host>:5432/postgres"

# opção B — psql, uma transação por arquivo, parando no primeiro erro
for f in supabase/migrations/*.sql; do
  psql "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f "$f" || break
done
```

## Configurações que o operador precisa definir (sem elas, nada dispara)

Rodar como `supabase_admin` (ou outro superuser) no banco `postgres`. Valem
para sessões novas: o pg_cron abre uma por execução, então o próximo disparo
já usa; PostgREST/edge-runtime pegam ao reciclar conexões (ou reinicie).

```sql
-- Base das Edge Functions, SEM barra final. Rede interna do docker
-- (http://functions:9000) ou URL pública (https://<dominio>/functions/v1).
ALTER DATABASE postgres SET app.settings.functions_url = '...';

-- Mesmo valor de INTERNAL_SECRET no env da edge-runtime (header x-internal-secret).
ALTER DATABASE postgres SET app.settings.internal_secret = '...';

-- Chave mestra da cifra em banco (segredos TOTP de user_2fa). 32+ caracteres
-- aleatórios. Perdê-la = todos os 2FA precisam ser reconfigurados.
ALTER DATABASE postgres SET app.settings.encryption_key = '...';

-- OPCIONAL: só se FUNCTIONS_VERIFY_JWT=true na edge-runtime.
ALTER DATABASE postgres SET app.settings.functions_bearer = '<SERVICE_ROLE_KEY>';
```

Conferir: `SELECT current_setting('app.settings.functions_url', true);` numa
sessão nova, e `SELECT * FROM cron.job;` / `SELECT * FROM cron.job_run_details
ORDER BY start_time DESC LIMIT 20;` depois do primeiro disparo. Respostas HTTP
ficam em `net._http_response` por algumas horas.

## Ordem e o que cada migration nova faz

As 58 originais (20260311… a 20260902…) rodam sem alteração, com UMA exceção
corrigida no lugar:

| Arquivo | Situação |
|---|---|
| `20260902195100_timezone-support.sql` | **Editada no lugar.** Era inválida num Supabase limpo: `ALTER TABLE auth.users` (postgres não é dono → "must be owner of table users"), CHECK com fusos inventados, e um seed com `auth.uid()` NULL na PK. Ficou só `user_preferences` + funções; detalhes no cabeçalho do arquivo. |

Migrations novas (todas idempotentes — reaplicar não quebra):

| Arquivo | Corrige |
|---|---|
| `20260905000100_timezone-validation.sql` | Defeito **(a)**: validação de fuso por trigger contra `pg_timezone_names` em todas as colunas `timezone` (user_preferences, user_reminder_preferences, recurring_schedules, whatsapp_connections, tenant_whatsapp_connections). `user_preferences` é o lugar do fuso (PK `id` = auth.users.id, mais coluna gerada `user_id` para compatibilidade). |
| `20260905000200_security-tables-rls.sql` | Defeito **(b)**: RLS em `suspicious_ips` (só service_role), `admin_2fa_enforcement` (membros leem, owner/admin gravam), `failed_2fa_attempts` (dono lê; escrita só via função). |
| `20260905000300_2fa-encryption.sql` | Defeito **(c)**: some `user_2fa.totp_secret` (e `backup_codes`) em texto plano; `app_encrypt/app_decrypt` com chave de `app.settings.encryption_key` (erro claro se ausente); `encrypt_token/decrypt_token` (chave por parâmetro, `'REPLACE_WITH_VAULT_KEY'`) removidas. TOTP validado **dentro do banco** (`set_user_2fa_secret`, `verify_user_totp`, `consume_user_backup_code`); o segredo nunca sai. |
| `20260905000400_evolution-go.sql` | `instance_token` + `instance_id` em `whatsapp_connections` e `tenant_whatsapp_connections`, índices em `instance_token`; confere UNIQUE em `whatsapp_processed_messages.message_id` (já era PK). Policies service_role nas duas tabelas de conexão. |
| `20260905000500_google-calendar-multitenant.sql` | `google_calendar_tokens.tenant_id NOT NULL` → tenants (CASCADE); UNIQUE `(user_id, tenant_id)`; índice em tenant_id; RLS exige dono **e** `is_tenant_member`; `is_revoked/revoked_at/revoked_reason`; remove as colunas `*_encrypted`/`encryption_method`/`vault_key_id` (a cifra é na function). `google_token_audit_log` com `tenant_id` e `created_at`, só service_role. |
| `20260905000600_cron-edge-functions.sql` | `public.invoke_edge_function(name[, body])` (pg_net + `x-internal-secret`) e os 7 `cron.schedule` (`ef-*`): dispatch-reminders e process-recurring-schedules a cada 5 min, whatsapp-deadline-reminders a cada 15, whatsapp-report de hora em hora, cleanup-reminders 03:00, generate-recurring-tasks 04:00, reevaluate-deadlines 06:00 (UTC). Mais um job que poda `cron.job_run_details`. |
| `20260905000700_personal-tenant-signup.sql` | Tenant pessoal: `handle_new_user_tenant` idempotente; asserções de que `is_tenant_member`/`get_tenant_role`/`is_tenant_admin` (e as de team) são SECURITY DEFINER (evita recursão de RLS); garante os triggers `on_auth_user_created` e `on_profile_created_create_tenant`. |
| `20260905000800_harden-security-functions.sql` | Funções das migrations de 02/09 que nasciam executáveis por anon/authenticated (`block_ip_address`, `block_api_key`, `revoke_all_user_tokens(<outro>)`, `check_rate_limit`…): só service_role, ou com guard `auth.uid() = p_user_id`. RLS nas tabelas de rate limit. CHECK de `token_rotation_log.token_type` aceitando `'all'`/`'session'` (as funções gravavam isso e falhavam). `report_suspicious_ip` comparava nível por ordem alfabética. |

## O que muda para quem consome o schema

- **Fuso do usuário:** `user_preferences.timezone` (chave `id`). Não existe
  `auth.users.timezone`. Valor inválido dá erro `check_violation`
  (`valid_timezone`).
- **2FA:** o front não lê/grava `totp_secret`. Fluxo: `rpc('set_user_2fa_secret',
  {p_secret_base32, p_backup_codes})` → usuário digita código →
  `rpc('verify_user_totp', {p_code})` → `update user_2fa set is_enabled = true`.
  Recuperação: `rpc('consume_user_backup_code', {p_code})`.
  `src/services/twoFactorAuth.ts` (legado, sem importadores) precisa ser
  reescrito ou apagado se for reativado. O GoTrue tem MFA TOTP nativo; é a
  alternativa a considerar antes de investir nessa tabela.
- **Google Calendar:** toda linha tem `tenant_id`; um usuário pode ter uma
  conexão por tenant. `google_token_audit_log` não é visível ao usuário.
  Colunas `access_token_encrypted`/`refresh_token_encrypted` não existem mais;
  `access_token`/`refresh_token` guardam o blob AES-GCM da function.
- **WhatsApp:** `instance_token` é credencial. Hoje o dono da linha consegue lê-lo
  via `select('*')` (mesma exposição que `qr_code`). Se o front passar a usar só
  a function `whatsapp-status`, o próximo passo é `REVOKE SELECT` na tabela
  para `authenticated` e `GRANT SELECT (colunas...)` — não feito para não
  quebrar `select('*')` sem aviso.
- **Funções de segurança** (`check_rate_limit`, `is_ip_allowed`,
  `block_ip_address`, `revoke_all_user_tokens` de terceiros…) só respondem a
  service_role. `src/middleware/*` e `src/services/token*.ts` (legado, sem
  importadores) deixam de funcionar no browser — por desenho.
- Regenerar `src/integrations/supabase/types.ts` depois de aplicar.

## Testado como

Não há Supabase aqui; as 66 migrations foram aplicadas num Postgres 16 local
com um bootstrap que imita a imagem (roles `anon/authenticated/service_role`,
`postgres` sem superuser, `auth.users` de `supabase_auth_admin`, `storage.*`,
publicação, default privileges do Supabase, `pgcrypto` em `extensions`, stubs
de `pg_cron`/`pg_net`). Depois, testes funcionais: signup pela cadeia de
triggers como `supabase_auth_admin`, trigger de fuso, TOTP contra os vetores
da RFC 6238, RLS de cada tabela tocada, `invoke_edge_function` com/sem
configuração, reaplicação de cada migration nova.
