#!/usr/bin/env bash
# Cria, pela API do Coolify, tudo que o EisenFlow precisa no servidor:
#   1. o serviço one-click "Supabase" dedicado (Supabase-EisenFlow), com domínio
#      do Kong, variáveis do GoTrue (SITE_URL, redirects, SMTP) e do edge-runtime
#   2. o app do front (Public Repository → Dockerfile), com as VITE_* como
#      variáveis de build e o domínio eisenflow.jornadaconectada.com
#
# Roda NO SERVIDOR (Terminal do Coolify, localhost). Idempotente por nome: se o
# serviço ou o app já existem, reaproveita e só atualiza variáveis/domínio.
#
# Segredos ficam em deploy/coolify/.env (chmod 600, fora do git):
#   COOLIFY_TOKEN=...            (Coolify → Keys & Tokens → API tokens, permissão de escrita)
#   RESEND_API_KEY=...           (SMTP do GoTrue)
#   EVOLUTION_API_KEY=...        (GLOBAL_API_KEY do Evo-Go-EisenFlow)
#   AI_API_KEY=...               (chave do OmniRoute para o EisenFlow)
#   GOOGLE_CLIENT_ID=            GOOGLE_CLIENT_SECRET=      (podem ficar vazios por ora)
# Os demais segredos (webhook, cifra, interno) são GERADOS aqui e gravados no mesmo arquivo.
set -euo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"
ENV_ARQ="$AQUI/.env"
[ -f "$ENV_ARQ" ] || { echo "✗ crie $ENV_ARQ com COOLIFY_TOKEN=... (veja o cabeçalho deste script)"; exit 1; }
chmod 600 "$ENV_ARQ"
# shellcheck disable=SC1090
source "$ENV_ARQ"
: "${COOLIFY_TOKEN:?COOLIFY_TOKEN ausente em $ENV_ARQ}"

# Gera o que é do projeto, uma vez só, e persiste — trocar depois invalida
# webhooks registrados na Evolution e tokens do Google já cifrados.
gerar() { local k="$1" n="$2"; if [ -z "${!k:-}" ]; then local v; v="$(openssl rand -hex "$n")"; echo "$k=$v" >> "$ENV_ARQ"; export "$k=$v"; echo "· $k gerado"; fi; }
gerar INTERNAL_FUNCTION_SECRET 32
gerar EVOLUTION_WEBHOOK_SECRET 24
gerar GOOGLE_TOKENS_ENCRYPTION_KEY 32

COOLIFY_URL="${COOLIFY_URL:-http://localhost:8000}"
NOME_STACK="${NOME_STACK:-supabase-eisenflow}"
DOMINIO_API="${DOMINIO_API:-supabase-eisenflow.kz3solucoes.cloud}"
DOMINIO_FRONT="${DOMINIO_FRONT:-eisenflow.jornadaconectada.com}"
REPO="${REPO:-https://github.com/fabiogasparr/eisenflow}"
NOME_APP="${NOME_APP:-eisenflow}"
PROJETO_NOME="${PROJETO_NOME:-Meus Projetos}"

api() { # api METODO CAMINHO [JSON]
  local m="$1" p="$2" b="${3:-}"
  curl -sS -X "$m" "$COOLIFY_URL/api/v1$p" \
    -H "Authorization: Bearer $COOLIFY_TOKEN" -H "Content-Type: application/json" -H "Accept: application/json" \
    ${b:+--data "$b"}
}
jqq() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)" 2>/dev/null; }

echo "── descobrindo projeto e servidor"
SERVER_UUID="$(api GET /servers | jqq "d[0]['uuid']")"
PROJ_UUID="$(api GET /projects | jqq "[p['uuid'] for p in d if p['name']=='$PROJETO_NOME'][0]")"
[ -n "$SERVER_UUID" ] && [ -n "$PROJ_UUID" ] || { echo "✗ token sem permissão ou projeto '$PROJETO_NOME' não existe"; api GET /projects; exit 1; }
echo "  servidor $SERVER_UUID · projeto $PROJ_UUID"

# ───────────────────────────────────────────────── 1. stack Supabase
echo "── serviço $NOME_STACK"
SVC_UUID="$(api GET /services | jqq "[s['uuid'] for s in d if s['name']=='$NOME_STACK'][0]" || true)"
if [ -z "$SVC_UUID" ]; then
  RESP="$(api POST /services "{\"type\":\"supabase\",\"name\":\"$NOME_STACK\",\"description\":\"Supabase dedicado ao EisenFlow\",\"project_uuid\":\"$PROJ_UUID\",\"environment_name\":\"production\",\"server_uuid\":\"$SERVER_UUID\",\"instant_deploy\":false}")"
  SVC_UUID="$(echo "$RESP" | jqq "d['uuid']")"
  [ -n "$SVC_UUID" ] || { echo "✗ não criou o serviço:"; echo "$RESP"; exit 1; }
  echo "  criado: $SVC_UUID"
else
  echo "  já existia: $SVC_UUID"
fi

echo "── variáveis do serviço"
FUNCS_URL="https://$DOMINIO_API/functions/v1"
env_svc() { # env_svc CHAVE VALOR  (cria ou atualiza)
  local k="$1" v="$2"
  api PATCH "/services/$SVC_UUID/envs" "{\"key\":\"$k\",\"value\":\"$v\",\"is_preview\":false,\"is_literal\":false,\"is_multiline\":false,\"is_shown_once\":false}" >/dev/null \
    || api POST "/services/$SVC_UUID/envs" "{\"key\":\"$k\",\"value\":\"$v\"}" >/dev/null
  echo "  $k"
}
# Kong = a URL pública da stack (o template usa SERVICE_FQDN_SUPABASEKONG)
env_svc SERVICE_FQDN_SUPABASEKONG "https://$DOMINIO_API"
# GoTrue
env_svc SITE_URL "https://$DOMINIO_FRONT"
env_svc ADDITIONAL_REDIRECT_URLS "https://$DOMINIO_FRONT/auth/recovery,https://$DOMINIO_FRONT/**"
env_svc ENABLE_EMAIL_AUTOCONFIRM "false"
env_svc DISABLE_SIGNUP "false"
if [ -n "${RESEND_API_KEY:-}" ]; then
  env_svc SMTP_HOST "smtp.resend.com"; env_svc SMTP_PORT "465"; env_svc SMTP_USER "resend"
  env_svc SMTP_PASS "$RESEND_API_KEY"; env_svc SMTP_ADMIN_EMAIL "${SMTP_FROM:-onboarding@resend.dev}"
  env_svc SMTP_SENDER_NAME "EisenFlow"
fi
# edge-runtime (o compose precisa referenciar estas chaves — ver deploy/supabase/edge-functions.env.md)
env_svc VERIFY_JWT "false"
env_svc INTERNAL_FUNCTION_SECRET "$INTERNAL_FUNCTION_SECRET"
env_svc PUBLIC_FUNCTIONS_URL "$FUNCS_URL"
env_svc EVOLUTION_API_URL "${EVOLUTION_API_URL:-https://evo-eisenflow.kz3solucoes.cloud}"
env_svc EVOLUTION_API_KEY "${EVOLUTION_API_KEY:-}"
env_svc EVOLUTION_WEBHOOK_SECRET "$EVOLUTION_WEBHOOK_SECRET"
env_svc AI_BASE_URL "${AI_BASE_URL:-https://omniroute.kz3solucoes.cloud/v1}"
env_svc AI_API_KEY "${AI_API_KEY:-}"
env_svc GOOGLE_CLIENT_ID "${GOOGLE_CLIENT_ID:-}"
env_svc GOOGLE_CLIENT_SECRET "${GOOGLE_CLIENT_SECRET:-}"
env_svc GOOGLE_TOKENS_ENCRYPTION_KEY "$GOOGLE_TOKENS_ENCRYPTION_KEY"

echo "── compose do edge-runtime: injetando as variáveis"
# O template não passa nossas variáveis ao container; acrescenta as linhas no
# bloco environment do supabase-edge-functions (só se ainda não estiverem lá).
COMPOSE_ARQ="/data/coolify/services/$SVC_UUID/docker-compose.yml"
if [ -f "$COMPOSE_ARQ" ]; then
  python3 - "$COMPOSE_ARQ" <<'PY'
import sys, re
p = sys.argv[1]; s = open(p).read()
chaves = ["VERIFY_JWT","INTERNAL_FUNCTION_SECRET","PUBLIC_FUNCTIONS_URL","EVOLUTION_API_URL","EVOLUTION_API_KEY",
          "EVOLUTION_WEBHOOK_SECRET","AI_BASE_URL","AI_API_KEY","GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","GOOGLE_TOKENS_ENCRYPTION_KEY"]
m = re.search(r"(\n  supabase-edge-functions:\n(?:.*\n)*?    environment:\n)", s)
if not m: print("  ! não achei o bloco environment do supabase-edge-functions — edite pelo painel (deploy/supabase/edge-functions.env.md)"); sys.exit(0)
ins = m.end(); bloco_fim = s.find("\n    ", ins); 
# indentação dos itens existentes
ind = re.search(r"\n(\s+)- ", s[ins:ins+400]); ind = ind.group(1) if ind else "      "
novas = [f"{ind}- {k}=${{{k}}}\n" for k in chaves if f"- {k}=" not in s and f"{k}:" not in s]
if novas:
    s = s[:ins] + "".join(novas) + s[ins:]
    open(p, "w").write(s); print(f"  {len(novas)} variáveis acrescentadas ao compose")
else:
    print("  compose já tinha todas")
PY
else
  echo "  ! compose ainda não foi gerado (serviço nunca implantado) — rode este script de novo depois do primeiro deploy"
fi

echo "── iniciando a stack"
api POST "/services/$SVC_UUID/start" >/dev/null && echo "  deploy disparado (acompanhe em Coolify → $NOME_STACK)"

# ───────────────────────────────────────────────── 2. app do front
echo "── app $NOME_APP (front)"
ANON="$(api GET "/services/$SVC_UUID/envs" | jqq "[e['value'] for e in d if e['key'] in ('SERVICE_SUPABASEANON_KEY','ANON_KEY')][0]" || true)"
APP_UUID="$(api GET /applications | jqq "[a['uuid'] for a in d if a['name']=='$NOME_APP'][0]" || true)"
if [ -z "$APP_UUID" ]; then
  RESP="$(api POST /applications/public "{\"project_uuid\":\"$PROJ_UUID\",\"server_uuid\":\"$SERVER_UUID\",\"environment_name\":\"production\",\"git_repository\":\"$REPO\",\"git_branch\":\"main\",\"build_pack\":\"dockerfile\",\"ports_exposed\":\"80\",\"name\":\"$NOME_APP\",\"domains\":\"https://$DOMINIO_FRONT\",\"instant_deploy\":false}")"
  APP_UUID="$(echo "$RESP" | jqq "d['uuid']")"
  [ -n "$APP_UUID" ] || { echo "✗ não criou o app:"; echo "$RESP"; exit 1; }
  echo "  criado: $APP_UUID"
else
  echo "  já existia: $APP_UUID"
fi
env_app() { local k="$1" v="$2"
  api PATCH "/applications/$APP_UUID/envs" "{\"key\":\"$k\",\"value\":\"$v\",\"is_build_time\":true,\"is_preview\":false,\"is_literal\":false}" >/dev/null \
    || api POST "/applications/$APP_UUID/envs" "{\"key\":\"$k\",\"value\":\"$v\",\"is_build_time\":true}" >/dev/null
  echo "  $k (build)"; }
env_app VITE_SUPABASE_URL "https://$DOMINIO_API"
if [ -n "$ANON" ]; then env_app VITE_SUPABASE_PUBLISHABLE_KEY "$ANON"; else echo "  ! anon key ainda não gerada — rode de novo após o deploy da stack"; fi
api POST "/applications/$APP_UUID/start" >/dev/null && echo "  build disparado"

cat <<FIM

── o que falta e não passa por aqui
  • DNS (Hostinger): CNAME  supabase-eisenflow → kz3solucoes.cloud
  • DNS (jornadaconectada.com): eisenflow → IP deste servidor (hoje aponta para o Lovable)
  • quando a stack estiver no ar:  SUPABASE_UUID=$SVC_UUID deploy/supabase/implantar.sh
  • Google Cloud (OAuth): redirect $FUNCS_URL/google-calendar-auth?action=callback
FIM
