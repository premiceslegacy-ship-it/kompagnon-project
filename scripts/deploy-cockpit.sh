#!/usr/bin/env bash
# scripts/deploy-cockpit.sh — Met a jour le Worker cockpit Orsayn uniquement.
#
# Usage :
#   ./scripts/deploy-cockpit.sh [worker-name]
#
# Le cockpit utilise son propre Supabase operateur via les variables Cloudflare
# OPERATOR_SUPABASE_URL / OPERATOR_SUPABASE_SERVICE_ROLE_KEY. Ne pas le mettre
# dans scripts/clients.txt.
#
# Pas de .env.client-xxx pour le cockpit — les vars sont injectées directement
# dans Cloudflare. Ce script fait uniquement le build + deploy sans mode interactif.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

WORKER_NAME="${1:-orsayn-cockpit}"
WRANGLER="wrangler.jsonc"

echo "═══════════════════════════════════════════════════"
echo "  Atelier — Déploiement cockpit"
echo "  Worker : $WORKER_NAME"
echo "═══════════════════════════════════════════════════"

sed_inplace() { sed -i'' "$@" 2>/dev/null || sed -i "$@"; }

ORIGINAL_NAME=$(grep '"name"' "$WRANGLER" | head -1 | sed 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

restore_wrangler_name() {
  sed_inplace "s/\"name\":[[:space:]]*\"[^\"]*\"/\"name\": \"$ORIGINAL_NAME\"/" "$WRANGLER"
}

trap restore_wrangler_name EXIT
sed_inplace "s/\"name\":[[:space:]]*\"[^\"]*\"/\"name\": \"$WORKER_NAME\"/" "$WRANGLER"

npm run deploy

trap - EXIT
restore_wrangler_name

echo ""
echo "Cockpit deploye."
echo "Verifie que les variables Cloudflare pointent vers le Supabase operateur."
