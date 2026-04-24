#!/usr/bin/env bash
# scripts/deploy-all-clients.sh — Met à jour TOUS les clients Atelier en une commande
#
# Usage :
#   ./scripts/deploy-all-clients.sh
#
# Fonctionnement :
#   Lit la liste des Workers dans scripts/clients.txt (un nom par ligne),
#   déploie chacun séquentiellement via deploy-client.sh,
#   et affiche un résumé final.
#
# Note :
#   Chaque Worker lit sa configuration Supabase au runtime via ses
#   variables Cloudflare. Aucun switch de .env.local n'est nécessaire.
#
# Prérequis : wrangler login + npm install -g wrangler @opennextjs/cloudflare

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENTS_FILE="$SCRIPT_DIR/clients.txt"

if [[ ! -f "$CLIENTS_FILE" ]]; then
  echo "❌ Fichier $CLIENTS_FILE introuvable."
  echo ""
  echo "   Crée ce fichier avec un worker-name par ligne, par exemple :"
  echo "     atelier-weber"
  echo "     atelier-dupont"
  echo "     orsayn-cockpit"
  exit 1
fi

# Lecture des clients (ignore lignes vides et commentaires #)
mapfile -t CLIENTS < <(grep -v '^\s*#' "$CLIENTS_FILE" | grep -v '^\s*$')

if [[ ${#CLIENTS[@]} -eq 0 ]]; then
  echo "❌ Aucun client dans $CLIENTS_FILE"
  exit 1
fi

echo "═══════════════════════════════════════════════════"
echo "  Atelier — Déploiement multi-clients"
echo "  $(date '+%Y-%m-%d %H:%M')"
echo "═══════════════════════════════════════════════════"
echo "  Supabase : configuration runtime par Worker"
echo "  ${#CLIENTS[@]} client(s) à déployer :"
for c in "${CLIENTS[@]}"; do echo "    • $c"; done
echo ""

SUCCESS=()
FAILED=()

for CLIENT in "${CLIENTS[@]}"; do
  echo "───────────────────────────────────────────────────"
  if bash "$SCRIPT_DIR/deploy-client.sh" "$CLIENT"; then
    SUCCESS+=("$CLIENT")
  else
    echo "⚠️  Échec pour $CLIENT — déploiement des autres clients en cours..."
    FAILED+=("$CLIENT")
  fi
  echo ""
done

echo "═══════════════════════════════════════════════════"
echo "  Résumé"
echo "═══════════════════════════════════════════════════"
echo "  ✅ Succès (${#SUCCESS[@]}) : ${SUCCESS[*]:-aucun}"
if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "  ❌ Échec  (${#FAILED[@]}) : ${FAILED[*]}"
  exit 1
else
  echo ""
  echo "  Tous les clients sont à jour."
fi
