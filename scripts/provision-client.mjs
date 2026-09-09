#!/usr/bin/env node
// scripts/provision-client.mjs — Couche B du provisioning (voir docs/souverainete-donnees/)
//
// ATTENTION : ce script CRÉE RÉELLEMENT un projet Supabase via l'API
// Management (facturable au-delà du quota Free du compte utilisé, voir
// docs/souverainete-donnees/02-contraintes-supabase.md). Jamais exécuté
// automatiquement par un cron ou une CI — toujours à la demande, par un
// humain qui vient de vendre un setup ou de valider un signup self-service.
//
// Usage :
//   SUPABASE_MANAGEMENT_TOKEN=sbp_xxx node scripts/provision-client.mjs \
//     --worker-name atelier-weber \
//     --org-id <id-organisation-supabase> \
//     --tier pro \
//     [--region eu-west-1] \
//     [--resume <project-ref> --db-password '<mot-de-passe-du-projet>']
//
// --resume reprend un projet déjà créé (après un échec avant l'étape 5,
// par exemple) sans en recréer un nouveau. Le mot de passe DB généré à la
// création ne survit qu'en mémoire du process qui l'a créé : --db-password
// est alors obligatoire (le réinitialiser via le dashboard Supabase >
// Database Settings si nécessaire).
//
// SUPABASE_MANAGEMENT_TOKEN : un Personal Access Token Supabase
// (https://supabase.com/dashboard/account/tokens), PAS une clé de projet.
// Ne va JAMAIS dans un .env.client-* — il sert uniquement au provisioning,
// côté opérateur (cohérent avec la séparation déjà en place pour
// OPERATOR_INGEST_SECRET, voir src/lib/operator.ts).
//
// Séquence :
//   1. Création du projet Supabase (POST /v1/projects) — ou reprise d'un
//      projet existant si --resume <ref> est fourni (idempotence : ne
//      recrée jamais un projet après un échec en cours de route).
//   2. Attente de disponibilité (polling GET /v1/projects/:ref).
//   3. Récupération de l'URL et des clés API (GET /v1/projects/:ref/api-keys).
//   4. Application du schéma via scripts/apply-schema.mjs (couche A) —
//      c'est le seul endroit où cette couche est spécifique à Supabase
//      cloud ; apply-schema.mjs lui-même reste portable.
//   5. Génération de .env.client-<worker-name> depuis le template du tier.
//   6. Rappelle qu'il reste à lancer scripts/deploy-client.sh <worker-name>
//      pour le déploiement Cloudflare (volontairement NON enchaîné
//      automatiquement : deploy-client.sh est interactif et pose des
//      questions sur la clé OpenRouter client, la facturation électronique,
//      etc. qui ne se déduisent pas du tier seul).
//
// Champs exacts de l'API Management (POST /v1/projects, GET .../api-keys)
// À VÉRIFIER à la première exécution réelle (jamais exécuté par cet outil
// contre l'API réelle — voir docs/souverainete-donnees/04-runbook-bascule.md
// pour le statut de ce script : écrit et non testé en conditions réelles) :
// la doc publique ne détaille pas les schémas complets, ce script part de
// la forme documentée (https://api.supabase.com/api/v1-json) et devra être
// ajusté si l'API renvoie une forme différente au premier run.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const root = process.cwd()
const args = process.argv.slice(2)

function getFlag(name) {
  const idx = args.indexOf(`--${name}`)
  return idx === -1 ? null : args[idx + 1] ?? null
}

const MANAGEMENT_API = 'https://api.supabase.com/v1'
const token = process.env.SUPABASE_MANAGEMENT_TOKEN
const workerName = getFlag('worker-name')
const orgId = getFlag('org-id')
const tier = getFlag('tier') // setup-only | starter | pro | expert
const region = getFlag('region') ?? 'eu-west-1'
const resumeRef = getFlag('resume')

const VALID_TIERS = new Set(['setup-only', 'starter', 'pro', 'expert'])

function fail(message) {
  console.error(`[provision-client] ${message}`)
  process.exit(1)
}

if (!token) fail('SUPABASE_MANAGEMENT_TOKEN manquant (Personal Access Token, jamais une clé de projet).')
if (!workerName || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(workerName)) fail('--worker-name invalide (minuscules, chiffres, tirets — même contrainte que deploy-client.sh).')
if (!orgId) fail('--org-id manquant. Lister vos organisations : GET /v1/organizations sur ' + MANAGEMENT_API)
if (!tier || !VALID_TIERS.has(tier)) fail(`--tier invalide, attendu l'un de : ${[...VALID_TIERS].join(', ')}`)

const envFile = path.join(root, `.env.client-${workerName}`)
if (existsSync(envFile)) fail(`${envFile} existe déjà — supprimer ou choisir un autre --worker-name avant de relancer.`)

const templateFile = path.join(root, `.env.client-template-${tier}`)
if (!existsSync(templateFile)) fail(`Template introuvable : ${templateFile}`)

async function api(method, urlPath, body) {
  const res = await fetch(`${MANAGEMENT_API}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text } }
  if (!res.ok) {
    throw new Error(`${method} ${urlPath} -> ${res.status}: ${JSON.stringify(json)}`)
  }
  return json
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForProjectReady(ref, { timeoutMs = 5 * 60 * 1000, intervalMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const project = await api('GET', `/projects/${ref}`)
    console.log(`  statut : ${project.status ?? 'inconnu'}`)
    if (project.status === 'ACTIVE_HEALTHY') return project
    if (project.status && /FAILED|REMOVED/.test(project.status)) {
      throw new Error(`Le projet est passé en statut ${project.status} — provisioning à reprendre à la main, ne pas relancer ce script avec le même --resume.`)
    }
    await sleep(intervalMs)
  }
  throw new Error(`Timeout : le projet n'est pas ACTIVE_HEALTHY après ${timeoutMs / 1000}s. Relancer avec --resume ${ref} plus tard plutôt que d'en recréer un.`)
}

async function main() {
  console.log('=== Couche B — provisioning Supabase cloud ===')
  console.log(`Worker  : ${workerName}`)
  console.log(`Tier    : ${tier}`)
  console.log(`Région  : ${region}`)
  console.log('')

  let projectRef = resumeRef
  // Le mot de passe DB ne survit qu'en mémoire du process, jamais dans un
  // log ni un fichier : nécessaire à l'étape 4 (couche A a besoin d'une
  // connexion Postgres directe). En cas de --resume après échec avant
  // l'étape 4, ce mot de passe n'est plus connu de ce script — il faut
  // alors le réinitialiser depuis le dashboard Supabase (Database Settings
  // > Reset database password) et le fournir via --db-password.
  let dbPassword = getFlag('db-password')

  if (!projectRef) {
    console.log('1. Création du projet Supabase...')
    dbPassword = dbPassword ?? crypto.randomBytes(24).toString('base64url')
    const project = await api('POST', '/projects', {
      name: workerName,
      organization_id: orgId,
      region,
      db_pass: dbPassword,
    })
    projectRef = project.id ?? project.ref
    if (!projectRef) throw new Error(`Réponse de création inattendue, pas de ref/id trouvé : ${JSON.stringify(project)}`)
    console.log(`  créé : ${projectRef} (mot de passe DB généré, non affiché)`)
  } else {
    console.log(`1. Reprise du projet existant ${projectRef} (--resume)...`)
    if (!dbPassword) {
      fail(`--resume nécessite --db-password (mot de passe DB inconnu de ce process) : réinitialiser le mot de passe via le dashboard Supabase > Database Settings si nécessaire.`)
    }
  }

  console.log('\n2. Attente de disponibilité du projet...')
  await waitForProjectReady(projectRef)

  console.log('\n3. Récupération de l\'URL et des clés API...')
  const projectUrl = `https://${projectRef}.supabase.co`
  const keys = await api('GET', `/projects/${projectRef}/api-keys?reveal=true`)
  const keysArray = Array.isArray(keys) ? keys : keys.keys ?? []
  const anonKey = keysArray.find(k => k.name === 'anon' || k.type === 'anon')?.api_key
  const serviceRoleKey = keysArray.find(k => k.name === 'service_role' || k.type === 'service_role')?.api_key

  if (!anonKey || !serviceRoleKey) {
    throw new Error(
      'Clés anon/service_role introuvables dans la réponse api-keys — la forme exacte de l\'API '
      + 'n\'a peut-être pas été vérifiée depuis la rédaction de ce script (voir le commentaire en tête '
      + 'de fichier). Réponse brute : ' + JSON.stringify(keys),
    )
  }
  console.log('  URL et clés récupérées.')

  console.log('\n4. Application du schéma (couche A)...')
  const dbUrl = `postgresql://postgres:${encodeURIComponent(dbPassword)}@db.${projectRef}.supabase.co:5432/postgres`
  const applySchema = spawnSync('node', [path.join(root, 'scripts', 'apply-schema.mjs'), '--db-url', dbUrl], {
    cwd: root,
    stdio: 'inherit',
  })
  if (applySchema.status !== 0) {
    throw new Error(
      `Échec de apply-schema.mjs (code ${applySchema.status}). Le projet ${projectRef} reste actif : `
      + `corriger le problème puis relancer avec --resume ${projectRef} --db-password '<le même mot de passe>' `
      + 'plutôt que de recréer un projet.',
    )
  }

  console.log('\n5. Génération du fichier .env.client...')
  const template = readFileSync(templateFile, 'utf8')
  const envContent = template
    .replace(/SUPABASE_URL="[^"]*"/, `SUPABASE_URL="${projectUrl}"`)
    .replace(/SUPABASE_ANON_KEY="[^"]*"/, `SUPABASE_ANON_KEY="${anonKey}"`)
    .replace(/SUPABASE_SERVICE_ROLE_KEY="[^"]*"/, `SUPABASE_SERVICE_ROLE_KEY="${serviceRoleKey}"`)
  writeFileSync(envFile, envContent)
  console.log(`  écrit : ${envFile}`)

  console.log('\n=== Terminé ===')
  console.log(`Projet Supabase : ${projectRef} (${projectUrl})`)
  console.log(`Fichier env     : ${envFile}`)
  console.log('')
  console.log('Reste à faire (volontairement pas enchaîné automatiquement, deploy-client.sh est interactif) :')
  console.log(`  ./scripts/deploy-client.sh ${workerName}`)
}

main().catch(err => {
  console.error(`\n[provision-client] ${err.message}`)
  console.error('Le projet Supabase (si déjà créé) reste actif — relancer avec --resume <ref> plutôt que de recréer.')
  process.exit(1)
})
