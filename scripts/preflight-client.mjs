#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const root = process.cwd()
const workerName = process.argv[2]
const flags = new Set(process.argv.slice(3))
const withOpenNextBuild = flags.has('--with-open-next-build')

const requiredFiles = [
  'package.json',
  'wrangler.jsonc',
  'open-next.config.ts',
  'scripts/run-production-deploy.sh',
  'scripts/deploy-client.sh',
  'scripts/deploy-all-clients.sh',
  'scripts/deploy-edge-functions.sh',
  'supabase/migrations',
]

const requiredWorkerEnv = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_APP_URL',
  'RESEND_API_KEY',
  'RESEND_FROM_ADDRESS',
  'CRON_SECRET',
  'MEMBER_SESSION_SECRET',
  'RATE_LIMIT_SECRET',
]

function readEnvFile(filePath) {
  if (!existsSync(filePath)) return {}
  const env = {}
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const index = trimmed.indexOf('=')
    const key = trimmed.slice(0, index).trim()
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '')
    env[key] = value
  }
  return env
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
const env = {
  ...readEnvFile(path.join(root, '.env.local')),
  ...process.env,
}

console.log('Atelier client preflight')
console.log('========================')

check(Boolean(workerName), 'worker name fourni', 'worker name manquant: npm run preflight:client -- atelier-nom', failures, warnings)
if (workerName) {
  check(/^[a-z0-9][a-z0-9-]{1,62}$/.test(workerName), `worker name valide (${workerName})`, `worker name invalide (${workerName})`, failures, warnings)
}

for (const file of requiredFiles) {
  check(existsSync(path.join(root, file)), `${file} présent`, `${file} introuvable`, failures, warnings)
}

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
check(pkg.scripts?.deploy?.includes('run-production-deploy.sh'), 'script deploy utilise run-production-deploy.sh', 'script deploy inattendu', failures, warnings)
check(pkg.scripts?.preview?.includes('--dangerouslyUseUnsupportedNextVersion'), 'script preview documente le contournement Next 14/OpenNext', 'script preview sans flag OpenNext Next 14', failures, warnings)

const migrations = listMigrations()
const versions = migrations.map((name) => name.slice(0, 3))
const duplicates = versions.filter((version, index) => versions.indexOf(version) !== index)
check(migrations.length > 0, `${migrations.length} migrations détectées`, 'aucune migration détectée', failures, warnings)
check(duplicates.length === 0, 'numéros de migrations uniques', `numéros de migrations dupliqués: ${Array.from(new Set(duplicates)).join(', ')}`, failures, warnings)
console.log(`INFO dernière migration: ${migrations.at(-1) ?? 'n/a'}`)

const deploymentDoc = existsSync(path.join(root, 'DEPLOIEMENT_CLIENT.md'))
  ? readFileSync(path.join(root, 'DEPLOIEMENT_CLIENT.md'), 'utf8')
  : ''
const missingInDoc = migrations.filter((name) => !deploymentDoc.includes(name))
check(missingInDoc.length === 0, 'DEPLOIEMENT_CLIENT.md liste toutes les migrations', `migrations absentes de DEPLOIEMENT_CLIENT.md: ${missingInDoc.join(', ')}`, failures, warnings, true)

for (const key of requiredWorkerEnv) {
  check(Boolean(env[key]), `${key} disponible localement`, `${key} absent localement (à vérifier dans Cloudflare Worker)`, failures, warnings, true)
}

if (withOpenNextBuild) {
  const ok = run('node_modules/.bin/opennextjs-cloudflare', ['build', '--dangerouslyUseUnsupportedNextVersion'])
  check(ok, 'build OpenNext Cloudflare OK', 'build OpenNext Cloudflare en échec', failures, warnings)
} else {
  console.log('INFO build OpenNext ignoré (ajouter --with-open-next-build pour le lancer)')
}

console.log('')
console.log(`Résumé: ${failures.length} erreur(s), ${warnings.length} avertissement(s)`)
if (failures.length > 0) process.exit(1)
