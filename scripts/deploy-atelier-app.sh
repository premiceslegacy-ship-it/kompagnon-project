#!/usr/bin/env bash
# scripts/deploy-atelier-app.sh — Met a jour l'instance mutualisee Atelier.
#
# Ce script est non interactif pour pouvoir etre utilise dans GitHub Actions.
# Les variables applicatives restent dans Cloudflare et sont conservees par
# `wrangler deploy --keep-vars`, appele par scripts/run-production-deploy.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

WORKER_NAME="atelier-app"
WRANGLER="wrangler.jsonc"
ATELIER_APP_INC_CACHE_KV_ID="0e3366eb6dd7462f9560cd7529c56283"
ATELIER_APP_TAG_CACHE_KV_ID="16283fb3099d478eb306d04b482f671e"

echo "═══════════════════════════════════════════════════"
echo "  Atelier — Déploiement application mutualisée"
echo "  Worker : $WORKER_NAME"
echo "═══════════════════════════════════════════════════"

sed_inplace() {
  if sed --version >/dev/null 2>&1; then
    sed -i "$@"
  else
    sed -i '' "$@"
  fi
}

ORIGINAL_NAME=$(grep '"name"' "$WRANGLER" | head -1 | sed 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
ORIGINAL_INC_CACHE_KV_ID=$(sed -n 's/.*"NEXT_INC_CACHE_KV", "id": "\([^"]*\)".*/\1/p' "$WRANGLER" | head -1)
ORIGINAL_TAG_CACHE_KV_ID=$(sed -n 's/.*"NEXT_TAG_CACHE_KV", "id": "\([^"]*\)".*/\1/p' "$WRANGLER" | head -1)

if [[ -z "$ORIGINAL_NAME" || -z "$ORIGINAL_INC_CACHE_KV_ID" || -z "$ORIGINAL_TAG_CACHE_KV_ID" ]]; then
  echo "Configuration Worker/KV introuvable dans $WRANGLER."
  exit 1
fi

restore_wrangler_config() {
  sed_inplace "s/\"name\":[[:space:]]*\"[^\"]*\"/\"name\": \"$ORIGINAL_NAME\"/" "$WRANGLER"
  sed_inplace "s/\"NEXT_INC_CACHE_KV\", \"id\": \"[^\"]*\"/\"NEXT_INC_CACHE_KV\", \"id\": \"$ORIGINAL_INC_CACHE_KV_ID\"/" "$WRANGLER"
  sed_inplace "s/\"NEXT_TAG_CACHE_KV\", \"id\": \"[^\"]*\"/\"NEXT_TAG_CACHE_KV\", \"id\": \"$ORIGINAL_TAG_CACHE_KV_ID\"/" "$WRANGLER"
}

trap restore_wrangler_config EXIT

sed_inplace "s/\"name\":[[:space:]]*\"[^\"]*\"/\"name\": \"$WORKER_NAME\"/" "$WRANGLER"
sed_inplace "s/\"NEXT_INC_CACHE_KV\", \"id\": \"[^\"]*\"/\"NEXT_INC_CACHE_KV\", \"id\": \"$ATELIER_APP_INC_CACHE_KV_ID\"/" "$WRANGLER"
sed_inplace "s/\"NEXT_TAG_CACHE_KV\", \"id\": \"[^\"]*\"/\"NEXT_TAG_CACHE_KV\", \"id\": \"$ATELIER_APP_TAG_CACHE_KV_ID\"/" "$WRANGLER"

npm run deploy

trap - EXIT
restore_wrangler_config

echo ""
echo "Application mutualisee atelier-app deployee."
