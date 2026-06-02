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
      cp "$backup" "$original"
      rm -f "$backup"
    fi
  done
}

trap restore_env_files EXIT INT TERM

for env_file in .env.local .env.production.local; do
  if [[ -f "$env_file" ]]; then
    # Copie dans /tmp ET dans un fichier .bak local — résiste au crash machine
    backup_tmp="$(mktemp "${TMPDIR:-/tmp}/$(basename "$env_file").XXXXXX")"
    backup_local="${env_file}.deploybak"
    cp "$env_file" "$backup_tmp"
    cp "$env_file" "$backup_local"
    mv "$env_file" "$backup_tmp"
    BACKUPS+=("$env_file:$backup_local")
    echo "▶ Déploiement sécurisé : $env_file mis de côté (backup dans $backup_local)"
  fi
done

# Limite RAM à 4 Go pour éviter de planter le Mac Air (ajuster si plus de RAM dispo)
NODE_OPTIONS="--max-old-space-size=4096" node_modules/.bin/opennextjs-cloudflare build
node scripts/patch-worker.mjs
node ./node_modules/wrangler/bin/wrangler.js deploy --keep-vars "$@"

trap - EXIT INT TERM
restore_env_files
