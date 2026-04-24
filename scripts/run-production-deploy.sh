#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

BACKUPS=()

restore_env_files() {
  for entry in "${BACKUPS[@]:-}"; do
    local original="${entry%%:*}"
    local backup="${entry#*:}"

    if [[ -f "$backup" ]]; then
      mv "$backup" "$original"
    fi
  done
}

trap restore_env_files EXIT

for env_file in .env.local .env.production.local; do
  if [[ -f "$env_file" ]]; then
    backup_file="$(mktemp "${TMPDIR:-/tmp}/$(basename "$env_file").XXXXXX")"
    mv "$env_file" "$backup_file"
    BACKUPS+=("$env_file:$backup_file")
    echo "▶ Déploiement sécurisé : $env_file temporairement ignoré"
  fi
done

node_modules/.bin/opennextjs-cloudflare build --dangerouslyUseUnsupportedNextVersion
node scripts/patch-worker.mjs
node ./node_modules/wrangler/bin/wrangler.js deploy --keep-vars "$@"

trap - EXIT
restore_env_files
