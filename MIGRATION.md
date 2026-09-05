# EisenFlow — arquitetura self-hosted e histórico das migrações

O EisenFlow nasceu no Lovable com backend Supabase Cloud. Em 03/09/2026 foi
portado para o Appwrite self-hosted; em 05/09/2026 a decisão foi revertida:
**o backend é Supabase self-hosted numa stack dedicada no Coolify**, e o front
é publicado no Coolify a partir do GitHub. Nada fica no Lovable nem no Appwrite.

Como implantar: `deploy/README.md`. As functions: `supabase/functions/README.md`.
As migrations: `supabase/migrations/README.md`.

## O que sobreviveu da passagem pelo Appwrite

A passagem não foi perdida: ela foi a auditoria mais profunda que o projeto já
teve, e tudo que ela corrigiu foi portado de volta para o mundo Supabase.

| Encontrado no porte para o Appwrite | Onde está agora |
|---|---|
| `whatsapp-send` era um endpoint aberto (qualquer um disparava mensagem) | exige `x-internal-secret` ou JWT do dono da instância |
| `whatsapp-webhook` aceitava qualquer POST | segredo na query + conferência do `instanceToken` |
| `tenant-whatsapp-verify-phone` deixava qualquer autenticado registrar telefone em qualquer tenant | exige membro do tenant |
| `dispatch-reminders` marcava o envio depois de entregar (queda no meio reenviava) | `UPDATE … WHERE status='pending' RETURNING` — reserva atômica |
| `generate-recurring-tasks` duplicava ocorrências para sempre e perdia o `tenant_id` | corrigido |
| `hermes-mcp` não aplicava rate limit nem whitelist de verdade | RPCs atômicas `check_rate_limit` / `is_ip_allowed` |
| Google Calendar mandava o access_token da sessão cru na URL (`state=`) | `state` assinado por HMAC; a function monta a URL de consent |
| Google Calendar amarrado só ao usuário | `(user_id, tenant_id)`: cada tenant conecta a própria conta Google |
| Tokens do Google com dois esquemas de cifra e chave literal no SQL | AES-256-GCM na function, chave em variável de ambiente |
| `user_2fa.totp_secret` em texto plano ao lado do cifrado, chave `'REPLACE_WITH_VAULT_KEY'` | segredo só cifrado; TOTP verificado dentro do Postgres |
| `CHECK valid_timezone` com fusos inventados (`America/Nerja`) em `auth.users` | validação contra `pg_timezone_names`, coluna em `user_preferences` |
| 3 tabelas de segurança sem RLS | RLS em todas |
| Funções SECURITY DEFINER executáveis por `anon` (`block_ip_address`, `revoke_all_user_tokens`) | REVOKE + guards |
| Lovable AI Gateway (proprietário) | OmniRoute self-hosted, modelo por finalidade, transcrição de áudio |
| Evolution API v2 (Baileys) | Evolution GO dedicado — API diferente: token por instância, sem assinatura de webhook |

## Por que Supabase self-hosted e não Appwrite

O código original é Supabase-nativo: 58 migrations SQL com triggers, funções e
RLS que o Postgres executa sozinho. No Appwrite, cada trigger virou código de
aplicação e cada policy virou permissão por documento gravada na criação —
funciona, mas todo ponto onde a titularidade de um registro muda vira um lugar
onde a segurança quebra em silêncio. Voltar ao Postgres devolve isso ao banco.

## Diferenças do self-hosted em relação ao Supabase Cloud

- **Edge Functions**: não há `supabase functions deploy`; os arquivos vão para
  o volume do edge-runtime e o container reinicia (`deploy/supabase/implantar.sh`).
  `VERIFY_JWT` é global no container, por isso cada function valida a própria
  autenticação.
- **Agendamentos**: pg_cron + pg_net chamam as functions pela URL interna do
  Kong, com `x-internal-secret`; URL e segredo vêm de `app.settings.*` no
  Postgres (o script grava).
- **`auth.users`** é do GoTrue: migration nenhuma altera essa tabela (a antiga
  que fazia isso foi corrigida).
- **Chave de cifra** (`app.settings.encryption_key`) é um GUC do database, não o Vault.
