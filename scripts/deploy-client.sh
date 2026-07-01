#!/usr/bin/env bash
# scripts/deploy-client.sh — Déploie OU met à jour UN client Atelier
#
# Usage interactif (nouveau client) :
#   ./scripts/deploy-client.sh
#
# Usage direct (redéploiement, fichier .env.client-xxx existant) :
#   ./scripts/deploy-client.sh <worker-name>
#
# Ce que fait ce script :
#   1. Si interactif : demande tier, clé OpenRouter client, facturation élec.
#      et génère le fichier .env.client-NOMCLIENT depuis le template adapté
#   2. Patch wrangler.jsonc avec le bon "name"
#   3. npm run deploy (build OpenNext + wrangler deploy --keep-vars)
#   4. Restaure le "name" précédent dans wrangler.jsonc
#   5. Propose d'injecter les variables Cloudflare (npm run cf:env --apply-all)
#
# Prérequis : wrangler login

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

WRANGLER="wrangler.jsonc"

# ── Helpers ────────────────────────────────────────────────────────────────

ask() {
  local var="$1" prompt="$2" default="${3:-}"
  local value
  if [[ -n "$default" ]]; then
    read -r -p "$prompt [$default] : " value
    value="${value:-$default}"
  else
    read -r -p "$prompt : " value
    while [[ -z "$value" ]]; do
      read -r -p "  (obligatoire) $prompt : " value
    done
  fi
  printf -v "$var" '%s' "$value"
}

ask_choice() {
  local var="$1" prompt="$2"; shift 2
  local opts=("$@")
  echo "$prompt"
  for i in "${!opts[@]}"; do
    echo "  $((i+1)). ${opts[$i]}"
  done
  local choice
  while true; do
    read -r -p "  Choix [1-${#opts[@]}] : " choice
    if [[ "$choice" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= ${#opts[@]} )); then
      printf -v "$var" '%s' "${opts[$((choice-1))]}"
      break
    fi
    echo "  Entrer un chiffre entre 1 et ${#opts[@]}"
  done
}

confirm() {
  local answer
  read -r -p "$1 [o/N] : " answer
  [[ "$answer" =~ ^[oOyY]$ ]]
}

sed_inplace() { sed -i'' "$@" 2>/dev/null || sed -i "$@"; }

# ── Nom du Worker ───────────────────────────────────────────────────────────
WORKER_NAME="${1:-}"

if [[ -z "$WORKER_NAME" ]]; then
  echo ""
  echo "=== Deploiement client Atelier ==="
  echo ""
  ask WORKER_NAME "Nom du Worker Cloudflare (ex: atelier-weber)"
fi

if ! [[ "$WORKER_NAME" =~ ^[a-z0-9][a-z0-9-]{1,62}$ ]]; then
  echo "Nom invalide : minuscules, chiffres et tirets, commence par une lettre/chiffre."
  exit 1
fi

ENV_FILE=".env.client-${WORKER_NAME}"

# ── Mode interactif — génération du .env.client ─────────────────────────────
GENERATE_ENV=false
if [[ ! -f "$ENV_FILE" ]]; then
  GENERATE_ENV=true
elif confirm "Fichier $ENV_FILE existant — regénérer depuis un template ?"; then
  GENERATE_ENV=true
fi

if $GENERATE_ENV; then
  echo ""
  echo "--- Configuration du tier ---"
  echo ""

  TIER_CHOICE=""
  ask_choice TIER_CHOICE "Tier MRR du client :" \
    "setup-only : pas de MRR, IA désactivée" \
    "starter    : 39 EUR/mois, IA sans Sarah" \
    "pro        : 69 EUR/mois, Sarah + vocal live 60 min" \
    "expert     : 139 EUR/mois, tout illimité + vocal live 300 min"

  TIER_SLUG=$(echo "$TIER_CHOICE" | awk -F: '{print $1}' | tr -d ' ')

  TEMPLATE=".env.client-template-${TIER_SLUG}"
  if [[ ! -f "$TEMPLATE" ]]; then
    echo "Template introuvable : $TEMPLATE"
    exit 1
  fi

  # Clé OpenRouter client ?
  OWN_OPENROUTER="false"
  if [[ "$TIER_SLUG" != "setup-only" ]]; then
    echo ""
    if confirm "Le client utilise-t-il sa propre clé OpenRouter ?"; then
      OWN_OPENROUTER="true"
    fi
  fi

  # Facturation électronique B2Brouter ?
  B2BROUTER_ACTIVE="false"
  echo ""
  if confirm "Activer la facturation électronique B2Brouter (add-on annuel) ?"; then
    B2BROUTER_ACTIVE="true"
  fi

  echo ""
  echo "--- Informations client ---"
  echo ""

  SUPABASE_URL_VAL="" SUPABASE_ANON_VAL="" SUPABASE_SERVICE_VAL=""
  APP_URL_VAL="" RESEND_FROM_VAL="" RESEND_NAME_VAL=""

  ask SUPABASE_URL_VAL  "URL Supabase (https://xxxx.supabase.co)"
  ask SUPABASE_ANON_VAL "Supabase anon key (eyJ...)"
  ask SUPABASE_SERVICE_VAL "Supabase service role key (eyJ...)"

  APP_URL_DEFAULT="https://${WORKER_NAME}.mbebourasam.workers.dev"
  ask APP_URL_VAL "URL du Worker Cloudflare" "$APP_URL_DEFAULT"

  CLIENT_SLUG="${WORKER_NAME#atelier-}"
  ask RESEND_FROM_VAL "Adresse expéditeur Resend" "noreply@${CLIENT_SLUG}.fr"
  ask RESEND_NAME_VAL "Nom affiché dans les emails (ex: Weber BTP)"

  # Secrets auto-générés
  echo ""
  echo "Génération des secrets..."
  CRON_SECRET_VAL=$(openssl rand -hex 32)
  MEMBER_SECRET_VAL=$(openssl rand -hex 32)
  RATE_SECRET_VAL=$(openssl rand -hex 32)

  # Copie du template + substitutions
  cp "$TEMPLATE" "$ENV_FILE"

  sed_inplace "s|TODO https://xxxx.supabase.co|${SUPABASE_URL_VAL}|g" "$ENV_FILE"
  sed_inplace "s|SUPABASE_ANON_KEY=\"TODO eyJ...\"|SUPABASE_ANON_KEY=\"${SUPABASE_ANON_VAL}\"|" "$ENV_FILE"
  sed_inplace "s|SUPABASE_SERVICE_ROLE_KEY=\"TODO eyJ...\"|SUPABASE_SERVICE_ROLE_KEY=\"${SUPABASE_SERVICE_VAL}\"|" "$ENV_FILE"
  sed_inplace "s|TODO https://atelier-NOMCLIENT.mbebourasam.workers.dev|${APP_URL_VAL}|g" "$ENV_FILE"
  sed_inplace "s|TODO noreply@domaine-client.fr|${RESEND_FROM_VAL}|g" "$ENV_FILE"
  sed_inplace "s|TODO Nom Client BTP|${RESEND_NAME_VAL}|g" "$ENV_FILE"
  sed_inplace "s|CRON_SECRET=\"TODO openssl rand -hex 32\"|CRON_SECRET=\"${CRON_SECRET_VAL}\"|" "$ENV_FILE"
  sed_inplace "s|MEMBER_SESSION_SECRET=\"TODO openssl rand -hex 32\"|MEMBER_SESSION_SECRET=\"${MEMBER_SECRET_VAL}\"|" "$ENV_FILE"
  sed_inplace "s|RATE_LIMIT_SECRET=\"TODO openssl rand -hex 32\"|RATE_LIMIT_SECRET=\"${RATE_SECRET_VAL}\"|" "$ENV_FILE"

  if [[ "$OWN_OPENROUTER" == "true" ]]; then
    CLIENT_OR_KEY=""
    ask CLIENT_OR_KEY "Clé OpenRouter du client (sk-or-...)"
    sed_inplace "s|OPENROUTER_API_KEY=\"COPIER_DEPUIS_ENV_LOCAL\"|OPENROUTER_API_KEY=\"${CLIENT_OR_KEY}\"|" "$ENV_FILE"
  fi

  if [[ "$B2BROUTER_ACTIVE" == "true" ]]; then
    B2B_KEY="" B2B_ACCOUNT="" B2B_WEBHOOK=""
    ask B2B_KEY     "B2Brouter API key"
    ask B2B_ACCOUNT "B2Brouter account ID"
    ask B2B_WEBHOOK "B2Brouter webhook secret"
    sed_inplace "s|B2BROUTER_ENV=\"sandbox\"|B2BROUTER_ENV=\"production\"|" "$ENV_FILE"
    sed_inplace "s|B2BROUTER_API_KEY=\"\"|B2BROUTER_API_KEY=\"${B2B_KEY}\"|" "$ENV_FILE"
    sed_inplace "s|B2BROUTER_ACCOUNT_ID=\"\"|B2BROUTER_ACCOUNT_ID=\"${B2B_ACCOUNT}\"|" "$ENV_FILE"
    sed_inplace "s|B2BROUTER_WEBHOOK_SECRET=\"\"|B2BROUTER_WEBHOOK_SECRET=\"${B2B_WEBHOOK}\"|" "$ENV_FILE"
  fi

  echo ""
  echo "Fichier $ENV_FILE genere (tier: $TIER_SLUG)."

  if [[ "$TIER_SLUG" == "pro" || "$TIER_SLUG" == "expert" ]]; then
    echo ""
    echo "RAPPEL ElevenLabs : ajouter $APP_URL_VAL dans"
    echo "  ElevenLabs → Agent → Security → Allowed Origins"
    echo "  avant de tester le vocal live Sarah."
  fi
fi

# ── Build + déploiement ─────────────────────────────────────────────────────
echo ""
echo "=== Deploiement → $WORKER_NAME ==="
echo ""

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
echo "Deploiement $WORKER_NAME termine."

# ── Injection variables Cloudflare ──────────────────────────────────────────
echo ""
if confirm "Injecter les variables dans Cloudflare maintenant (npm run cf:env) ?"; then
  npm run cf:env -- "$WORKER_NAME" --env-file="$ENV_FILE" --apply-all
  echo ""
  echo "Variables injectees dans Cloudflare."
fi

# ── Récap final ─────────────────────────────────────────────────────────────
echo ""
echo "=== Client $WORKER_NAME pret ==="
APP_URL_FINAL=$(grep 'NEXT_PUBLIC_APP_URL=' "$ENV_FILE" 2>/dev/null | head -1 | sed 's/.*="\(.*\)"/\1/')
[[ -n "$APP_URL_FINAL" ]] && echo "  URL : $APP_URL_FINAL"
echo ""
echo "Prochaines etapes :"
echo "  1. Migrations SQL Supabase (si nouveau client)"
echo "  2. Configurer organization_modules dans le cockpit Orsayn (tier + quotas)"
echo "  3. Voir DEPLOIEMENT_CLIENT.md pour la checklist complete"
