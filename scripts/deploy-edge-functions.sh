#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy-edge-functions.sh — Déploie les Supabase Edge Functions sur un client
#
# WhatsApp (whatsapp-webhook) n'est plus déployé par ce script depuis l'audit
# du 2026-09-16 : la feature est mise de côté (intégration API Meta trop
# coûteuse), et la fonction ne vérifiait aucune signature Meta
# (X-Hub-Signature-256) sur les POST entrants — service_role + URL publique +
# actions métier réelles (devis/factures) + lecture CA/impayés. Voir
# /Users/useersm/.claude/plans/oui-on-audit-tout-compiled-music.md (finding F3).
# Ne pas réactiver ce déploiement sans avoir d'abord implémenté la
# vérification de signature dans supabase/functions/whatsapp-webhook.
#
# Usage :
#   ./scripts/deploy-edge-functions.sh <PROJECT_REF> \
#     --resend-key re_xxx \
#     --resend-from contact@client.fr \
#     --app-url https://client.fr
#
# Clé OpenRouter :
#   Par défaut : clé Atelier partagée lue depuis .env.local (OPENROUTER_API_KEY)
#   Clé propre au client : passer --openrouter-key sk-or-xxx
#     La clé Atelier est ignorée, celle du client est injectée à la place.
#     Utile quand le client gère sa propre conso IA (compte openrouter.ai perso).
#
# Les autres clés partagées Atelier (MISTRAL) sont lues depuis .env.local —
# elles sont identiques pour tous les clients. Les clés par client (RESEND,
# APP_URL) se passent en argument pour ne pas avoir à modifier .env.local
# entre chaque déploiement.
#
# Super PDP n'est pas déployé ici : l'intégration e-facturation tourne côté
# app Next/Cloudflare Worker et se configure avec les variables SUPER_PDP_*
# dans Cloudflare Workers (SUPER_PDP_CLIENT_SECRET/SUPER_PDP_ENCRYPTION_KEY
# restent uniquement côté cockpit, jamais sur une instance client).
#
# Exemples :
#   # Clé Atelier partagée (défaut)
#   ./scripts/deploy-edge-functions.sh pyxnmohknxmbpbcuvudg \
#     --resend-key re_AbCdEf \
#     --resend-from contact@weber-tolerie.fr \
#     --app-url https://atelier-weber.workers.dev
#
#   # Clé propre au client (il gère sa conso OpenRouter)
#   ./scripts/deploy-edge-functions.sh pyxnmohknxmbpbcuvudg \
#     --openrouter-key sk-or-clientxxx \
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
OPENROUTER_KEY_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --resend-key)      RESEND_KEY="$2";              shift 2 ;;
    --resend-from)     RESEND_FROM="$2";             shift 2 ;;
    --app-url)         APP_URL="$2";                 shift 2 ;;
    --openrouter-key)  OPENROUTER_KEY_OVERRIDE="$2"; shift 2 ;;
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
  echo ""
  echo "Option : --openrouter-key sk-or-xxx  (si le client gère sa propre clé IA)"
  exit 1
fi

if [ ! -f ".env.local" ]; then
  echo "❌  Fichier .env.local introuvable. Lance ce script depuis la racine du projet."
  exit 1
fi

# ─── Clés Atelier partagées (depuis .env.local) ───────────────────────────────

MISTRAL_KEY=$(grep '^MISTRAL_API_KEY=' .env.local | cut -d '=' -f2- | tr -d '"')

# ─── Résolution de la clé OpenRouter ─────────────────────────────────────────
# Priorité : --openrouter-key (clé client) > .env.local (clé Atelier partagée)

if [ -n "$OPENROUTER_KEY_OVERRIDE" ]; then
  OPENROUTER_KEY="$OPENROUTER_KEY_OVERRIDE"
  OPENROUTER_SOURCE="clé propre au client (--openrouter-key)"
else
  OPENROUTER_KEY=$(grep '^OPENROUTER_API_KEY=' .env.local | cut -d '=' -f2- | tr -d '"')
  OPENROUTER_SOURCE="clé Atelier partagée (.env.local)"
fi

if [ -z "$OPENROUTER_KEY" ]; then
  echo "❌  Clé OpenRouter manquante."
  echo "    Soit renseigner OPENROUTER_API_KEY dans .env.local (clé Atelier),"
  echo "    soit passer --openrouter-key sk-or-xxx (clé propre au client)."
  exit 1
fi

[ -z "$MISTRAL_KEY" ]               && echo "⚠️   MISTRAL_API_KEY manquant dans .env.local (Voxtral STT désactivé)"
[ -z "$RESEND_KEY" ]                && echo "⚠️   --resend-key non fourni (envoi d'emails désactivé)"
[ -z "$RESEND_FROM" ]               && echo "⚠️   --resend-from non fourni (envoi d'emails désactivé)"
[ -z "$APP_URL" ]                   && echo "⚠️   --app-url non fourni (liens PDF dans emails désactivés)"

echo ""
echo "🚀  Déploiement Edge Functions → projet Supabase : $PROJECT_REF"
echo "    OpenRouter : $OPENROUTER_SOURCE"
echo "────────────────────────────────────────────────────────────────"

# ─── Secrets ────────────────────────────────────────────────────────────────
# whatsapp-webhook n'est plus déployé ici (feature mise de côté, voir en-tête
# du fichier) — il n'y a donc plus de fonction Edge à déployer sur ce projet.

echo ""
echo "🔑  Injection des secrets..."

SECRETS="OPENROUTER_API_KEY=$OPENROUTER_KEY"
[ -n "$MISTRAL_KEY" ]                 && SECRETS="$SECRETS MISTRAL_API_KEY=$MISTRAL_KEY"
[ -n "$RESEND_KEY" ]                  && SECRETS="$SECRETS RESEND_API_KEY=$RESEND_KEY"
[ -n "$RESEND_FROM" ]                 && SECRETS="$SECRETS RESEND_FROM_EMAIL=$RESEND_FROM"
[ -n "$APP_URL" ]                     && SECRETS="$SECRETS APP_URL=$APP_URL"

# shellcheck disable=SC2086
supabase secrets set $SECRETS --project-ref "$PROJECT_REF"
echo "✅  Secrets injectés"

# ─── Résumé ───────────────────────────────────────────────────────────────────

echo ""
echo "────────────────────────────────────────────────────────────────"
echo "✅  Déploiement terminé pour le projet : $PROJECT_REF"
echo ""
echo "Étapes restantes (si premier déploiement) :"
echo "  1. Migrations : supabase link --project-ref $PROJECT_REF && supabase db push"
echo ""
