#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const workerName = process.argv[2]
const args = new Set(process.argv.slice(3))
const applySecrets = args.has('--apply-secrets') || args.has('--apply-all')
const applyAll = args.has('--apply-all')
const envFileFlag = process.argv.find((arg) => arg.startsWith('--env-file='))
const envFile = envFileFlag ? envFileFlag.split('=')[1] : '.env.local'

const secretKeys = [
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'RESEND_API_KEY',
  'OPENROUTER_API_KEY',
  'MISTRAL_API_KEY',
  'CRON_SECRET',
  'MEMBER_SESSION_SECRET',
  'RATE_LIMIT_SECRET',
  'VAPID_PRIVATE_KEY',
  'SHARED_WABA_ACCESS_TOKEN',
  'OPERATOR_INGEST_SECRET',
  'OPERATOR_CONFIG_SYNC_SECRET',
  'OPERATOR_SUPABASE_SERVICE_ROLE_KEY',
  'B2BROUTER_API_KEY',
  'B2BROUTER_WEBHOOK_SECRET',
]

const textKeys = [
  'SUPABASE_URL',
  'NEXT_PUBLIC_APP_URL',
  'RESEND_FROM_ADDRESS',
  'RESEND_FROM_NAME',
  'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
  'NEXT_PUBLIC_SHARED_WABA_DISPLAY_NUMBER',
  'SHARED_WABA_PHONE_NUMBER_ID',
  'OPERATOR_MODE',
  'OPERATOR_INGEST_URL',
  'OPERATOR_SOURCE_INSTANCE',
  'OPERATOR_ALLOWED_EMAILS',
  'OPERATOR_SUPABASE_URL',
  'OPERATOR_USD_TO_EUR_RATE',
  'B2BROUTER_ENV',
  'B2BROUTER_API_VERSION',
  'B2BROUTER_ACCOUNT_ID',
  'AI_RATE_LIMIT_PER_HOUR',
  'PUBLIC_FORM_RATE_LIMIT_PER_HOUR',
  'NEXT_PUBLIC_LEGAL_PUBLISHER_NAME',
  'NEXT_PUBLIC_LEGAL_COMPANY_NAME',
  'NEXT_PUBLIC_LEGAL_ADDRESS',
  'NEXT_PUBLIC_LEGAL_PHONE',
  'NEXT_PUBLIC_LEGAL_REGISTRATION',
  'NEXT_PUBLIC_LEGAL_VAT_NUMBER',
  'NEXT_PUBLIC_LEGAL_PUBLICATION_DIRECTOR',
  'NEXT_PUBLIC_LEGAL_HOSTING_PROVIDER',
  'NEXT_PUBLIC_LEGAL_HOSTING_WEBSITE',
  'NEXT_PUBLIC_SUPPORT_EMAIL',
  'NEXT_PUBLIC_PRIVACY_EMAIL',
  'NEXT_PUBLIC_LEGAL_EMAIL',
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

function putSecret(key, value) {
  const result = spawnSync(
    'node',
    ['./node_modules/wrangler/bin/wrangler.js', 'secret', 'put', key, '--name', workerName],
    { input: value, stdio: ['pipe', 'inherit', 'inherit'] },
  )
  return result.status === 0
}

async function deleteTextBindingsViaApi(keys, accountId, apiToken) {
  // Récupère les bindings existants et supprime ceux qui sont dans la liste
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/settings`,
    { headers: { Authorization: `Bearer ${apiToken}` } }
  )
  const json = await res.json()
  if (!json.success) return

  const existing = (json.result?.bindings ?? [])
    .filter((b) => b.type === 'plain_text' && keys.includes(b.name))
    .map((b) => b.name)

  if (existing.length === 0) return

  // Envoie un PATCH avec ces bindings supprimés (type: "inherit" = suppression)
  const bindings = existing.map((name) => ({ type: 'plain_text', name, text: '' }))
  // Cloudflare supprime un plain_text binding en le réécrivant avec text vide puis en l'omettant
  // La vraie suppression se fait en envoyant le settings sans ce binding — on envoie donc
  // tous les bindings existants SAUF ceux à supprimer
  const keep = (json.result?.bindings ?? []).filter(
    (b) => !(b.type === 'plain_text' && keys.includes(b.name))
  )
  const form = new FormData()
  form.append('settings', JSON.stringify({ bindings: keep }))
  await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/settings`,
    { method: 'PATCH', headers: { Authorization: `Bearer ${apiToken}` }, body: form }
  )
  for (const name of existing) console.log(`  CLEANUP variable texte conflictuelle : ${name}`)
}

async function putTextVarsViaApi(vars, accountId, apiToken) {
  // Cloudflare API : PATCH /accounts/{id}/workers/scripts/{name}/settings
  // Attend multipart/form-data avec un champ "settings" JSON
  const bindings = Object.entries(vars).map(([name, text]) => ({
    type: 'plain_text',
    name,
    text,
  }))

  const form = new FormData()
  form.append('settings', JSON.stringify({ bindings }))

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/settings`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${apiToken}`,
      },
      body: form,
    }
  )

  const json = await res.json()
  if (!json.success) {
    console.error('  Cloudflare API error:', JSON.stringify(json.errors))
    return false
  }
  return true
}

if (!workerName || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(workerName)) {
  console.error('Usage: npm run cf:env -- <worker-name> [--env-file=.env.client] [--apply-secrets] [--apply-all]')
  process.exit(1)
}

// Toujours merger .env.local en base (contient CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN
// et les clés partagées Orsayn), puis écraser avec le fichier client/cockpit spécifique.
const envLocal = readEnvFile(path.resolve(process.cwd(), '.env.local'))
const envClient = envFile !== '.env.local' ? readEnvFile(path.resolve(process.cwd(), envFile)) : {}

const env = {
  ...process.env,
  ...envLocal,
  ...envClient,
}

console.log(`Cloudflare env preparation for ${workerName}`)
if (applyAll) console.log('Mode: apply ALL (secrets via wrangler + text vars via API)')
else if (applySecrets) console.log('Mode: apply secrets via wrangler (dry-run for text vars)')
else console.log('Mode: dry-run')
console.log('')

const missingSecrets = secretKeys.filter((key) => !env[key])
const missingText = textKeys.filter((key) => !env[key])

// ── Nettoyage des variables texte conflictuelles avec les secrets ──────────────
if (applySecrets) {
  const accountId = env['CLOUDFLARE_ACCOUNT_ID']
  const apiToken = env['CLOUDFLARE_API_TOKEN']
  if (accountId && apiToken) {
    await deleteTextBindingsViaApi(secretKeys, accountId, apiToken)
  }
}

// ── Secrets ────────────────────────────────────────────────────────────────────
console.log('Secrets:')
for (const key of secretKeys) {
  if (!env[key]) {
    console.log(`  MISSING ${key}`)
    continue
  }
  if (applySecrets) {
    const ok = putSecret(key, env[key])
    console.log(`  ${ok ? 'OK' : 'ERR'} ${key}`)
    if (!ok) process.exitCode = 1
  } else {
    console.log(`  DRY ${key}`)
  }
}

console.log('')

// ── Variables texte ────────────────────────────────────────────────────────────
console.log('Text variables:')

if (applyAll) {
  const accountId = env['CLOUDFLARE_ACCOUNT_ID']
  const apiToken = env['CLOUDFLARE_API_TOKEN']

  if (!accountId || !apiToken) {
    console.error('  CLOUDFLARE_ACCOUNT_ID et CLOUDFLARE_API_TOKEN sont requis pour --apply-all')
    console.error('  Ajoute-les dans ton .env.local (jamais dans un .env.client-xxx)')
    process.exitCode = 1
  } else {
    const varsToApply = {}
    for (const key of textKeys) {
      if (env[key]) varsToApply[key] = env[key]
      else console.log(`  SKIP (absent) ${key}`)
    }

    if (Object.keys(varsToApply).length > 0) {
      console.log(`  Envoi de ${Object.keys(varsToApply).length} variable(s) texte via API Cloudflare...`)
      const ok = await putTextVarsViaApi(varsToApply, accountId, apiToken)
      if (ok) {
        for (const key of Object.keys(varsToApply)) console.log(`  OK ${key}`)
      } else {
        process.exitCode = 1
      }
    }
  }
} else {
  for (const key of textKeys) {
    if (!env[key]) console.log(`  MISSING ${key}`)
    else console.log(`  ${key}=${env[key]}`)
  }
  if (!applySecrets) {
    console.log('')
    console.log('  → Pour tout appliquer d\'un coup : --apply-all (nécessite CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN dans .env.local)')
  }
}

if (missingSecrets.length || missingText.length) {
  console.log('')
  console.log(`Missing: ${missingSecrets.length} secret(s), ${missingText.length} text variable(s)`)
}
