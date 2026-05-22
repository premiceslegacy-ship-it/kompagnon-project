#!/usr/bin/env bash
# scripts/deploy-cockpit.sh — Met a jour le Worker cockpit Orsayn uniquement.
#
# Usage :
#   ./scripts/deploy-cockpit.sh [worker-name]
#
# Le cockpit utilise son propre Supabase operateur via les variables Cloudflare
# OPERATOR_SUPABASE_URL / OPERATOR_SUPABASE_SERVICE_ROLE_KEY. Ne pas le mettre
# dans scripts/clients.txt.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_NAME="${1:-orsayn-cockpit}"

echo "═══════════════════════════════════════════════════"
echo "  Atelier — Déploiement cockpit"
echo "  Worker : $WORKER_NAME"
echo "═══════════════════════════════════════════════════"

bash "$SCRIPT_DIR/deploy-client.sh" "$WORKER_NAME"

echo ""
echo "✅ Cockpit déployé."
echo "   Vérifie que les variables Cloudflare pointent vers le Supabase opérateur."
