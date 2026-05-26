#!/usr/bin/env bash
# scripts/deploy-cron-workers.sh — Déploie les Workers cron pour UN client
#
# Usage :
#   ./scripts/deploy-cron-workers.sh <worker-name> --env-file=.env.client-nomclient
#   ./scripts/deploy-cron-workers.sh <worker-name> --app-url=https://... --cron-secret=...
#
# Exemples :
#   ./scripts/deploy-cron-workers.sh atelier-weber --env-file=.env.client-weber
#   ./scripts/deploy-cron-workers.sh atelier-weber --app-url=https://weber-tolerie.fr --cron-secret=abc123
#
# Ce que fait ce script :
#   Pour chaque Worker cron (auto-reminder, embeddings) :
#     1. Patch temporaire du name dans wrangler.toml
#     2. wrangler secret put APP_URL + CRON_SECRET
#     3. wrangler deploy --name <worker-cron-nomclient>
#     4. Restauration du name original
#
# Prérequis : wrangler login

set -euo pipefail

WORKER_NAME="${1:-}"
if [[ -z "$WORKER_NAME" ]]; then
  echo "Usage : $0 <worker-name> [--env-file=.env.client-xxx] [--app-url=https://...] [--cron-secret=...]"
  echo "Exemple : $0 atelier-weber --env-file=.env.client-weber"
  exit 1
fi

# Extraire le suffix client depuis le worker-name (atelier-weber → weber)
CLIENT_SUFFIX="${WORKER_NAME#atelier-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Parser les arguments
ENV_FILE=""
APP_URL=""
CRON_SECRET=""
for arg in "${@:2}"; do
  case "$arg" in
    --env-file=*) ENV_FILE="${arg#--env-file=}" ;;
    --app-url=*)  APP_URL="${arg#--app-url=}" ;;
    --cron-secret=*) CRON_SECRET="${arg#--cron-secret=}" ;;
  esac
done

# Lire depuis le fichier env si fourni
if [[ -n "$ENV_FILE" ]]; then
  ENV_PATH="$ROOT_DIR/$ENV_FILE"
  if [[ ! -f "$ENV_PATH" ]]; then
    echo "Fichier env introuvable : $ENV_PATH"
    exit 1
  fi
  if [[ -z "$APP_URL" ]]; then
    APP_URL=$(grep -E '^NEXT_PUBLIC_APP_URL=' "$ENV_PATH" | head -1 | cut -d= -f2- | tr -d '"'"'" | tr -d "'")
  fi
  if [[ -z "$CRON_SECRET" ]]; then
    CRON_SECRET=$(grep -E '^CRON_SECRET=' "$ENV_PATH" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  fi
fi

# Fallback sur .env.local pour CRON_SECRET si toujours vide
if [[ -z "$CRON_SECRET" ]] && [[ -f "$ROOT_DIR/.env.local" ]]; then
  CRON_SECRET=$(grep -E '^CRON_SECRET=' "$ROOT_DIR/.env.local" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
fi

if [[ -z "$APP_URL" ]]; then
  echo "APP_URL manquant — fournir via --app-url= ou NEXT_PUBLIC_APP_URL dans le fichier env"
  exit 1
fi
if [[ -z "$CRON_SECRET" ]]; then
  echo "CRON_SECRET manquant — fournir via --cron-secret= ou CRON_SECRET dans le fichier env"
  exit 1
fi

APP_URL="${APP_URL%/}"  # Supprimer slash final

echo "Déploiement Workers cron pour $WORKER_NAME"
echo "  APP_URL     : $APP_URL"
echo "  CRON_SECRET : ${CRON_SECRET:0:8}..."
echo ""

deploy_cron_worker() {
  local worker_dir="$1"
  local base_name="$2"
  local target_name="${base_name}-${CLIENT_SUFFIX}"
  local toml="$worker_dir/wrangler.toml"

  echo "  ▶ $target_name"

  # Sauvegarder le name original
  local original_name
  original_name=$(grep '^name' "$toml" | head -1 | sed 's/name[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/')

  restore_toml_name() {
    sed -i '' "s/^name[[:space:]]*=.*/name = \"$original_name\"/" "$toml"
  }
  trap restore_toml_name EXIT

  # Patcher le name
  sed -i '' "s/^name[[:space:]]*=.*/name = \"$target_name\"/" "$toml"

  # Injecter les secrets
  echo "$APP_URL"    | node "$ROOT_DIR/node_modules/wrangler/bin/wrangler.js" secret put APP_URL    --name "$target_name" --config "$toml"
  echo "$CRON_SECRET" | node "$ROOT_DIR/node_modules/wrangler/bin/wrangler.js" secret put CRON_SECRET --name "$target_name" --config "$toml"

  # Déployer
  node "$ROOT_DIR/node_modules/wrangler/bin/wrangler.js" deploy --config "$toml"

  # Restaurer
  trap - EXIT
  restore_toml_name

  echo "    OK $target_name"
}

deploy_cron_worker "$ROOT_DIR/workers/auto-reminder" "auto-reminder"
deploy_cron_worker "$ROOT_DIR/workers/embeddings"    "atelier-embeddings"

echo ""
echo "Workers cron déployés pour $WORKER_NAME :"
echo "  auto-reminder-${CLIENT_SUFFIX}        — relances + factures récurrentes (8h UTC)"
echo "  atelier-embeddings-${CLIENT_SUFFIX}   — indexation IA (toutes les heures)"
