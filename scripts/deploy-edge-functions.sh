#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy-edge-functions.sh — Déploie les Supabase Edge Functions sur un client
#
# Usage :
#   ./scripts/deploy-edge-functions.sh <PROJECT_REF> \
#     --resend-key re_xxx \
#     --resend-from contact@client.fr \
#     --app-url https://client.fr
#
# Les clés partagées Atelier (OPENROUTER, MISTRAL, SHARED_WABA_*) sont lues
# depuis .env.local — elles sont identiques pour tous les clients.
# Les clés par client (RESEND, APP_URL) se passent en argument pour ne pas
# avoir à modifier .env.local entre chaque déploiement.
#
# Exemple :
#   ./scripts/deploy-edge-functions.sh pyxnmohknxmbpbcuvudg \
#     --resend-key re_AbCdEf \
#     --resend-from contact@weber-tolerie.fr \
#     --app-url https://atelier-weber.workers.dev
#
# Prérequis :
#   - supabase CLI installé et connecté (supabase login)
#   - .env.local présent à la racine du projet (clés Atelier partagées)
# ─────────────────────────────────────────────────────────────────────────────

set -e

PROJECT_REF="${1}"
shift || true

# ─── Parsing des arguments ────────────────────────────────────────────────────

RESEND_KEY=""
RESEND_FROM=""
APP_URL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --resend-key)   RESEND_KEY="$2";  shift 2 ;;
    --resend-from)  RESEND_FROM="$2"; shift 2 ;;
    --app-url)      APP_URL="$2";     shift 2 ;;
    *) echo "⚠️  Argument inconnu : $1" ; shift ;;
  esac
done

# ─── Validation ───────────────────────────────────────────────────────────────

if [ -z "$PROJECT_REF" ]; then
  echo "❌  Erreur : PROJECT_REF manquant."
  echo ""
  echo "Usage : ./scripts/deploy-edge-functions.sh <PROJECT_REF> \\"
  echo "          --resend-key re_xxx \\"
  echo "          --resend-from contact@client.fr \\"
  echo "          --app-url https://client.fr"
  exit 1
fi

if [ ! -f ".env.local" ]; then
  echo "❌  Fichier .env.local introuvable. Lance ce script depuis la racine du projet."
  exit 1
fi

# ─── Clés Atelier partagées (depuis .env.local) ───────────────────────────────

OPENROUTER_KEY=$(grep '^OPENROUTER_API_KEY=' .env.local | cut -d '=' -f2- | tr -d '"')
MISTRAL_KEY=$(grep '^MISTRAL_API_KEY=' .env.local | cut -d '=' -f2- | tr -d '"')
SHARED_WABA_PHONE_NUMBER_ID=$(grep '^SHARED_WABA_PHONE_NUMBER_ID=' .env.local | cut -d '=' -f2- | tr -d '"')
SHARED_WABA_ACCESS_TOKEN=$(grep '^SHARED_WABA_ACCESS_TOKEN=' .env.local | cut -d '=' -f2- | tr -d '"')

if [ -z "$OPENROUTER_KEY" ]; then
  echo "❌  OPENROUTER_API_KEY manquant dans .env.local"
  exit 1
fi

[ -z "$MISTRAL_KEY" ]               && echo "⚠️   MISTRAL_API_KEY manquant dans .env.local (Voxtral STT désactivé)"
[ -z "$RESEND_KEY" ]                && echo "⚠️   --resend-key non fourni (envoi d'emails désactivé)"
[ -z "$RESEND_FROM" ]               && echo "⚠️   --resend-from non fourni (envoi d'emails désactivé)"
[ -z "$APP_URL" ]                   && echo "⚠️   --app-url non fourni (liens PDF dans emails désactivés)"
[ -z "$SHARED_WABA_PHONE_NUMBER_ID" ] && echo "ℹ️   SHARED_WABA_PHONE_NUMBER_ID absent de .env.local (mode WABA mutualisée désactivé)"
[ -z "$SHARED_WABA_ACCESS_TOKEN" ]    && echo "ℹ️   SHARED_WABA_ACCESS_TOKEN absent de .env.local (mode WABA mutualisée désactivé)"

echo ""
echo "🚀  Déploiement Edge Functions → projet Supabase : $PROJECT_REF"
echo "────────────────────────────────────────────────────────────────"

# ─── 1. Deploy whatsapp-webhook ───────────────────────────────────────────────

echo ""
echo "📦  [1/2] Déploiement whatsapp-webhook..."
supabase functions deploy whatsapp-webhook \
  --project-ref "$PROJECT_REF" \
  --no-verify-jwt
echo "✅  whatsapp-webhook déployé"

# ─── 2. Secrets ───────────────────────────────────────────────────────────────

echo ""
echo "🔑  [2/2] Injection des secrets..."

SECRETS="OPENROUTER_API_KEY=$OPENROUTER_KEY"
[ -n "$MISTRAL_KEY" ]                 && SECRETS="$SECRETS MISTRAL_API_KEY=$MISTRAL_KEY"
[ -n "$RESEND_KEY" ]                  && SECRETS="$SECRETS RESEND_API_KEY=$RESEND_KEY"
[ -n "$RESEND_FROM" ]                 && SECRETS="$SECRETS RESEND_FROM_EMAIL=$RESEND_FROM"
[ -n "$APP_URL" ]                     && SECRETS="$SECRETS APP_URL=$APP_URL"
[ -n "$SHARED_WABA_PHONE_NUMBER_ID" ] && SECRETS="$SECRETS SHARED_WABA_PHONE_NUMBER_ID=$SHARED_WABA_PHONE_NUMBER_ID"
[ -n "$SHARED_WABA_ACCESS_TOKEN" ]    && SECRETS="$SECRETS SHARED_WABA_ACCESS_TOKEN=$SHARED_WABA_ACCESS_TOKEN"

# shellcheck disable=SC2086
supabase secrets set $SECRETS --project-ref "$PROJECT_REF"
echo "✅  Secrets injectés"

# ─── Résumé ───────────────────────────────────────────────────────────────────

echo ""
echo "────────────────────────────────────────────────────────────────"
echo "✅  Déploiement terminé pour le projet : $PROJECT_REF"
echo ""
echo "URL webhook (si mode propre WABA) :"
echo "  https://$PROJECT_REF.supabase.co/functions/v1/whatsapp-webhook"
echo ""
echo "Étapes restantes (si premier déploiement) :"
echo "  1. Migrations : supabase link --project-ref $PROJECT_REF && supabase db push"
echo "  2. Mode mutualisé : Settings → WhatsApp → cocher 'Numéro bot Atelier' + ajouter numéros"
echo "  3. Mode propre WABA : configurer le webhook dans Meta + Verify Token dans Settings"
echo ""
