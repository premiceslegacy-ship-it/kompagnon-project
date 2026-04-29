#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const workerName = process.argv[2]
const args = new Set(process.argv.slice(3))
const applySecrets = args.has('--apply-secrets')
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
  'SHARED_WABA_ACCESS_TOKEN',
  'OPERATOR_INGEST_SECRET',
]

const textKeys = [
  'SUPABASE_URL',
  'NEXT_PUBLIC_APP_URL',
  'RESEND_FROM_ADDRESS',
  'RESEND_FROM_NAME',
  'NEXT_PUBLIC_SHARED_WABA_DISPLAY_NUMBER',
  'SHARED_WABA_PHONE_NUMBER_ID',
  'OPERATOR_MODE',
  'OPERATOR_INGEST_URL',
  'OPERATOR_SOURCE_INSTANCE',
  'OPERATOR_ALLOWED_EMAILS',
  'OPERATOR_SUPABASE_URL',
  'OPERATOR_USD_TO_EUR_RATE',
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

if (!workerName || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(workerName)) {
  console.error('Usage: npm run cf:env -- <worker-name> [--env-file=.env.client] [--apply-secrets]')
  process.exit(1)
}

const env = {
  ...readEnvFile(path.resolve(process.cwd(), envFile)),
  ...process.env,
}

console.log(`Cloudflare env preparation for ${workerName}`)
console.log(applySecrets ? 'Mode: apply secrets via wrangler' : 'Mode: dry-run')
console.log('')

const missingSecrets = secretKeys.filter((key) => !env[key])
const missingText = textKeys.filter((key) => !env[key])

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
console.log('Text variables to set in Cloudflare dashboard or API automation:')
for (const key of textKeys) {
  if (!env[key]) {
    console.log(`  MISSING ${key}`)
  } else {
    console.log(`  ${key}=${env[key]}`)
  }
}

if (missingSecrets.length || missingText.length) {
  console.log('')
  console.log(`Missing: ${missingSecrets.length} secret(s), ${missingText.length} text variable(s)`)
}
