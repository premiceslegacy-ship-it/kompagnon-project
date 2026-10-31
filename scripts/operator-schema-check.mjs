#!/usr/bin/env node
import { lstatSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

function fail(message) {
  throw new Error(message)
}

function readCockpitConfig() {
  const envPath = resolve(ROOT, '.env.cockpit')
  let stat
  try {
    stat = lstatSync(envPath)
  } catch {
    fail('Canonical .env.cockpit is missing.')
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail('Canonical .env.cockpit must be a regular private file, not a symlink.')

  let env
  try {
    env = parseEnv(readFileSync(envPath, 'utf8'))
  } catch {
    fail('Canonical .env.cockpit could not be parsed.')
  }
  if (env.OPERATOR_MODE !== 'true') fail('Canonical .env.cockpit must enable OPERATOR_MODE=true.')
  const rawUrl = env.OPERATOR_SUPABASE_URL
  const serviceKey = env.OPERATOR_SUPABASE_SERVICE_ROLE_KEY
  if (!rawUrl || !serviceKey || /^(?:todo|replace|placeholder)/i.test(serviceKey)) {
    fail('Canonical .env.cockpit must define OPERATOR_SUPABASE_URL and OPERATOR_SUPABASE_SERVICE_ROLE_KEY.')
  }

  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    fail('OPERATOR_SUPABASE_URL is not a valid project URL.')
  }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash
    || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    fail('OPERATOR_SUPABASE_URL must be a bare HTTP(S) project origin without credentials, path, query, or fragment.')
  }
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
    fail('Non-local operator Supabase targets must use HTTPS.')
  }
  return { origin: parsed.origin, serviceKey }
}

function makeClient(config) {
  return createClient(config.origin, config.serviceKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: {
      fetch: (input, init) => {
        const timeout = AbortSignal.timeout(10_000)
        const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
        return fetch(input, { ...init, signal })
      },
    },
  })
}

async function main(argv) {
  if (argv.length !== 0) fail('Usage: node scripts/operator-schema-check.mjs (reads only .env.cockpit).')
  const client = makeClient(readCockpitConfig())
  for (const [label, rpc] of [
    ['refresh schema', 'assert_super_pdp_refresh_schema'],
    ['operator table security', 'assert_operator_table_security'],
    ['setup billing', 'assert_setup_billing_schema'],
  ]) {
    const { data, error } = await client.rpc(rpc)
    if (error) {
      const code = typeof error.code === 'string' ? error.code : 'unknown'
      fail(`Operator ${label} assertion unavailable or rejected (PostgREST code ${code}).`)
    }
    const result = Array.isArray(data) ? data[0] : data
    const gate = result && typeof result === 'object' ? result : null
    if (!gate || gate.ok !== true) {
      const failures = Array.isArray(gate?.failures)
        ? gate.failures.filter(value => typeof value === 'string')
        : []
      fail(`Operator ${label} gate refused deployment${failures.length ? `: ${failures.join(', ')}` : '.'}`)
    }
  }
  console.log('Operator schema gate passed: refresh claims, submission ledger, composite keys, role restrictions, operator table security, and setup billing are present.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Operator schema gate refused deployment: ${error instanceof Error ? error.message : 'unexpected failure; sensitive details suppressed.'}`)
    process.exitCode = 1
  })
}
