# Implantação do EisenFlow na VPS (Coolify)

Tudo do EisenFlow roda no Coolify de `coolify.kz3solucoes.cloud`: banco, auth,
API, storage, Edge Functions, WhatsApp e o próprio front. Nada fica no Lovable,
no Supabase Cloud nem em nenhum outro BaaS.

```
eisenflow.jornadaconectada.com ──► [Coolify: app "eisenflow" — nginx + build Vite do GitHub]
                                        │  VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY
                                        ▼
supabase-eisenflow.kz3solucoes.cloud ► [Coolify: serviço "Supabase" dedicado]
                                        Kong → GoTrue · PostgREST · Storage · Realtime
                                             → edge-runtime (supabase/functions/*)
                                        Postgres (pg_cron + pg_net chamam as functions)
                                        │
evo-eisenflow.kz3solucoes.cloud ──────► [Coolify: Evo-Go-EisenFlow]  ◄── webhook das functions
omniroute.kz3solucoes.cloud ──────────► IA (protocolo OpenAI)
```

## 1. Stack Supabase (uma vez)

1. Coolify → *Meus Projetos* → **+ New** → **Supabase** (one-click). Nome: `Supabase-EisenFlow`.
2. Domínio do Kong: `https://supabase-eisenflow.kz3solucoes.cloud` (CNAME → `kz3solucoes.cloud`
   na Hostinger — a zona não tem curinga). Studio pode ficar sem domínio público.
3. Variáveis do serviço que precisam de valor antes do primeiro deploy:
   `SITE_URL=https://eisenflow.jornadaconectada.com`,
   `ADDITIONAL_REDIRECT_URLS=https://eisenflow.jornadaconectada.com/auth/recovery,https://eisenflow.jornadaconectada.com/**`,
   SMTP (Resend: `smtp.resend.com:465`, user `resend`, senha = API key, remetente verificado),
   `ENABLE_EMAIL_AUTOCONFIRM=false`, `DISABLE_SIGNUP=false`.
4. Deploy. Espere GoTrue e Storage subirem (eles criam `auth.users` e `storage.buckets`,
   pré-requisito das migrations).
5. Acrescente as variáveis do edge-runtime: `deploy/supabase/edge-functions.env.md`.

## 2. Banco + functions (a cada versão)

No Terminal do Coolify (`localhost`):

```bash
cd /root && rm -rf eisenflow && git clone --depth 1 https://github.com/fabiogasparr/eisenflow.git && cd eisenflow
SUPABASE_UUID=<uuid do serviço> deploy/supabase/implantar.sh
```

O script aplica só as migrations novas, grava os `app.settings.*` no Postgres
(URL interna das functions, segredo interno, chave de cifra) e sincroniza as
functions com o volume do edge-runtime. Os dois segredos que ele gera ficam em
`deploy/supabase/.env` (600) — copie `INTERNAL_FUNCTION_SECRET` para a variável
homônima do edge-runtime no Coolify.

## 3. Front (uma vez; depois é push na main)

1. Coolify → **+ New** → **Public Repository** → `https://github.com/fabiogasparr/eisenflow`,
   branch `main`, build pack **Dockerfile**.
2. Domínio: `https://eisenflow.jornadaconectada.com`. Porta 80.
3. Em *Environment Variables*, marcadas como **Build Variable**:
   `VITE_SUPABASE_URL=https://supabase-eisenflow.kz3solucoes.cloud` e
   `VITE_SUPABASE_PUBLISHABLE_KEY=<anon key da stack>`.
4. Deploy. Ative *Auto Deploy* (webhook do GitHub) para cada push publicar.
5. DNS: `eisenflow` em jornadaconectada.com apontando para o servidor do Coolify
   (hoje aponta para o Lovable).

## 4. Google Calendar (uma vez)

Google Cloud Console → OAuth client (Web) → redirect
`https://supabase-eisenflow.kz3solucoes.cloud/functions/v1/google-calendar-auth?action=callback`
→ ativar *Google Calendar API* → colar client id/secret no edge-runtime.

## Conferência rápida

- `https://supabase-eisenflow.kz3solucoes.cloud/auth/v1/health` → `{"name":"GoTrue"...}`
- `https://supabase-eisenflow.kz3solucoes.cloud/functions/v1/classify-task` sem token → 401 (function no ar, exigindo JWT)
- `ai-health` (logado no app, ou `curl -H 'x-internal-secret: …' …/functions/v1/ai-health`) → `ok: true` e a contagem de modelos do OmniRoute; se vier `ok: false`, a resposta diz se é chave recusada, URL errada ou gateway fora
- Cadastro no app cria tenant pessoal sozinho (trigger `handle_new_user_tenant`)
- *Conectar WhatsApp* devolve QR; parear; mandar "oi" para si mesmo → a IA responde
- `SELECT jobname, schedule FROM cron.job;` no Postgres → 7 jobs `ef-*`
