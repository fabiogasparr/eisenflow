#!/usr/bin/env bash
# Implanta o backend do EisenFlow numa stack Supabase self-hosted criada pelo
# Coolify (serviço "Supabase" one-click). Roda NO SERVIDOR (Terminal do Coolify,
# localhost), a partir de um clone do repo.
#
# O que faz, idempotente:
#   1. aplica as migrations SQL em ordem, registrando as já aplicadas
#   2. grava os GUCs app.settings.* que as migrations e o pg_cron leem
#   3. copia supabase/functions/* para o volume do edge-runtime e o reinicia
#
# Uso:
#   SUPABASE_UUID=<uuid do serviço no Coolify> deploy/supabase/implantar.sh [--so-migrations|--so-functions]
#
# Segredos (nunca no git): deploy/supabase/.env com
#   INTERNAL_FUNCTION_SECRET=...   ENCRYPTION_KEY=...(64 hex)
# Se o arquivo não existir, os dois são GERADOS e gravados com chmod 600.
set -euo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
: "${SUPABASE_UUID:?defina SUPABASE_UUID (Coolify → serviço Supabase → a parte final da URL)}"

SERVICO_DIR="/data/coolify/services/$SUPABASE_UUID"
DB="supabase-db-$SUPABASE_UUID"
EDGE="supabase-edge-functions-$SUPABASE_UUID"
KONG="supabase-kong-$SUPABASE_UUID"
VOL_FUNCS="$SERVICO_DIR/volumes/functions"

[ -d "$SERVICO_DIR" ] || { echo "✗ $SERVICO_DIR não existe — UUID errado?"; exit 1; }
docker inspect "$DB" >/dev/null 2>&1 || { echo "✗ container $DB não encontrado (a stack subiu?)"; exit 1; }

ENV_ARQ="$AQUI/.env"
if [ ! -f "$ENV_ARQ" ]; then
  echo "· gerando segredos do projeto em $ENV_ARQ"
  {
    echo "INTERNAL_FUNCTION_SECRET=$(openssl rand -hex 32)"
    echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"
  } > "$ENV_ARQ"
  chmod 600 "$ENV_ARQ"
fi
# shellcheck disable=SC1090
source "$ENV_ARQ"

psql_() { docker exec -i "$DB" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -q "$@"; }

migrations() {
  echo "── migrations"
  psql_ <<'SQL'
CREATE TABLE IF NOT EXISTS public._eisenflow_migrations (
  nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now()
);
SQL
  local n=0
  for arq in "$RAIZ"/supabase/migrations/*.sql; do
    nome="$(basename "$arq")"
    if psql_ -tAc "SELECT 1 FROM public._eisenflow_migrations WHERE nome='$nome'" | grep -q 1; then
      continue
    fi
    echo "  → $nome"
    # Cada migration numa transação: ou entra inteira ou não entra.
    { echo "BEGIN;"; cat "$arq"; echo "INSERT INTO public._eisenflow_migrations(nome) VALUES ('$nome'); COMMIT;"; } | psql_
    n=$((n+1))
  done
  echo "  $n aplicadas"

  echo "── app.settings.*"
  # Dentro da rede da stack o Kong é alcançável pelo nome do container.
  psql_ <<SQL
ALTER DATABASE postgres SET app.settings.functions_url = 'http://$KONG:8000/functions/v1';
ALTER DATABASE postgres SET app.settings.internal_secret = '$INTERNAL_FUNCTION_SECRET';
ALTER DATABASE postgres SET app.settings.encryption_key = '$ENCRYPTION_KEY';
SQL
  echo "  ok (os GUCs valem para conexões novas; pg_cron abre conexão nova a cada job)"
}

functions() {
  echo "── edge functions → $VOL_FUNCS"
  mkdir -p "$VOL_FUNCS"
  # Preserva o roteador `main/` que o edge-runtime exige; substitui o resto.
  find "$VOL_FUNCS" -mindepth 1 -maxdepth 1 ! -name main -exec rm -rf {} +
  cp -r "$RAIZ"/supabase/functions/. "$VOL_FUNCS"/
  rm -f "$VOL_FUNCS/README.md"
  if [ ! -f "$VOL_FUNCS/main/index.ts" ]; then
    echo "  ! não há main/index.ts no volume — usando o roteador do repo"
    mkdir -p "$VOL_FUNCS/main" && cp "$AQUI/main-router.ts" "$VOL_FUNCS/main/index.ts"
  fi
  docker restart "$EDGE" >/dev/null && echo "  $EDGE reiniciado"
  sleep 3
  docker logs --tail 5 "$EDGE" 2>&1 | sed 's/^/  │ /'
}

case "${1:-}" in
  --so-migrations) migrations ;;
  --so-functions)  functions ;;
  *) migrations; functions ;;
esac

cat <<FIM

Pronto. Falta só o que é do Coolify (uma vez):
  • Variáveis do edge-runtime (deploy/supabase/edge-functions.env.md) — inclua
    INTERNAL_FUNCTION_SECRET com o valor de $ENV_ARQ
  • VERIFY_JWT=false no edge-runtime (cada function valida sozinha)
FIM
