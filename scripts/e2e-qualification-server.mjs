import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isIP } from 'node:net'
import { access } from 'node:fs/promises'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DEFAULT_SINK_URL = 'http://127.0.0.1:43127/v1'
const SINK_BODY_LIMIT = 25 * 1024 * 1024
const buildOnly = process.argv.includes('--build')
const messages = []
let nextMessageId = 1

function isLoopbackHost(rawHost) {
  const host = String(rawHost ?? '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  return host === 'localhost' || host === '::1' || (isIP(host) === 4 && host.startsWith('127.'))
}

function localHttpUrl(name, value) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${name} must be an explicit loopback URL.`)
  }
  if (parsed.protocol !== 'http:' || !isLoopbackHost(parsed.hostname) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${name} must be an explicit loopback HTTP URL without credentials, query, or fragment.`)
  }
  if (!parsed.port || Number(parsed.port) === 0) throw new Error(`${name} must include a nonzero explicit port.`)
  return parsed
}

async function assertNoDotEnvFiles() {
  const candidates = [
    '.env',
    '.env.local',
    '.env.development',
    '.env.development.local',
    '.env.test',
    '.env.test.local',
    '.env.production',
    '.env.production.local',
  ]
  const present = []
  for (const name of candidates) {
    try {
      await access(resolve(projectRoot, name))
      present.push(name)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error('Could not verify that no real dotenv files will be loaded.')
    }
  }
  if (present.length) throw new Error('Refusing to start qualification with dotenv files present.')
}
function required(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required for local E2E qualification.`)
  return value
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(JSON.stringify(body))
}

function collectJson(request) {
  const { promise, resolve, reject } = Promise.withResolvers()
  let settled = false
  const resolveOnce = (value) => {
    if (!settled) {
      settled = true
      resolve(value)
    }
  }
  const rejectOnce = (error) => {
    if (!settled) {
      settled = true
      reject(error)
    }
  }
  let size = 0
  const chunks = []
  request.on('data', (chunk) => {
    size += chunk.length
    if (size > SINK_BODY_LIMIT) {
      rejectOnce(new Error('body too large'))
      request.destroy()
      return
    }
    chunks.push(chunk)
  })
  request.on('end', () => {
    try {
      resolveOnce(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    } catch {
      rejectOnce(new Error('invalid JSON'))
    }
  })
  request.on('error', rejectOnce)
  return promise
}

function isQualificationRecipient(value) {
  return typeof value === 'string' && /^[^@\s]+@[^@\s]+\.test$/i.test(value)
}

const sinkUrl = localHttpUrl('E2E_EMAIL_SINK_URL', process.env.E2E_EMAIL_SINK_URL ?? DEFAULT_SINK_URL)
if (sinkUrl.pathname !== '/v1') throw new Error('E2E_EMAIL_SINK_URL must end with /v1.')
const sinkHost = sinkUrl.hostname.replace(/^\[|\]$/g, '')
const sinkPort = Number(sinkUrl.port)
const sinkOrigin = sinkUrl.origin

const sink = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? '/', sinkOrigin)
  if (requestUrl.pathname === '/__e2e/health' && request.method === 'GET') {
    sendJson(response, 200, { ok: true })
    return
  }
  if (requestUrl.pathname === '/__e2e/messages' && request.method === 'DELETE') {
    messages.length = 0
    nextMessageId = 1
    sendJson(response, 200, { cleared: true })
    return
  }
  if (requestUrl.pathname === '/__e2e/messages' && request.method === 'GET') {
    sendJson(response, 200, { messages })
    return
  }
  if (requestUrl.pathname === '/v1/emails' && request.method === 'POST') {
    let payload
    try {
      payload = await collectJson(request)
    } catch {
      sendJson(response, 400, { message: 'Qualification sink rejected an invalid email payload.' })
      return
    }
    const recipients = Array.isArray(payload?.to) ? payload.to : [payload?.to]
    if (recipients.length === 0 || recipients.some((recipient) => !isQualificationRecipient(recipient))) {
      sendJson(response, 422, { message: 'Qualification sink accepts only .test recipients.' })
      return
    }
    const id = `qualification-${nextMessageId++}-${randomUUID()}`
    messages.push({ id, ...payload })
    sendJson(response, 200, { id })
    return
  }
  sendJson(response, 404, { message: 'Not found.' })
})

function redacted(line) {
  return line
    .replace(/([?&](?:token|signature_token|access_token|refresh_token|state|code|key|password)=)[^&\s"'<>]*/gi, '$1[redacted]')
    .replace(/("(?:signatureImage|client_signature_image)"\s*:\s*")[^"]*/g, '$1[redacted]')
    .replace(/(\/sign\/)[^/?#\s"'<>]+/gi, '$1[redacted]')
    .replace(/(\bBearer\s+)[^\s"'<>]+/gi, '$1[redacted]')
    .replace(/(\b(?:set-cookie|cookie):\s*)[^\r\n]*/gi, '$1[redacted]')
    .replace(/(member_session=)[^;\s"'<>]+/gi, '$1[redacted]')
    .replace(/(set-cookie:\s*[^=;\s]+=)[^;\s"'<>]+/gi, '$1[redacted]')
}

function pipeRedacted(readable, writable) {
  let pending = ''
  readable.setEncoding('utf8')
  readable.on('data', (chunk) => {
    pending += chunk
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ''
    for (const line of lines) writable.write(`${redacted(line)}\n`)
  })
  readable.on('end', () => {
    if (pending) writable.write(redacted(pending))
    pending = ''
  })
}

let app
let stopping = false

function finish(exitCode) {
  if (sink.listening) sink.close(() => process.exit(exitCode))
  else process.exit(exitCode)
}

function stop(signal = 'SIGTERM', exitCode = 0) {
  if (stopping) return
  stopping = true
  if (app?.pid && app.exitCode === null && app.signalCode === null) {
    const forceKill = setTimeout(() => {
      if (app.exitCode === null && app.signalCode === null) app.kill('SIGKILL')
    }, 5000)
    app.once('exit', () => {
      clearTimeout(forceKill)
      finish(exitCode)
    })
    app.kill(signal)
  } else {
    finish(exitCode)
  }
}

process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))

try {
  await assertNoDotEnvFiles()
  const supabaseUrl = localHttpUrl('SUPABASE_URL', required('SUPABASE_URL'))
  const baseUrl = localHttpUrl('E2E_BASE_URL', required('E2E_BASE_URL'))
  if (supabaseUrl.pathname !== '/') {
    throw new Error('SUPABASE_URL must be a local API origin without a path.')
  }
  if (baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash) {
    throw new Error('E2E_BASE_URL must be an origin URL without a path, query, or fragment.')
  }
  const anonKey = required('SUPABASE_ANON_KEY')
  const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY')
  const nextServerMode = process.env.E2E_NEXT_SERVER_MODE || 'dev'
  if (nextServerMode !== 'dev' && nextServerMode !== 'start') {
    throw new Error('E2E_NEXT_SERVER_MODE must be dev or start.')
  }

  const listening = Promise.withResolvers()
  sink.once('error', listening.reject)
  sink.listen(sinkPort, sinkHost, listening.resolve)
  await listening.promise

  const guardPath = resolve(projectRoot, 'scripts/e2e/network-guard.mjs')
  const nextPath = resolve(projectRoot, 'node_modules/next/dist/bin/next')
  const host = baseUrl.hostname.replace(/^\[|\]$/g, '')
  const port = Number(baseUrl.port)
  const nodeOptions = `${buildOnly ? '--max-old-space-size=6144 ' : ''}--import=${JSON.stringify(guardPath)}`
  const env = {}
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'TZ', 'TERM', 'CI']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  Object.assign(env, {
    E2E_QUALIFICATION: '1',
    E2E_BASE_URL: baseUrl.origin,
    E2E_EMAIL_SINK_URL: sinkUrl.toString().replace(/\/$/, ''),
    NEXT_PUBLIC_APP_URL: baseUrl.origin,
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl.origin,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_URL: supabaseUrl.origin,
    SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    MEMBER_SESSION_SECRET: randomBytes(32).toString('base64url'),
    RATE_LIMIT_SECRET: randomBytes(32).toString('base64url'),
    RESEND_API_KEY: 'qualification-only',
    RESEND_FROM_ADDRESS: 'qualification@atelier.test',
    RESEND_FROM_NAME: 'Atelier Qualification',
    RESEND_REPLY_TO_ADDRESS: 'qualification-replies@atelier.test',
    SHARED_EMAIL_DOMAIN: '',
    OPERATOR_MODE: 'app',
    NEXT_TELEMETRY_DISABLED: '1',
    NODE_OPTIONS: nodeOptions,
  })

  const nextArgs = [nextPath, buildOnly ? 'build' : nextServerMode]
  if (buildOnly || nextServerMode === 'dev') nextArgs.push('--webpack')
  if (!buildOnly) nextArgs.push('--hostname', host, '--port', String(port))
  app = spawn(process.execPath, nextArgs, {
    cwd: projectRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  pipeRedacted(app.stdout, process.stdout)
  pipeRedacted(app.stderr, process.stderr)
  app.once('error', () => {
    console.error('Local qualification app could not be started.')
    stop('SIGTERM', 1)
  })
  app.once('exit', (code) => {
    if (stopping) return
    if (!buildOnly) console.error(`Local qualification app exited unexpectedly (code ${code ?? 'unknown'}).`)
    stopping = true
    finish(code ?? 1)
  })
} catch {
  console.error('Local qualification server startup failed; verify explicit loopback URLs, local Supabase keys, and the free test ports.')
  stop('SIGTERM', 1)
}
