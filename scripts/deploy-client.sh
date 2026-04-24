#!/usr/bin/env bash
# scripts/deploy-client.sh — Déploie OU met à jour UN client Atelier
#
# Usage :
#   ./scripts/deploy-client.sh <worker-name>
#
# Exemples :
#   ./scripts/deploy-client.sh atelier-weber
#   ./scripts/deploy-client.sh atelier-dupont
#
# Ce que fait ce script :
#   1. Patch wrangler.jsonc avec le bon "name"
#   2. Lance npm run deploy (opennextjs build + patch-worker + wrangler deploy)
#   3. Restaure le "name" précédent dans wrangler.jsonc
#
# Note :
#   L'app lit maintenant SUPABASE_URL et SUPABASE_ANON_KEY au runtime
#   depuis Cloudflare Workers. Il n'y a plus de bascule temporaire
#   à faire dans .env.local avant un déploiement client/cockpit.
#
# Prérequis : wrangler login + npm install -g wrangler @opennextjs/cloudflare

set -euo pipefail

WORKER_NAME="${1:-}"

if [[ -z "$WORKER_NAME" ]]; then
  echo "❌ Usage : $0 <worker-name>"
  echo "   Exemple : $0 atelier-weber"
  exit 1
fi

WRANGLER="wrangler.jsonc"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

# Sauvegarde du name actuel pour restauration
ORIGINAL_NAME=$(grep '"name"' "$WRANGLER" | head -1 | sed 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

echo "▶ Déploiement → $WORKER_NAME"
echo "  (name actuel dans wrangler.jsonc : $ORIGINAL_NAME)"
echo "  (Supabase sera lu au runtime via les variables du Worker)"

restore_wrangler_name() {
  sed -i '' "s/\"name\":[[:space:]]*\"[^\"]*\"/\"name\": \"$ORIGINAL_NAME\"/" "$WRANGLER"
}

trap restore_wrangler_name EXIT

# Patch du name
sed -i '' "s/\"name\":[[:space:]]*\"[^\"]*\"/\"name\": \"$WORKER_NAME\"/" "$WRANGLER"

# Build + deploy
npm run deploy

# Restauration du name (pour ne pas salir le repo)
trap - EXIT
restore_wrangler_name

echo ""
echo "✅ $WORKER_NAME déployé avec succès"
echo "   URL : https://$WORKER_NAME.<ton-subdomain>.workers.dev"
echo ""
echo "👉 Penser à injecter les variables dans Cloudflare Dashboard si c'est un nouveau client :"
echo "   dash.cloudflare.com → Workers & Pages → $WORKER_NAME → Settings → Variables and Secrets"
echo "   Variables Supabase attendues : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY"
