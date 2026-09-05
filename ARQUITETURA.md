# EisenFlow — arquitetura self-hosted

Tudo do EisenFlow roda na VPS, no Coolify de `coolify.kz3solucoes.cloud`:

| Camada | Onde |
|---|---|
| Front (Vite + React) | app Coolify construído do GitHub (`Dockerfile`, nginx) — `eisenflow.jornadaconectada.com` |
| Banco, Auth, API, Storage, Realtime | stack Supabase dedicada (`supabase-eisenflow.kz3solucoes.cloud`) |
| Lógica de servidor | Edge Functions Deno em `supabase/functions/`, no edge-runtime da stack |
| Agendamentos | pg_cron + pg_net no próprio Postgres, chamando as functions pela rede interna |
| WhatsApp | Evolution GO dedicado (`evo-eisenflow.kz3solucoes.cloud`) |
| IA | OmniRoute (`omniroute.kz3solucoes.cloud/v1`, protocolo OpenAI) |

Como implantar: `deploy/README.md`. As functions: `supabase/functions/README.md`.
As migrations: `supabase/migrations/README.md`.

## O que a auditoria de setembro/2026 corrigiu

O projeto nasceu no Lovable. A revisão completa do código encontrou e corrigiu:

| Problema | Correção |
|---|---|
| `whatsapp-send` era um endpoint aberto (qualquer um disparava mensagem por qualquer instância) | exige `x-internal-secret` ou JWT do dono da instância |
| `whatsapp-webhook` aceitava qualquer POST como se fosse da Evolution | segredo na query + conferência do `instanceToken` do corpo |
| `tenant-whatsapp-verify-phone` deixava qualquer autenticado registrar telefone em qualquer tenant | exige membro do tenant |
| `dispatch-reminders` marcava o envio depois de entregar (queda no meio reenviava) | `UPDATE … WHERE status='pending' RETURNING` — reserva atômica |
| `generate-recurring-tasks` duplicava ocorrências para sempre e perdia o `tenant_id` | corrigido |
| `hermes-mcp` não aplicava rate limit nem whitelist de IP de verdade | RPCs atômicas `check_rate_limit` / `is_ip_allowed` |
| Google Calendar mandava o access_token da sessão cru na URL (`state=`) | `state` assinado por HMAC; a function monta a URL de consent |
| Google Calendar amarrado só ao usuário | `(user_id, tenant_id)`: cada tenant conecta a própria conta Google |
| Tokens do Google com dois esquemas de cifra e chave literal no SQL | AES-256-GCM na function, chave em variável de ambiente |
| `user_2fa.totp_secret` em texto plano ao lado do cifrado, chave `'REPLACE_WITH_VAULT_KEY'` | segredo só cifrado; TOTP verificado dentro do Postgres |
| `CHECK valid_timezone` com fusos inventados (`America/Nerja`) em `auth.users` | validação contra `pg_timezone_names`, coluna em `user_preferences` |
| 3 tabelas de segurança sem RLS | RLS em todas |
| Funções SECURITY DEFINER executáveis por `anon` (`block_ip_address`, `revoke_all_user_tokens`) | REVOKE + guards |
| Lovable AI Gateway (proprietário) | OmniRoute self-hosted, modelo por finalidade, transcrição de áudio |
| Evolution API v2 (Baileys) | Evolution GO dedicado — API diferente: token por instância, sem assinatura de webhook |

## Diferenças do self-hosted em relação ao Supabase Cloud

- **Edge Functions**: não há `supabase functions deploy`; os arquivos vão para
  o volume do edge-runtime e o container reinicia (`deploy/supabase/implantar.sh`).
  `VERIFY_JWT` é global no container, por isso cada function valida a própria
  autenticação.
- **Agendamentos**: pg_cron + pg_net chamam as functions pela URL interna do
  Kong, com `x-internal-secret`; URL e segredo vêm de `app.settings.*` no
  Postgres (o script grava).
- **`auth.users`** é do GoTrue: migration nenhuma altera essa tabela.
- **Chave de cifra** (`app.settings.encryption_key`) é um GUC do database, não o Vault.

## Diagnóstico

Quando o Chat IA responde "ocorreu um erro", chame a function `ai-health`
(logado no app, ou com `x-internal-secret`): ela diz se o problema é chave
recusada pelo OmniRoute, URL errada ou gateway fora do ar — sem expor a chave.
