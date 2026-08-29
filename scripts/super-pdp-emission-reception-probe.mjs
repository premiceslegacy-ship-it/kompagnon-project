#!/usr/bin/env node
// Script de validation sandbox Super PDP — émission et réception de factures (Phase 2/3).
// Rejoue le flux authorization_code (comme le probe OAuth qui avait validé la Phase 1 le
// 25/08/2026), puis enchaîne les appels d'émission/réception réels pour trancher les
// inconnues du §15 de docs/atelier-facturation-electronique.md avant d'écrire le code
// de production (src/lib/super-pdp/client.ts).
//
// Usage :
//   SUPER_PDP_API_ENDPOINT=... SUPER_PDP_CLIENT_ID=... SUPER_PDP_CLIENT_SECRET=... \
//   SUPER_PDP_REDIRECT_URL=https://localhost:8082/callback \
//   node scripts/super-pdp-emission-reception-probe.mjs
// Puis ouvrir https://localhost:8082/connect dans un navigateur.
// Ajouter l'URL de redirection ci-dessus dans la console Super PDP (app sandbox) au
// préalable — port distinct du probe OAuth original (8081) pour pouvoir tourner en //
// parallèle si besoin.
//
// Jetable — ne fait aucun appel de production, ne touche à aucune DB. Aucun secret en dur :
// tout est lu depuis l'environnement.

import https from 'node:https'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const config = {
  endpoint: process.env.SUPER_PDP_API_ENDPOINT || 'https://api.superpdp.tech',
  clientId: process.env.SUPER_PDP_CLIENT_ID,
  clientSecret: process.env.SUPER_PDP_CLIENT_SECRET,
  redirectUri: process.env.SUPER_PDP_REDIRECT_URL || 'https://localhost:8082/callback',
  port: 8082,
}

if (!config.clientId || !config.clientSecret) {
  console.error('SUPER_PDP_CLIENT_ID / SUPER_PDP_CLIENT_SECRET manquants (variables env).')
  process.exit(1)
}

// Génère un certificat auto-signé jetable dans un dossier temporaire hors repo.
const certDir = mkdtempSync(path.join(tmpdir(), 'super-pdp-probe-'))
const keyPath = path.join(certDir, 'key.pem')
const certPath = path.join(certDir, 'cert.pem')
execSync(
  `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 1 -nodes -subj "/CN=localhost"`,
  { stdio: 'ignore' },
)
const key = readFileSync(keyPath)
const cert = readFileSync(certPath)

let lastState = null
let accessToken = null
let refreshToken = null

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body, null, 2))
}

function html(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(body)
}

async function postForm(url, params) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  })
  const text = await resp.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { status: resp.status, body }
}

async function getWithAuth(url) {
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  const text = await resp.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { status: resp.status, body, headers: Object.fromEntries(resp.headers.entries()) }
}

async function postWithAuth(url, bodyText, contentType) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': contentType },
    body: bodyText,
  })
  const text = await resp.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { status: resp.status, body, headers: Object.fromEntries(resp.headers.entries()) }
}

function log(step, data) {
  console.log(`\n=== ${step} ===`)
  console.log(JSON.stringify(data, null, 2))
}

// Étape 1 : refresh du token si on en a déjà un (tranche l'inconnue "rotation du refresh_token").
async function tryRefresh() {
  if (!refreshToken) return false
  const result = await postForm(`${config.endpoint}/oauth2/token`, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  })
  log('1. refresh_token (avant tout nouvel appel)', result)
  if (result.status === 200 && result.body?.access_token) {
    accessToken = result.body.access_token
    const rotated = result.body.refresh_token !== refreshToken
    console.log(`[refresh] refresh_token ${rotated ? 'A CHANGÉ (rotation confirmée)' : 'identique (pas de rotation)'}`)
    refreshToken = result.body.refresh_token
    return true
  }
  return false
}

async function runProbeSequence(res) {
  const steps = []

  // 2. Facture de test CII.
  const testInvoiceResp = await fetch(`${config.endpoint}/v1.beta/invoices/generate_test_invoice?format=cii`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const testInvoiceXml = await testInvoiceResp.text()
  log('2. generate_test_invoice (cii)', { status: testInvoiceResp.status, length: testInvoiceXml.length, preview: testInvoiceXml.slice(0, 300) })
  steps.push({ step: 'generate_test_invoice', status: testInvoiceResp.status })

  // 3. Émission de la facture de test.
  const submitResult = await postWithAuth(`${config.endpoint}/v1.beta/invoices`, testInvoiceXml, 'application/xml')
  log('3. POST /v1.beta/invoices (facture de test valide)', submitResult)
  steps.push({ step: 'submit_valid', status: submitResult.status, body: submitResult.body })

  // 3bis. Émission volontairement invalide, pour observer la forme exacte d'une erreur.
  const badSubmitResult = await postWithAuth(`${config.endpoint}/v1.beta/invoices`, '<not-valid-xml>', 'application/xml')
  log('3bis. POST /v1.beta/invoices (XML invalide, volontaire)', badSubmitResult)
  steps.push({ step: 'submit_invalid', status: badSubmitResult.status, body: badSubmitResult.body })

  // 4. Détail de la facture émise, si on a un id exploitable.
  const invoiceId = submitResult.body?.id ?? submitResult.body?.invoice_id ?? null
  if (invoiceId) {
    const detailResult = await getWithAuth(`${config.endpoint}/v1.beta/invoices/${invoiceId}`)
    log('4. GET /v1.beta/invoices/{id}', detailResult)
    steps.push({ step: 'detail', status: detailResult.status })

    // 6. Statut métier de test sur cette facture.
    const eventResult = await postWithAuth(
      `${config.endpoint}/v1.beta/invoice_events`,
      JSON.stringify({ invoice_id: invoiceId, status_code: 'fr:212', details: [] }),
      'application/json',
    )
    log('6. POST /v1.beta/invoice_events (fr:212, test)', eventResult)
    steps.push({ step: 'invoice_event', status: eventResult.status, body: eventResult.body })
  } else {
    console.log('\n[4/6] Pas d\'id exploitable dans la réponse d\'émission — sauté.')
  }

  // 5. Liste / réception, pagination.
  const listResult = await getWithAuth(`${config.endpoint}/v1.beta/invoices?starting_after_id=0&order=desc`)
  log('5. GET /v1.beta/invoices?starting_after_id=0&order=desc', listResult)
  steps.push({ step: 'list', status: listResult.status, count: Array.isArray(listResult.body?.data) ? listResult.body.data.length : null })

  // 7. Validation du XML de test Super PDP (référence).
  const validationForm = new FormData()
  validationForm.append('file', new Blob([testInvoiceXml], { type: 'application/xml' }), 'test-invoice.xml')
  const validationResp = await fetch(`${config.endpoint}/v1.beta/validation_reports`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: validationForm,
  })
  const validationBody = await validationResp.json().catch(() => null)
  log('7. POST /v1.beta/validation_reports (facture de test Super PDP)', { status: validationResp.status, body: validationBody })
  steps.push({ step: 'validation_test_invoice', status: validationResp.status })

  console.log('\n=== Résumé ===')
  console.log(JSON.stringify(steps, null, 2))
  console.log('\nProchaine étape manuelle : reporter ces résultats dans le §15 de docs/atelier-facturation-electronique.md avant d\'écrire src/lib/super-pdp/client.ts.')

  json(res, 200, { steps })
}

const server = https.createServer({ key, cert }, async (req, res) => {
  const url = new URL(req.url, `https://localhost:${config.port}`)

  if (url.pathname === '/') {
    return html(res, 200, `
      <h1>Super PDP — probe émission/réception</h1>
      <p>Endpoint: ${config.endpoint}</p>
      <p>Redirect URI: ${config.redirectUri}</p>
      <p><a href="/connect">Se connecter (authorization_code) puis lancer la séquence</a></p>
    `)
  }

  if (url.pathname === '/connect') {
    lastState = crypto.randomBytes(16).toString('base64url')
    const authUrl = `${config.endpoint}/oauth2/authorize?` + new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      state: lastState,
      scope: '',
    }).toString()
    console.log('[connect] redirection vers', authUrl)
    res.writeHead(302, { Location: authUrl })
    return res.end()
  }

  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const error = url.searchParams.get('error')

    if (error) return json(res, 400, { error, error_description: url.searchParams.get('error_description') })
    if (!code) return json(res, 400, { error: 'missing_code' })
    if (state !== lastState) console.warn('[callback] state ne correspond pas')

    const tokenResult = await postForm(`${config.endpoint}/oauth2/token`, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    })
    log('0. authorization_code (échange initial)', tokenResult)

    if (tokenResult.status !== 200 || !tokenResult.body?.access_token) {
      return json(res, 502, { step: 'token_exchange', result: tokenResult })
    }

    accessToken = tokenResult.body.access_token
    refreshToken = tokenResult.body.refresh_token

    // Tranche l'inconnue "rotation du refresh_token" avant d'aller plus loin.
    await tryRefresh()

    return runProbeSequence(res)
  }

  return json(res, 404, { error: 'not_found' })
})

server.listen(config.port, () => {
  console.log(`Probe émission/réception Super PDP sur https://localhost:${config.port}`)
  console.log(`Ouvrir https://localhost:${config.port}/connect dans un navigateur pour démarrer.`)
  console.log(`Certificat jetable généré dans ${certDir}`)
})
