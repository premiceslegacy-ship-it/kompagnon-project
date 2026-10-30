#!/usr/bin/env bash
# scripts/deploy-cron-workers.sh — Déploie les Workers cron pour UN client
#
# Usage :
#   ./scripts/deploy-cron-workers.sh <worker-name> --env-file=.env.client-<worker-name>
#   Les éventuelles valeurs explicites doivent correspondre au fichier ciblé.
#
# Exemple :
#   ./scripts/deploy-cron-workers.sh atelier-weber --env-file=.env.client-atelier-weber
#
# Ce que fait ce script :
#   Pour chaque Worker cron (auto-reminder, embeddings, data-retention) :
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
  echo "Exemple : $0 atelier-weber --env-file=.env.client-atelier-weber"
  exit 1
fi
if ! [[ "$WORKER_NAME" =~ ^[a-z0-9][a-z0-9-]{1,62}$ ]] || [[ "$WORKER_NAME" == "orsayn-cockpit" ]]; then
  echo "Nom de Worker client invalide." >&2
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
    *) echo "Argument cron non pris en charge." >&2; exit 1 ;;
  esac
done

# Une seule configuration fait autorité pour la base contrôlée, l'URL et le secret.
CUTOVER_WORKER="$WORKER_NAME"
CUTOVER_ENV_FILE=".env.client-${WORKER_NAME}"
if [[ -n "$ENV_FILE" && "$ENV_FILE" != "$CUTOVER_ENV_FILE" ]]; then
  echo "Schema gate requires the exact target file $CUTOVER_ENV_FILE." >&2
  exit 1
fi
ENV_PATH="$ROOT_DIR/$CUTOVER_ENV_FILE"
CONFIG_VALUES="$(node --input-type=module - "$ENV_PATH" <<'NODE'
import { lstatSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
try {
  const file = process.argv[2]
  if (!lstatSync(file).isFile()) throw new Error('Invalid target file')
  const config = parseEnv(readFileSync(file, 'utf8'))
  const url = new URL(config.NEXT_PUBLIC_APP_URL ?? '')
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || (url.pathname !== '/' && url.pathname !== '')) throw new Error('Invalid app origin')
  const secret = config.CRON_SECRET
  if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/i.test(secret)) throw new Error('Invalid cron secret')
  process.stdout.write(`${url.origin}\n${secret}`)
} catch {
  console.error('Configuration cron ciblée invalide ou inaccessible.')
  process.exit(1)
}
NODE
)"
CONFIG_APP_URL="${CONFIG_VALUES%%$'\n'*}"
CONFIG_CRON_SECRET="${CONFIG_VALUES#*$'\n'}"
if [[ -n "$APP_URL" && "${APP_URL%/}" != "$CONFIG_APP_URL" ]]; then
  echo "APP_URL ne correspond pas à la configuration ciblée." >&2
  exit 1
fi
if [[ -n "$CRON_SECRET" && "$CRON_SECRET" != "$CONFIG_CRON_SECRET" ]]; then
  echo "CRON_SECRET ne correspond pas à la configuration ciblée." >&2
  exit 1
fi
APP_URL="$CONFIG_APP_URL"
CRON_SECRET="$CONFIG_CRON_SECRET"
node "$ROOT_DIR/scripts/quote-attachment-cutover.mjs" "$CUTOVER_WORKER" --check


echo "Déploiement Workers cron pour $WORKER_NAME"
echo "  APP_URL     : $APP_URL"
echo "  CRON_SECRET : configuré (valeur masquée)"
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

  # sed -i portable : macOS exige '' après -i, Linux non
  SED_INPLACE() {
    if sed --version >/dev/null 2>&1; then
      sed -i "$@"
    else
      sed -i '' "$@"
    fi
  }

  restore_toml_name() {
    SED_INPLACE "s/^name[[:space:]]*=.*/name = \"$original_name\"/" "$toml"
  }
  trap restore_toml_name EXIT

  # Patcher le name
  SED_INPLACE "s/^name[[:space:]]*=.*/name = \"$target_name\"/" "$toml"

  # Injecter les secrets et déployer depuis le répertoire du Worker cron :
  # exécuté depuis ROOT_DIR, wrangler détecte le projet OpenNext ambiant et
  # bascule sur `opennextjs-cloudflare deploy` (qui exige des bindings KV
  # absents ici) au lieu d'un déploiement wrangler standard.
  (
    cd "$worker_dir"
    echo "$APP_URL"     | node "$ROOT_DIR/node_modules/wrangler/bin/wrangler.js" secret put APP_URL     --name "$target_name" --config "wrangler.toml"
    echo "$CRON_SECRET" | node "$ROOT_DIR/node_modules/wrangler/bin/wrangler.js" secret put CRON_SECRET --name "$target_name" --config "wrangler.toml"
    node "$ROOT_DIR/node_modules/wrangler/bin/wrangler.js" deploy --config "wrangler.toml"
  )

  # Restaurer
  trap - EXIT
  restore_toml_name

  echo "    OK $target_name"
}

deploy_cron_worker "$ROOT_DIR/workers/auto-reminder"  "auto-reminder"
deploy_cron_worker "$ROOT_DIR/workers/embeddings"     "atelier-embeddings"
deploy_cron_worker "$ROOT_DIR/workers/data-retention" "atelier-data-retention"

echo ""
echo "Workers cron déployés pour $WORKER_NAME :"
echo "  auto-reminder-${CLIENT_SUFFIX}           — rattrapage horaire + relances et factures quotidiennes"
echo "  atelier-embeddings-${CLIENT_SUFFIX}      — indexation IA (toutes les heures)"
echo "  atelier-data-retention-${CLIENT_SUFFIX}  — recyclage données + keep-alive Supabase (4h30 UTC)"
