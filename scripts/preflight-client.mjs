#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { parseEnv } from 'node:util'
import path from 'node:path'

const root = process.cwd()
const workerName = process.argv[2]
const flags = new Set(process.argv.slice(3))
const envFileOption = [...flags].find((flag) => flag.startsWith('--env-file='))
const withOpenNextBuild = flags.has('--with-open-next-build')
// Strict par défaut : un secret absent ne doit pas passer en simple WARN.
// `--lenient` existe pour les postes de dev sans secrets de prod.
const strictEnv = !flags.has('--lenient')

const requiredFiles = [
  'package.json',
  'wrangler.jsonc',
  'open-next.config.ts',
  'scripts/run-production-deploy.sh',
  'scripts/deploy-client.sh',
  'scripts/deploy-all-clients.sh',
  'supabase/migrations',
]

const requiredWorkerEnv = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_APP_URL',
  'RESEND_API_KEY',
  'RESEND_FROM_ADDRESS',
  'RESEND_REPLY_TO_ADDRESS',
  'CRON_SECRET',
  'MEMBER_SESSION_SECRET',
  'RATE_LIMIT_SECRET',
  'OPENROUTER_API_KEY',
  'ORGANIZATION_AI_CREDENTIALS_ENCRYPTION_KEY',
  'VAPID_PRIVATE_KEY',
  'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
  'OPERATOR_INGEST_URL',
  'OPERATOR_SOURCE_INSTANCE',
  'OPERATOR_INGEST_SECRET',
]

// Secrets qui doivent être 64 caractères hexadécimaux, distincts entre eux, et
// jamais laissés sur la valeur d'exemple du template.
const HEX_SECRETS = ['CRON_SECRET', 'MEMBER_SESSION_SECRET', 'RATE_LIMIT_SECRET', 'OPERATOR_INGEST_SECRET']
const PLACEHOLDER = /^(TODO|COPIER_DEPUIS|un-secret|change-?moi|xxx)/i

function readEnvFile(filePath) {
  if (!existsSync(filePath)) return {}
  return parseEnv(readFileSync(filePath, 'utf8'))
}

function check(condition, ok, fail, failures, warnings, warning = false) {
  if (condition) {
    console.log(`OK  ${ok}`)
    return
  }
  if (warning) {
    warnings.push(fail)
    console.log(`WARN ${fail}`)
    return
  }
  failures.push(fail)
  console.log(`ERR ${fail}`)
}

function listMigrations() {
  const dir = path.join(root, 'supabase/migrations')
  return readdirSync(dir)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort()
}

function run(command, args) {
  console.log(`RUN ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: root, shell: false })
  return result.status === 0
}

const failures = []
const warnings = []
// Le fichier de l'instance visée porte les vraies valeurs : `.env.local` seul
// ne dit rien du Worker qu'on s'apprête à déployer.
const targetEnvFile = envFileOption?.slice('--env-file='.length)
  || process.env.PREFLIGHT_ENV_FILE
  || (workerName === 'orsayn-cockpit' ? '.env.cockpit' : workerName ? `.env.client-${workerName}` : '')
const env = {
  ...(targetEnvFile && /^[a-z0-9][a-z0-9-]{1,62}$/.test(workerName ?? '')
    ? readEnvFile(path.resolve(root, targetEnvFile))
    : {}),
  ...process.env,
}

console.log('Atelier client preflight')
console.log('========================')
if (strictEnv) console.log('INFO mode strict env actif (défaut): secrets prod manquants = erreur')

check(Boolean(workerName), 'worker name fourni', 'worker name manquant: npm run preflight:client -- atelier-nom', failures, warnings)
if (workerName) {
  check(/^[a-z0-9][a-z0-9-]{1,62}$/.test(workerName), `worker name valide (${workerName})`, `worker name invalide (${workerName})`, failures, warnings)
}

for (const file of requiredFiles) {
  check(existsSync(path.join(root, file)), `${file} présent`, `${file} introuvable`, failures, warnings)
}

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
check(pkg.scripts?.deploy?.includes('run-production-deploy.sh'), 'script deploy utilise run-production-deploy.sh', 'script deploy inattendu', failures, warnings)
check(!pkg.scripts?.preview?.includes('--dangerouslyUseUnsupportedNextVersion'), 'script preview utilise une combinaison Next/OpenNext supportée', 'script preview contient encore --dangerouslyUseUnsupportedNextVersion', failures, warnings)

const migrations = listMigrations()
// Les migrations horodatées (`20260901200036_...`) ont un préfixe de 14
// chiffres : comparer les 3 premiers caractères les faisait toutes entrer en
// collision avec les migrations numérotées 202xxx.
const versions = migrations.map((name) => {
  const stamp = /^(\d{14})_/.exec(name)
  return stamp ? stamp[1] : name.slice(0, 3)
})
const duplicates = versions.filter((version, index) => versions.indexOf(version) !== index)
check(migrations.length > 0, `${migrations.length} migrations détectées`, 'aucune migration détectée', failures, warnings)
check(duplicates.length === 0, 'numéros de migrations uniques', `numéros de migrations dupliqués: ${Array.from(new Set(duplicates)).join(', ')}`, failures, warnings)
console.log(`INFO dernière migration: ${migrations.at(-1) ?? 'n/a'}`)

const deploymentDoc = existsSync(path.join(root, 'DEPLOIEMENT_CLIENT.md'))
  ? readFileSync(path.join(root, 'DEPLOIEMENT_CLIENT.md'), 'utf8')
  : ''
const missingInDoc = migrations.filter((name) => !deploymentDoc.includes(name))
check(missingInDoc.length === 0, 'DEPLOIEMENT_CLIENT.md liste toutes les migrations', `migrations absentes de DEPLOIEMENT_CLIENT.md: ${missingInDoc.join(', ')}`, failures, warnings, true)

const appOnlyRequiredEnv = new Set([
  'MEMBER_SESSION_SECRET',
  'ORGANIZATION_AI_CREDENTIALS_ENCRYPTION_KEY',
  'VAPID_PRIVATE_KEY',
  'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
])
const requiredForTarget = env.OPERATOR_MODE === 'true'
  ? requiredWorkerEnv.filter((key) => !key.startsWith('OPERATOR_') && !appOnlyRequiredEnv.has(key))
  : requiredWorkerEnv
for (const key of requiredForTarget) {
  check(Boolean(env[key]) && !PLACEHOLDER.test(env[key]), `${key} disponible localement`, `${key} absent ou placeholder pour le Worker visé`, failures, warnings, !strictEnv)
}

if (env.OPERATOR_MODE === 'true') {
  for (const key of ['STRIPE_SECRET_KEY', 'STRIPE_PRICE_PRO', 'STRIPE_PRICE_EXPERT']) {
    check(Boolean(env[key]), `${key} disponible pour le Stripe cockpit`, `${key} absent: flux Stripe incomplet dans le cockpit`, failures, warnings, !strictEnv)
  }
}

if (env.OPERATOR_MODE === 'true') {
  for (const key of ['OPERATOR_MASTER_SECRET', 'OPERATOR_SUPABASE_URL', 'OPERATOR_SUPABASE_SERVICE_ROLE_KEY']) {
    check(Boolean(env[key]) && !PLACEHOLDER.test(env[key]), `${key} disponible pour le cockpit`, `${key} absent pour le cockpit`, failures, warnings, !strictEnv)
  }
  check(/^[0-9a-f]{64}$/i.test(env.OPERATOR_MASTER_SECRET ?? ''), 'OPERATOR_MASTER_SECRET a la forme attendue', 'OPERATOR_MASTER_SECRET doit être un secret de 64 hex', failures, warnings, !strictEnv)
}

for (const key of HEX_SECRETS) {
  const value = env[key]
  if (!value) continue
  check(
    /^[0-9a-f]{64}$/i.test(value) && !PLACEHOLDER.test(value),
    `${key} a la forme attendue (64 hex)`,
    `${key} n'est pas un secret de 64 hex (valeur d'exemple laissée ? openssl rand -hex 32)`,
    failures,
    warnings,
    !strictEnv,
  )
}

if (env.ORGANIZATION_AI_CREDENTIALS_ENCRYPTION_KEY) {
  let validEncryptionKey = false
  try {
    // Même format que crypto/secrets.ts : AES-256, 32 octets encodés en base64.
    validEncryptionKey = atob(env.ORGANIZATION_AI_CREDENTIALS_ENCRYPTION_KEY).length === 32
  } catch {
    validEncryptionKey = false
  }
  check(validEncryptionKey, 'clé AES-256 base64 valide', 'ORGANIZATION_AI_CREDENTIALS_ENCRYPTION_KEY doit décoder 32 octets base64 (openssl rand -base64 32)', failures, warnings, !strictEnv)
}

const distinctSecrets = ['RATE_LIMIT_SECRET', 'CRON_SECRET', 'MEMBER_SESSION_SECRET', 'OPERATOR_INGEST_SECRET', 'ORGANIZATION_AI_CREDENTIALS_ENCRYPTION_KEY', 'OPERATOR_MASTER_SECRET', 'SUPABASE_SERVICE_ROLE_KEY']
const seenSecrets = new Map()
for (const key of distinctSecrets) {
  const value = env[key]
  if (!value) continue
  if (seenSecrets.has(value)) {
    check(false, `${key} distinct`, `${key} réutilise la même valeur que ${seenSecrets.get(value)}`, failures, warnings, !strictEnv)
  } else {
    check(true, `${key} distinct`, '', failures, warnings)
    seenSecrets.set(value, key)
  }
}

if (env.OPERATOR_INGEST_URL) {
  check(
    /^https:\/\//.test(env.OPERATOR_INGEST_URL),
    'OPERATOR_INGEST_URL en https',
    'OPERATOR_INGEST_URL doit être une URL https',
    failures,
    warnings,
    !strictEnv,
  )
}

if (withOpenNextBuild) {
  const ok = run('node_modules/.bin/opennextjs-cloudflare', ['build'])
  check(ok, 'build OpenNext Cloudflare OK', 'build OpenNext Cloudflare en échec', failures, warnings)
} else {
  console.log('INFO build OpenNext ignoré (ajouter --with-open-next-build pour le lancer)')
}

console.log('')
console.log(`Résumé: ${failures.length} erreur(s), ${warnings.length} avertissement(s)`)
if (failures.length > 0) process.exit(1)
