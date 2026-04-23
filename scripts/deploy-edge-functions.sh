#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy-edge-functions.sh — Déploie les Supabase Edge Functions sur un client
#
# Usage :
#   ./scripts/deploy-edge-functions.sh <PROJECT_REF>
#
# Exemple :
#   ./scripts/deploy-edge-functions.sh pyxnmohknxmbpbcuvudg
#
# Prérequis :
#   - supabase CLI installé (npm install -g supabase)
#   - Être connecté (supabase login)
#   - Fichier .env.local présent (contient tes clés API)
# ─────────────────────────────────────────────────────────────────────────────

set -e  # Arrêt immédiat si une commande échoue

PROJECT_REF="${1}"

# ─── Validation ───────────────────────────────────────────────────────────────

if [ -z "$PROJECT_REF" ]; then
  echo "❌  Erreur : PROJECT_REF manquant."
  echo ""
  echo "Usage : ./scripts/deploy-edge-functions.sh <PROJECT_REF>"
  echo ""
  echo "Tu trouves le PROJECT_REF dans : Supabase Dashboard → Settings → General → Reference ID"
  exit 1
fi

# Charger les variables depuis .env.local
if [ ! -f ".env.local" ]; then
  echo "❌  Fichier .env.local introuvable. Lance ce script depuis la racine du projet."
  exit 1
fi

# Extraire les clés API depuis .env.local
OPENROUTER_KEY=$(grep '^OPENROUTER_API_KEY=' .env.local | cut -d '=' -f2- | tr -d '"')
MISTRAL_KEY=$(grep '^MISTRAL_API_KEY=' .env.local | cut -d '=' -f2- | tr -d '"')
RESEND_KEY=$(grep '^RESEND_API_KEY=' .env.local | cut -d '=' -f2- | tr -d '"')
RESEND_FROM=$(grep '^RESEND_FROM_ADDRESS=' .env.local | cut -d '=' -f2- | tr -d '"')
APP_URL=$(grep '^NEXT_PUBLIC_APP_URL=' .env.local | cut -d '=' -f2- | tr -d '"')

if [ -z "$OPENROUTER_KEY" ]; then
  echo "❌  OPENROUTER_API_KEY manquant dans .env.local"
  exit 1
fi

if [ -z "$MISTRAL_KEY" ]; then
  echo "⚠️   MISTRAL_API_KEY manquant dans .env.local (Voxtral STT désactivé)"
fi

if [ -z "$RESEND_KEY" ]; then
  echo "⚠️   RESEND_API_KEY manquant dans .env.local (envoi d'emails désactivé)"
fi

if [ -z "$RESEND_FROM" ]; then
  echo "⚠️   RESEND_FROM_ADDRESS manquant dans .env.local (envoi d'emails désactivé)"
fi

if [ -z "$APP_URL" ]; then
  echo "⚠️   NEXT_PUBLIC_APP_URL manquant dans .env.local (liens PDF dans emails désactivés)"
fi

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
echo "🔑  [2/2] Injection des secrets API..."

SECRETS="OPENROUTER_API_KEY=$OPENROUTER_KEY"
if [ -n "$MISTRAL_KEY" ]; then
  SECRETS="$SECRETS MISTRAL_API_KEY=$MISTRAL_KEY"
fi
if [ -n "$RESEND_KEY" ]; then
  SECRETS="$SECRETS RESEND_API_KEY=$RESEND_KEY"
fi
if [ -n "$RESEND_FROM" ]; then
  SECRETS="$SECRETS RESEND_FROM_EMAIL=$RESEND_FROM"
fi
if [ -n "$APP_URL" ]; then
  SECRETS="$SECRETS APP_URL=$APP_URL"
fi

# shellcheck disable=SC2086
supabase secrets set $SECRETS --project-ref "$PROJECT_REF"

echo "✅  Secrets injectés"

# ─── Résumé ───────────────────────────────────────────────────────────────────

echo ""
echo "────────────────────────────────────────────────────────────────"
echo "✅  Déploiement terminé pour le projet : $PROJECT_REF"
echo ""
echo "URL webhook à copier dans Meta Dashboard :"
echo "  https://$PROJECT_REF.supabase.co/functions/v1/whatsapp-webhook"
echo ""
echo "Étapes restantes (une seule fois par client) :"
echo "  1. Appliquer les migrations manquantes : supabase db push --project-ref $PROJECT_REF"
echo "  2. Configurer le webhook dans Meta Developer Dashboard"
echo "  3. Configurer le Verify Token + Phone Number ID dans Settings > Agent WhatsApp"
echo ""
