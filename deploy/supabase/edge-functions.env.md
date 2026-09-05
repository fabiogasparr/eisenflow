# Variáveis do container `supabase-edge-functions`

No Coolify: serviço Supabase → **Edit Compose file** → no serviço
`supabase-edge-functions`, acrescente ao bloco `environment:` as linhas abaixo
(sem valor — o Coolify cria cada uma em *Environment Variables*, onde você cola
os valores). Depois **Save** e **Redeploy** só desse serviço.

```yaml
      - VERIFY_JWT=false
      - INTERNAL_FUNCTION_SECRET=${INTERNAL_FUNCTION_SECRET}
      - PUBLIC_FUNCTIONS_URL=${PUBLIC_FUNCTIONS_URL}
      - EVOLUTION_API_URL=${EVOLUTION_API_URL}
      - EVOLUTION_API_KEY=${EVOLUTION_API_KEY}
      - EVOLUTION_WEBHOOK_SECRET=${EVOLUTION_WEBHOOK_SECRET}
      - AI_BASE_URL=${AI_BASE_URL}
      - AI_API_KEY=${AI_API_KEY}
      - GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
      - GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
      - GOOGLE_TOKENS_ENCRYPTION_KEY=${GOOGLE_TOKENS_ENCRYPTION_KEY}
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e `JWT_SECRET`
o template do Coolify já injeta.

| Variável | Valor |
|---|---|
| `VERIFY_JWT` | `false` — cada function valida a própria autenticação |
| `INTERNAL_FUNCTION_SECRET` | o de `deploy/supabase/.env` no servidor (gerado pelo `implantar.sh`); é o mesmo que o pg_cron manda em `x-internal-secret` |
| `PUBLIC_FUNCTIONS_URL` | `https://<dominio-da-stack>/functions/v1` |
| `EVOLUTION_API_URL` | `https://evo-eisenflow.kz3solucoes.cloud` |
| `EVOLUTION_API_KEY` | a `GLOBAL_API_KEY` do Evolution GO do EisenFlow |
| `EVOLUTION_WEBHOOK_SECRET` | `openssl rand -hex 24` — vai na query do webhook |
| `AI_BASE_URL` | `https://omniroute.kz3solucoes.cloud/v1` |
| `AI_API_KEY` | chave do OmniRoute para o EisenFlow |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | do OAuth client no Google Cloud (redirect: `<PUBLIC_FUNCTIONS_URL>/google-calendar-auth?action=callback`) |
| `GOOGLE_TOKENS_ENCRYPTION_KEY` | `openssl rand -hex 32` — trocar invalida todos os tokens do Google gravados |

Opcionais: `AI_MODEL_CLASSIFICAR`, `AI_MODEL_CONVERSAR`, `AI_MODEL_VISAO`,
`AI_MODEL_JULGAR`, `AI_MODEL_TRANSCREVER`, `EVOLUTION_WEBHOOK_URL`, `GOOGLE_STATE_SECRET`.
