#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"
if [[ "$#" -ne 0 ]]; then
  echo "Production deploy accepts no Wrangler overrides; use the named deploy wrapper." >&2
  exit 1
fi

configured_worker="$(node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const name = readFileSync("wrangler.jsonc", "utf8").match(/^\s*"name"\s*:\s*"([^"]+)"/m)?.[1];
  if (!name) process.exit(1);
  process.stdout.write(name);
' 2>/dev/null)" || {
  echo "Could not resolve the configured deploy target." >&2
  exit 1
}
worker_hint="${WORKER_NAME:-${CLOUDFLARE_WORKER_NAME:-$configured_worker}}"
if [[ ! "$worker_hint" =~ ^[a-z0-9][a-z0-9-]{1,62}$ || "$worker_hint" != "$configured_worker" ]]; then
  echo "Deploy target does not match the configured Worker." >&2
  exit 1
fi
if [[ -n "${WORKER_NAME:-}" && -n "${CLOUDFLARE_WORKER_NAME:-}" && "$WORKER_NAME" != "$CLOUDFLARE_WORKER_NAME" ]]; then
  echo "Conflicting deploy target settings." >&2
  exit 1
fi
expected_env_file=".env.client-${worker_hint}"
if [[ "$worker_hint" == "orsayn-cockpit" ]]; then
  expected_env_file=".env.cockpit"
fi
if [[ -n "${PREFLIGHT_ENV_FILE:-}" && "$PREFLIGHT_ENV_FILE" != "$expected_env_file" ]]; then
  echo "Preflight environment does not match the configured Worker." >&2
  exit 1
fi

BACKUPS=()
TEMP_BACKUPS=()

restore_env_files() {
  for entry in "${BACKUPS[@]:-}"; do
    local original="${entry%%:*}"
    local backup="${entry#*:}"

    if [[ -f "$backup" ]]; then
      cp "$backup" "$original"
      rm -f "$backup"
    fi
  done
  for backup in "${TEMP_BACKUPS[@]:-}"; do
    if [[ -n "$backup" && -f "$backup" ]]; then
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
    cp "$env_file" "$backup_local"
    mv "$env_file" "$backup_tmp"
    BACKUPS+=("$env_file:$backup_local")
    TEMP_BACKUPS+=("$backup_tmp")
    echo "▶ Déploiement sécurisé : $env_file mis de côté (backup dans $backup_local)"
  fi
done

# Garde-fou avant tout build : secrets manquants, placeholders, incohérences.
# Le préflight n'était appelé que par `npm run check`, jamais par le déploiement.
node scripts/preflight-client.mjs "$worker_hint" --strict-env
if [[ "$worker_hint" == "orsayn-cockpit" ]]; then
  # Read-only schema gate for the operator database, before cockpit build/deploy.
  node scripts/operator-schema-check.mjs
else
  # Read-only target-schema gate; the CLI loads only the canonical private client file.
  node scripts/quote-attachment-cutover.mjs "$worker_hint" --check
fi

# Une compilation seule ne prouve pas les permissions ni les transitions.
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=6144}" npm run typecheck
npm run lint
npm test
npm audit --omit=dev --audit-level=high

# Même limite que le build qualifié ; surcharge explicite possible selon le runner.
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=6144}" node_modules/.bin/opennextjs-cloudflare build
node ./node_modules/wrangler/bin/wrangler.js deploy --keep-vars --config "$ROOT_DIR/wrangler.jsonc" --name "$worker_hint"

trap - EXIT INT TERM
restore_env_files
