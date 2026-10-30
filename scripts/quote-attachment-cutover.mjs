#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { chmodSync, lstatSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'
import { createClient } from '@supabase/supabase-js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BUCKET = 'quote-attachments'
const PAGE_SIZE = 100
const MAX_OBJECTS = 100_000
const MAX_HASH_BYTES = 10 * 1024 * 1024
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const WORKER_RE = /^[a-z0-9][a-z0-9-]{1,62}$/
const SHA256_RE = /^[0-9a-f]{64}$/
const OLD_PUBLIC_URL_PREFIX = '/storage/v1/object/public/quote-attachments/'
const OLD_AUTH_URL_PREFIX = '/storage/v1/object/authenticated/quote-attachments/'

class CutoverError extends Error {}

function fail(message) {
  throw new CutoverError(message)
}

function entryLabel(path) {
  return `entry ${createHash('sha256').update(path).digest('hex').slice(0, 12)}`
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function safeMessage() {
  return 'provider request failed'
}

function parseArgs(argv) {
  const [worker, ...args] = argv
  if (!worker || !WORKER_RE.test(worker) || worker === 'orsayn-cockpit') {
    fail('Usage: quote-attachment-cutover.mjs <client-worker> --inventory --output .atelier-private/<plan.json> | --check | --apply --mapping .atelier-private/<reviewed.json> --confirm-origin <exact Supabase origin>')
  }

  if (args.length === 1 && args[0] === '--check') return { worker, mode: 'check' }
  if (args.length === 3 && args[0] === '--inventory' && args[1] === '--output' && args[2]) {
    return { worker, mode: 'inventory', outputPath: args[2] }
  }
  if (args.length === 5 && args[0] === '--apply' && args[1] === '--mapping' && args[2] && args[3] === '--confirm-origin' && args[4]) {
    return { worker, mode: 'apply', mappingPath: args[2], confirmedOrigin: args[4] }
  }
  fail('Usage: quote-attachment-cutover.mjs <client-worker> --inventory --output .atelier-private/<plan.json> | --check | --apply --mapping .atelier-private/<reviewed.json> --confirm-origin <exact Supabase origin>')
}
 

function readTargetConfig(worker) {
  if (!WORKER_RE.test(worker) || worker === 'orsayn-cockpit') fail('Invalid client worker target; cockpit is not supported.')
  const envPath = resolve(ROOT, `.env.client-${worker}`)
  let stat
  try {
    stat = lstatSync(envPath)
  } catch {
    fail('Target environment file is missing.')
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail('Target environment must be a regular private client file, not a symlink.')

  let env
  try {
    env = parseEnv(readFileSync(envPath, 'utf8'))
  } catch {
    fail('Target environment file could not be parsed.')
  }
  const rawUrl = env.SUPABASE_URL
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!rawUrl || !serviceKey || /^(?:todo|replace|placeholder)/i.test(serviceKey)) {
    fail('Target environment must define SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
  }

  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    fail('SUPABASE_URL is not a valid project URL.')
  }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash
    || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    fail('SUPABASE_URL must be a bare HTTP(S) project origin without credentials, path, query, or fragment.')
  }
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
    fail('Non-local Supabase targets must use HTTPS.')
  }
  return { origin: parsed.origin, serviceKey }
}

function makeClient(config) {
  return createClient(config.origin, config.serviceKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  })
}

function readRegularFile(path, label) {
  let stat
  try {
    stat = lstatSync(path)
  } catch {
    fail(`${label} file does not exist.`)
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label} must be a regular file, not a symlink.`)
  return readFileSync(path, 'utf8')
}

function writePrivateFile(path, contents) {
  const destination = resolve(path)
  const parent = dirname(destination)
  const filename = basename(destination)
  if (!filename || destination === parent) fail('Invalid inventory output path.')
  try {
    writeFileSync(destination, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    chmodSync(destination, 0o600)
  } catch (error) {
    if (error?.code === 'EEXIST') fail('Inventory output already exists; refusing to overwrite it.')
    if (error?.code === 'ENOENT') fail('Inventory output directory does not exist.')
    throw error
  }
}

function validObjectPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024 || value.startsWith('/') || value.endsWith('/')) return false
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return false
  const parts = value.split('/')
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..')
}

function attachmentPathFromReference(value, origin) {
  if (typeof value !== 'string' || value.length === 0) return { reason: 'empty_or_non_string' }
  if (value.startsWith('quote-requests/')) {
    return validObjectPath(value) ? { path: value } : { reason: 'unsafe_storage_path' }
  }
  let url
  try {
    url = new URL(value)
  } catch {
    return { reason: 'unrecognized_reference' }
  }
  if (url.origin !== origin || url.username || url.password || url.hash || url.search) return { reason: 'foreign_or_ambiguous_url' }
  const prefix = url.pathname.startsWith(OLD_PUBLIC_URL_PREFIX)
    ? OLD_PUBLIC_URL_PREFIX
    : url.pathname.startsWith(OLD_AUTH_URL_PREFIX) ? OLD_AUTH_URL_PREFIX : null
  if (!prefix) return { reason: 'unrecognized_storage_url' }
  let path
  try {
    path = decodeURIComponent(url.pathname.slice(prefix.length))
  } catch {
    return { reason: 'invalid_url_encoding' }
  }
  return validObjectPath(path) ? { path } : { reason: 'unsafe_storage_path' }
}

async function listDirectory(bucket, prefix) {
  const entries = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await bucket.list(prefix, {
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    })
    if (error) fail(`Storage inventory failed: ${safeMessage(error)}`)
    if (!Array.isArray(data)) fail('Storage inventory returned an invalid page.')
    entries.push(...data)
    if (data.length < PAGE_SIZE) break
    if (offset + PAGE_SIZE > MAX_OBJECTS) fail('Storage inventory exceeded the bounded object-count limit.')
  }
  return entries
}

async function collectObjects(bucket) {
  const objects = new Map()
  const visitedDirectories = new Set()
  const visit = async (prefix, depth) => {
    if (depth > 32) fail('Storage inventory contains a directory nesting depth above the safe limit.')
    if (visitedDirectories.has(prefix)) fail('Storage inventory returned a repeated directory path.')
    visitedDirectories.add(prefix)
    const rows = await listDirectory(bucket, prefix)
    for (const row of rows) {
      if (!row || typeof row.name !== 'string' || row.name.length === 0 || row.name.includes('/')) {
        fail('Storage inventory returned a malformed object name.')
      }
      const objectPath = prefix ? `${prefix}/${row.name}` : row.name
      if (typeof row.id === 'string') {
        if (objects.has(objectPath)) fail('Storage inventory returned a duplicate object path.')
        const rawSize = row.metadata?.size
        const size = typeof rawSize === 'number' ? rawSize : Number(rawSize)
        objects.set(objectPath, {
          source_path: objectPath,
          source_present: true,
          source_size_bytes: Number.isSafeInteger(size) && size >= 0 ? size : null,
        })
      } else {
        await visit(objectPath, depth + 1)
      }
      if (objects.size > MAX_OBJECTS) fail('Storage inventory exceeded the bounded object-count limit.')
    }
  }
  await visit('', 0)
  return objects
}

function addReference(references, unresolved, row, field, kind, value, origin) {
  const result = attachmentPathFromReference(value, origin)
  if (!result.path) {
    unresolved.push({
      quote_request_id: row.id,
      organization_id: row.organization_id,
      field,
      value_kind: kind,
      reason: result.reason,
      provenance: 'unverified',
    })
    return null
  }
  const existing = references.get(result.path) ?? []
  existing.push({
    quote_request_id: row.id,
    organization_id: row.organization_id,
    field,
    value_kind: kind,
    provenance: 'unverified',
  })
  references.set(result.path, existing)
  return result.path
}

async function collectReferences(client, origin) {
  const references = new Map()
  const unresolved = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client.from('quote_requests')
      .select('id, organization_id, attachments, attachment_url')
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) fail(`Quote request reference inventory failed: ${safeMessage(error)}`)
    if (!Array.isArray(data)) fail('Quote request reference inventory returned an invalid page.')
    for (const row of data) {
      if (!row || typeof row.id !== 'string' || !UUID_RE.test(row.organization_id ?? '')) {
        unresolved.push({
          quote_request_id: typeof row?.id === 'string' ? row.id : null,
          organization_id: typeof row?.organization_id === 'string' ? row.organization_id : null,
          field: 'row',
          value_kind: 'schema',
          reason: 'invalid_reference_owner',
          provenance: 'unverified',
        })
        continue
      }
      if (row.attachments !== null && row.attachments !== undefined && !Array.isArray(row.attachments)) {
        unresolved.push({
          quote_request_id: row.id,
          organization_id: row.organization_id,
          field: 'attachments',
          value_kind: 'schema',
          reason: 'unrecognized_attachment_metadata_shape',
          provenance: 'unverified',
        })
      } else if (Array.isArray(row.attachments)) {
        row.attachments.forEach((attachment, index) => {
          const field = `attachments[${index}]`
          const aliasPaths = []
          if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) {
            unresolved.push({
              quote_request_id: row.id,
              organization_id: row.organization_id,
              field,
              value_kind: 'schema',
              reason: 'unrecognized_attachment_metadata_shape',
              provenance: 'unverified',
            })
            return
          }
          if (Object.hasOwn(attachment, 'storage_path')) {
            if (typeof attachment.storage_path === 'string') {
              const path = addReference(references, unresolved, row, `${field}.storage_path`, 'storage_path', attachment.storage_path, origin)
              if (path) aliasPaths.push(path)
            }
            else unresolved.push({ quote_request_id: row.id, organization_id: row.organization_id, field: `${field}.storage_path`, value_kind: 'storage_path', reason: 'non_string_reference', provenance: 'unverified' })
          }
          if (Object.hasOwn(attachment, 'public_url')) {
            if (typeof attachment.public_url === 'string') {
              const path = addReference(references, unresolved, row, `${field}.public_url`, 'public_url', attachment.public_url, origin)
              if (path) aliasPaths.push(path)
            }
            else unresolved.push({ quote_request_id: row.id, organization_id: row.organization_id, field: `${field}.public_url`, value_kind: 'public_url', reason: 'non_string_reference', provenance: 'unverified' })
          }
          if (!Object.hasOwn(attachment, 'storage_path') && !Object.hasOwn(attachment, 'public_url')) unresolved.push({
            quote_request_id: row.id,
            organization_id: row.organization_id,
            field,
            value_kind: 'schema',
            reason: 'missing_attachment_reference',
            provenance: 'unverified',
          })
          if (new Set(aliasPaths).size > 1) unresolved.push({
            quote_request_id: row.id,
            organization_id: row.organization_id,
            field,
            value_kind: 'alias',
            reason: 'contradictory_attachment_aliases',
            provenance: 'unverified',
          })
        })
      }
      if (row.attachment_url !== null && row.attachment_url !== undefined) {
        if (typeof row.attachment_url === 'string') addReference(references, unresolved, row, 'attachment_url', 'attachment_url', row.attachment_url, origin)
        else unresolved.push({ quote_request_id: row.id, organization_id: row.organization_id, field: 'attachment_url', value_kind: 'attachment_url', reason: 'non_string_reference', provenance: 'unverified' })
      }
    }
    if (data.length < PAGE_SIZE) break
    if (offset > 10_000_000) fail('Quote request reference inventory exceeded its bounded row-count limit.')
  }
  return { references, unresolved }
}

function sortedReferences(values) {
  return [...values].sort((a, b) => compareText(JSON.stringify(a), JSON.stringify(b)))
}

function makeInventoryDigest(entries, unresolvedReferences) {
  const facts = {
    entries: entries.map((entry) => ({
      source_path: entry.source_path,
      source_present: entry.source_present,
      source_size_bytes: entry.source_size_bytes,
      references: sortedReferences(entry.references),
    })),
    unresolved_references: [...unresolvedReferences].sort((a, b) => compareText(JSON.stringify(a), JSON.stringify(b))),
  }
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex')
}

async function collectInventory(client, origin) {
  const bucket = client.storage.from(BUCKET)
  const [objects, foundReferences] = await Promise.all([
    collectObjects(bucket),
    collectReferences(client, origin),
  ])
  for (const [sourcePath, references] of foundReferences.references) {
    if (!objects.has(sourcePath)) {
      objects.set(sourcePath, { source_path: sourcePath, source_present: false, source_size_bytes: null })
    }
  }

  const entries = [...objects.values()].sort((a, b) => compareText(a.source_path, b.source_path)).map((entry) => {
    const refs = sortedReferences(foundReferences.references.get(entry.source_path) ?? [])
    const candidateIds = [...new Set(refs.map((reference) => reference.organization_id))].sort()
    const blockers = []
    if (!entry.source_present) blockers.push('referenced_source_missing')
    if (!validObjectPath(entry.source_path) || !entry.source_path.startsWith('quote-requests/')) blockers.push('outside_supported_quote_request_namespace')
    if (entry.source_size_bytes === null) blockers.push('source_size_unavailable')
    if (entry.source_size_bytes !== null && entry.source_size_bytes > MAX_HASH_BYTES) blockers.push('source_exceeds_streaming_hash_limit')
    if (candidateIds.length > 1) blockers.push('contradictory_reference_organizations')
    return {
      source_path: entry.source_path,
      organization_id: null,
      action: null,
      source_present: entry.source_present,
      source_size_bytes: entry.source_size_bytes,
      candidate_organization_ids_unverified: candidateIds,
      references: refs,
      provenance: 'unverified',
      blockers,
    }
  })
  const unresolvedReferences = foundReferences.unresolved.sort((a, b) => compareText(JSON.stringify(a), JSON.stringify(b)))
  const inventorySha256 = makeInventoryDigest(entries, unresolvedReferences)
  return { entries, unresolvedReferences, inventorySha256 }
}

async function assertCutoverComplete(client, worker) {
  const { error } = await client.rpc('assert_quote_attachment_cutover_complete')
  if (error) fail(`Quote attachment cutover schema gate failed for ${worker}: ${safeMessage(error)}.`)
  console.log(`Quote attachment schema gate passed for ${worker}.`)
}

function inventoryPlan(worker, origin, inventory) {
  return {
    version: 1,
    projectOrigin: origin,
    worker,
    reviewed: false,
    inventorySha256: inventory.inventorySha256,
    generatedAt: new Date().toISOString(),
    entries: inventory.entries,
    unresolvedReferences: inventory.unresolvedReferences,
    reviewInstructions: 'Review every source_path against authoritative records. Set organization_id and action (move|delete) explicitly for each entry, then set reviewed=true. Candidate organizations and provenance are unverified and are not ownership proof.',
  }
}

function validateReviewedMapping(mapping, origin, worker) {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) fail('Reviewed mapping must be a JSON object.')
  if (mapping.version !== 1 || mapping.reviewed !== true) fail('Mapping must have version 1 and reviewed: true.')
  if (mapping.projectOrigin !== origin) fail('Mapping projectOrigin does not exactly match the target project origin.')
  if (mapping.worker !== worker) fail('Mapping worker does not match the selected target worker.')
  if (typeof mapping.inventorySha256 !== 'string' || !SHA256_RE.test(mapping.inventorySha256)) fail('Mapping is missing a valid inventorySha256 review baseline.')
  if (!Array.isArray(mapping.entries)) fail('Mapping entries must be an array.')
  if (!Array.isArray(mapping.unresolvedReferences)) fail('Mapping must retain its inventory unresolvedReferences list.')
  const byPath = new Map()
  for (const entry of mapping.entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !validObjectPath(entry.source_path)) fail('Mapping contains an invalid source_path.')
    if (byPath.has(entry.source_path)) fail(`Mapping repeats ${entryLabel(entry.source_path)}.`)
    const ownerId = typeof entry.organization_id === 'string' ? entry.organization_id.toLowerCase() : ''
    if (!UUID_RE.test(ownerId)) fail(`Mapping requires an explicit organization_id for ${entryLabel(entry.source_path)}.`)
    if (entry.action !== 'move' && entry.action !== 'delete') fail(`Mapping requires action move or delete for ${entryLabel(entry.source_path)}.`)
    if (typeof entry.source_present !== 'boolean' || !Array.isArray(entry.references)) fail(`Mapping lacks original inventory facts for ${entryLabel(entry.source_path)}.`)
    if (entry.source_size_bytes !== null && (!Number.isSafeInteger(entry.source_size_bytes) || entry.source_size_bytes < 0)) fail(`Mapping has invalid source size for ${entryLabel(entry.source_path)}.`)
    byPath.set(entry.source_path, { ...entry, organization_id: ownerId })
  }
  return byPath
}
 
function checkReviewedInventory(inventory, mapping, mappingEntries, jobs) {
  if (makeInventoryDigest(mapping.entries, mapping.unresolvedReferences) !== mapping.inventorySha256) {
    fail('Reviewed mapping inventory facts no longer match inventorySha256.')
  }
  if (mapping.unresolvedReferences.length > 0) fail('Apply blocked: the reviewed inventory contains unresolved or unrecognized references.')
  if (inventory.unresolvedReferences.length > 0) fail('Apply blocked: unresolved or unrecognized quote attachment references remain.')

  const destinations = new Map()
  for (const [sourcePath, reviewed] of mappingEntries) {
    const job = jobs.get(sourcePath)
    if (!job) fail(`Migration lookup is missing for ${entryLabel(sourcePath)}.`)
    if (job.action === 'move' && job.state !== 'unprepared') {
      if (mappingEntries.has(job.destination_path)) fail(`Migration destination overlaps a reviewed source: ${entryLabel(job.destination_path)}.`)
      if (destinations.has(job.destination_path)) fail(`Migration jobs share a destination: ${entryLabel(job.destination_path)}.`)
      destinations.set(job.destination_path, { ownerId: reviewed.organization_id, state: job.state })
    }
  }

  const currentFacts = new Map(inventory.entries.map((entry) => [entry.source_path, entry]))
  for (const observed of inventory.entries) {
    const destination = destinations.get(observed.source_path)
    if (destination) {
      if (observed.candidate_organization_ids_unverified.some((id) => id !== destination.ownerId)) {
        fail(`Observed migration destination has contradictory ownership evidence: ${entryLabel(observed.source_path)}.`)
      }
      if (destination.state === 'prepared' && observed.blockers.length > 0) {
        fail(`Prepared migration destination is not fully observable: ${entryLabel(observed.source_path)}.`)
      }
      continue
    }

    const reviewed = mappingEntries.get(observed.source_path)
    if (!reviewed) fail(`Current inventory contains an unreviewed object or reference: ${entryLabel(observed.source_path)}.`)
    const job = jobs.get(observed.source_path)
    if (job.state === 'completed') fail(`Completed source unexpectedly remains in inventory: ${entryLabel(observed.source_path)}.`)
    if (observed.candidate_organization_ids_unverified.some((id) => id !== reviewed.organization_id)) {
      fail(`Reviewed owner for ${entryLabel(observed.source_path)} contradicts an observed quote request reference.`)
    }

    if (job.state === 'prepared' && !observed.source_present) {
      const blockers = observed.blockers.filter((blocker) => blocker !== 'referenced_source_missing' && blocker !== 'source_size_unavailable')
      if (blockers.length > 0) fail(`Prepared migration source has contradictory facts for ${entryLabel(observed.source_path)}.`)
      if (JSON.stringify(sortedReferences(observed.references)) !== JSON.stringify(sortedReferences(reviewed.references))) {
        fail(`References changed while prepared source ${entryLabel(observed.source_path)} is absent.`)
      }
      continue
    }
    if (observed.blockers.length > 0) fail(`Apply blocked for ${entryLabel(observed.source_path)}: ${observed.blockers.join(', ')}.`)
    if (makeInventoryDigest([observed], []) !== makeInventoryDigest([reviewed], [])) {
      fail(`Current inventory facts changed for ${entryLabel(observed.source_path)}; review a fresh inventory.`)
    }
  }

  for (const [sourcePath, reviewed] of mappingEntries) {
    const job = jobs.get(sourcePath)
    const observed = currentFacts.get(sourcePath)
    if (job.state === 'completed') {
      if (observed) fail(`Completed source unexpectedly remains in inventory: ${entryLabel(sourcePath)}.`)
      continue
    }
    if (observed) continue
    if (job.state === 'prepared' && reviewed.references.length === 0) continue
    fail(`Reviewed source or reference disappeared since inventory: ${entryLabel(sourcePath)}.`)
  }
}
 


function validateJob(job, sourcePath, reviewed) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) fail(`Migration lookup is invalid for ${entryLabel(sourcePath)}.`)
  if (job.source_path !== sourcePath || typeof job.organization_id !== 'string'
    || job.organization_id.toLowerCase() !== reviewed.organization_id || job.action !== reviewed.action) {
    fail(`Existing migration job contradicts reviewed owner or action for ${entryLabel(sourcePath)}.`)
  }
  if (typeof job.source_sha256 === 'string') job.source_sha256 = job.source_sha256.toLowerCase()
  if (job.state === 'unprepared') {
    if (job.job_id !== null || job.source_sha256 !== null || job.destination_path !== null) {
      fail(`Unprepared migration lookup contains durable job fields for ${entryLabel(sourcePath)}.`)
    }
    return
  }
  if (!['prepared', 'completed'].includes(job.state) || typeof job.job_id !== 'string' || !UUID_RE.test(job.job_id)) {
    fail(`Existing migration job is malformed for ${entryLabel(sourcePath)}.`)
  }
  if (job.state === 'prepared' && !SHA256_RE.test(job.source_sha256 ?? '')) {
    fail(`Prepared migration has no sealed source digest for ${entryLabel(sourcePath)}.`)
  }
  if (job.state === 'completed' && job.source_sha256 !== null) {
    fail(`Completed migration retained a source digest for ${entryLabel(sourcePath)}.`)
  }
  if (reviewed.action === 'move') {
    const expected = new RegExp(`^quote-requests/${reviewed.organization_id}/migrated-[0-9a-f]{64}(?:\\.[A-Za-z0-9]{1,16})?$`, 'i')
    if (typeof job.destination_path !== 'string' || !expected.test(job.destination_path) || job.destination_path === sourcePath) {
      fail(`Existing migration destination is invalid for ${entryLabel(sourcePath)}.`)
    }
  } else if (job.destination_path !== null) {
    fail(`Delete migration unexpectedly has a destination for ${entryLabel(sourcePath)}.`)
  }
}

async function lookupJobs(client, reviewedEntries) {
  const jobs = new Map()
  for (const [sourcePath, reviewed] of reviewedEntries) {
    const { data, error } = await client.rpc('prepare_quote_attachment_migration', {
      p_source_path: sourcePath,
      p_organization_id: reviewed.organization_id,
      p_source_sha256: null,
      p_action: reviewed.action,
    })
    if (error) fail(`Could not look up migration for ${entryLabel(sourcePath)}: ${safeMessage(error)}.`)
    const job = normalizeRpcObject(data, 'prepare_quote_attachment_migration lookup')
    validateJob(job, sourcePath, reviewed)
    jobs.set(sourcePath, job)
  }
  return jobs
}

function normalizeRpcObject(data, label) {
  const result = Array.isArray(data) ? data.length === 1 ? data[0] : null : data
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail(`${label} returned an invalid response.`)
  return result
}

async function prepareJob(client, sourcePath, reviewed, sha256) {
  const { data, error } = await client.rpc('prepare_quote_attachment_migration', {
    p_source_path: sourcePath,
    p_organization_id: reviewed.organization_id,
    p_source_sha256: sha256,
    p_action: reviewed.action,
  })
  if (error) fail(`Could not prepare migration for ${entryLabel(sourcePath)}: ${safeMessage(error)}.`)
  const job = normalizeRpcObject(data, 'prepare_quote_attachment_migration')
  validateJob(job, sourcePath, reviewed)
  if (job.state === 'prepared' && job.source_sha256 !== sha256.toLowerCase()) {
    fail(`Prepared job hash differs from the observed source for ${entryLabel(sourcePath)}.`)
  }
  return job
}


function objectKeyUrl(origin, path) {
  return `${origin}/storage/v1/object/authenticated/${encodeURIComponent(BUCKET)}/${path.split('/').map(encodeURIComponent).join('/')}`
}

async function hashStorageObject(origin, secret, path, expectedSize = null) {
  const response = await fetch(objectKeyUrl(origin, path), {
    method: 'GET',
    headers: { apikey: secret, authorization: `Bearer ${secret}`, 'accept-encoding': 'identity' },
    cache: 'no-store',
    redirect: 'error',
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    fail(`Could not stream Storage object ${entryLabel(path)}; HTTP ${response.status}.`)
  }
  const rawLength = response.headers.get('content-length')
  if (rawLength !== null) {
    const length = Number(rawLength)
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_HASH_BYTES) {
      await response.body?.cancel().catch(() => {})
      fail(`Storage object ${entryLabel(path)} exceeds the bounded streaming hash limit or has invalid length.`)
    }
  }
  if (!response.body) fail(`Storage object ${entryLabel(path)} has no readable response body.`)
  const hash = createHash('sha256')
  const reader = response.body.getReader()
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_HASH_BYTES) {
        await reader.cancel().catch(() => {})
        fail(`Storage object ${entryLabel(path)} exceeds the bounded streaming hash limit.`)
      }
      hash.update(value)
    }
  } finally {
    reader.releaseLock()
  }
  if (rawLength !== null && Number(rawLength) !== total) fail(`Storage object ${entryLabel(path)} changed length while being hashed.`)
  if (expectedSize !== null && total !== expectedSize) fail(`Storage object ${entryLabel(path)} differs from its observed size.`)
  return hash.digest('hex')
}

async function statObject(bucket, path) {
  const slash = path.lastIndexOf('/')
  const parent = slash < 0 ? '' : path.slice(0, slash)
  const name = slash < 0 ? path : path.slice(slash + 1)
  const entries = await listDirectory(bucket, parent)
  const matching = entries.filter((entry) => entry.name === name)
  const files = matching.filter((entry) => typeof entry.id === 'string')
  if (files.length > 1 || matching.length > 1) fail(`Storage state is ambiguous for ${entryLabel(path)}.`)
  if (matching.length === 1 && files.length === 0) fail(`Expected object path is occupied by a directory: ${entryLabel(path)}.`)
  if (files.length === 0) return null
  const rawSize = files[0].metadata?.size
  const size = typeof rawSize === 'number' ? rawSize : Number(rawSize)
  return { size: Number.isSafeInteger(size) && size >= 0 ? size : null }
}

async function finalizeJob(client, job, sha256) {
  const { data, error } = await client.rpc('finalize_quote_attachment_migration', {
    p_job_id: job.job_id,
    p_observed_sha256: sha256,
  })
  if (error) fail(`Could not finalize migration for ${entryLabel(job.source_path)}: ${safeMessage(error)}.`)
  const result = normalizeRpcObject(data, 'finalize_quote_attachment_migration')
  if (result.job_id !== job.job_id || result.source_path !== job.source_path || result.destination_path !== job.destination_path
    || result.organization_id !== job.organization_id || result.action !== job.action || result.state !== 'completed') {
    fail(`Finalize RPC returned a contradictory result for ${entryLabel(job.source_path)}.`)
  }
}
 

async function prepareAll(client, origin, secret, reviewedEntries, lookups) {
  const bucket = client.storage.from(BUCKET)
  const ready = []
  for (const [sourcePath, reviewed] of reviewedEntries) {
    let job = lookups.get(sourcePath)
    if (!job) fail(`Migration lookup is missing for ${entryLabel(sourcePath)}.`)
    if (job.state === 'completed') {
      ready.push({ job, state: 'completed' })
      continue
    }

    const source = await statObject(bucket, sourcePath)
    let sourceHash = null
    if (job.state === 'unprepared') {
      if (!source) fail(`Source ${entryLabel(sourcePath)} is missing and no durable migration job proves it existed.`)
      if (source.size !== reviewed.source_size_bytes) fail(`Source ${entryLabel(sourcePath)} changed size after review.`)
      sourceHash = await hashStorageObject(origin, secret, sourcePath, source.size)
      job = await prepareJob(client, sourcePath, reviewed, sourceHash)
      if (job.state === 'completed') {
        ready.push({ job, state: 'completed' })
        continue
      }
    }
    if (job.state !== 'prepared') fail(`Migration did not reach prepared state for ${entryLabel(sourcePath)}.`)

    if (source) {
      if (source.size !== reviewed.source_size_bytes) fail(`Source ${entryLabel(sourcePath)} changed size after review.`)
      sourceHash ??= await hashStorageObject(origin, secret, sourcePath, source.size)
      if (sourceHash !== job.source_sha256) fail(`Source hash differs from the durable migration job for ${entryLabel(sourcePath)}.`)
    }

    let destination = null
    if (job.action === 'move') {
      destination = await statObject(bucket, job.destination_path)
      if (source && destination) fail(`Both source and destination exist for ${entryLabel(sourcePath)}; refusing to overwrite or guess.`)
      if (!source && !destination) fail(`Neither source nor destination exists for prepared migration ${entryLabel(sourcePath)}.`)
      if (!source && destination) {
        if (destination.size !== reviewed.source_size_bytes) fail(`Observed destination size differs for ${entryLabel(sourcePath)}.`)
        const destinationHash = await hashStorageObject(origin, secret, job.destination_path, destination.size)
        if (destinationHash !== job.source_sha256) fail(`Observed destination hash differs from the prepared source for ${entryLabel(sourcePath)}.`)
      }
    }
    ready.push({ job, sourceSize: reviewed.source_size_bytes, state: 'prepared' })
  }
  return ready
}
 

async function applyPrepared(client, origin, secret, ready) {
  const bucket = client.storage.from(BUCKET)
  let moved = 0
  let deleted = 0
  let resumed = 0
  let alreadyComplete = 0
  for (const item of ready) {
    const { job } = item
    if (item.state === 'completed') {
      alreadyComplete += 1
      continue
    }

    const source = await statObject(bucket, job.source_path)
    if (job.action === 'move') {
      const destination = await statObject(bucket, job.destination_path)
      if (source && destination) fail(`Both source and destination exist for ${entryLabel(job.source_path)}; refusing to overwrite.`)
      if (!source && !destination) fail(`Neither source nor destination exists for ${entryLabel(job.source_path)}; refusing to guess.`)
      if (!source && destination) {
        if (destination.size !== item.sourceSize) fail(`Observed destination size differs for ${entryLabel(job.source_path)}.`)
        const destinationHash = await hashStorageObject(origin, secret, job.destination_path, destination.size)
        if (destinationHash !== job.source_sha256) fail(`Observed destination hash differs from the prepared source for ${entryLabel(job.source_path)}.`)
        await finalizeJob(client, job, destinationHash)
        resumed += 1
        continue
      }
      if (source.size !== item.sourceSize) fail(`Source size changed before Storage move for ${entryLabel(job.source_path)}.`)
      const sourceHash = await hashStorageObject(origin, secret, job.source_path, source.size)
      if (sourceHash !== job.source_sha256) fail(`Source hash differs from the prepared job for ${entryLabel(job.source_path)}.`)
      const { error } = await bucket.move(job.source_path, job.destination_path)
      if (error) fail(`Storage move returned an uncertain result for ${entryLabel(job.source_path)}: ${safeMessage(error)}. Stop and rerun only after reviewing observed state.`)
      const afterSource = await statObject(bucket, job.source_path)
      const afterDestination = await statObject(bucket, job.destination_path)
      if (afterSource || !afterDestination) fail(`Storage move outcome was not the exact expected state for ${entryLabel(job.source_path)}; no finalize attempted.`)
      if (afterDestination.size !== item.sourceSize) fail(`Moved destination size differs from the source for ${entryLabel(job.source_path)}; no finalize attempted.`)
      const destinationHash = await hashStorageObject(origin, secret, job.destination_path, afterDestination.size)
      if (destinationHash !== job.source_sha256) fail(`Moved destination digest differs from the source for ${entryLabel(job.source_path)}; no finalize attempted.`)
      await finalizeJob(client, job, destinationHash)
      moved += 1
      continue
    }

    if (source) {
      if (source.size !== item.sourceSize) fail(`Source size changed before Storage delete for ${entryLabel(job.source_path)}.`)
      const sourceHash = await hashStorageObject(origin, secret, job.source_path, source.size)
      if (sourceHash !== job.source_sha256) fail(`Source hash differs from the prepared job for ${entryLabel(job.source_path)}.`)
      const { error } = await bucket.remove([job.source_path])
      if (error) fail(`Storage delete returned an uncertain result for ${entryLabel(job.source_path)}: ${safeMessage(error)}. Stop and rerun only after reviewing observed state.`)
      if (await statObject(bucket, job.source_path)) fail(`Storage delete did not leave the source absent for ${entryLabel(job.source_path)}; no finalize attempted.`)
      await finalizeJob(client, job, job.source_sha256)
      deleted += 1
      continue
    }
    await finalizeJob(client, job, job.source_sha256)
    resumed += 1
  }
  return { moved, deleted, resumed, alreadyComplete }
}

async function runInventory(options) {
  const config = readTargetConfig(options.worker)
  const client = makeClient(config)
  const inventory = await collectInventory(client, config.origin)
  const plan = inventoryPlan(options.worker, config.origin, inventory)
  const path = isAbsolute(options.outputPath) ? options.outputPath : resolve(process.cwd(), options.outputPath)
  writePrivateFile(path, `${JSON.stringify(plan, null, 2)}\n`)
  const blockerCount = inventory.entries.reduce((sum, entry) => sum + entry.blockers.length, 0) + inventory.unresolvedReferences.length
  console.log(`Private inventory written: ${inventory.entries.length} paths, ${inventory.unresolvedReferences.length} unresolved references, ${blockerCount} blockers. Ownership is unverified; review every entry before apply.`)
}

async function runApply(options) {
  const config = readTargetConfig(options.worker)
  if (options.confirmedOrigin !== config.origin) fail('--confirm-origin must exactly equal the project origin read from the validated target environment file.')
  const mappingPath = isAbsolute(options.mappingPath) ? options.mappingPath : resolve(process.cwd(), options.mappingPath)
  let mapping
  try {
    mapping = JSON.parse(readRegularFile(mappingPath, 'Reviewed mapping'))
  } catch (error) {
    if (error instanceof SyntaxError) fail('Reviewed mapping is not valid JSON.')
    throw error
  }
  const mappingEntries = validateReviewedMapping(mapping, config.origin, options.worker)
  const client = makeClient(config)
  const lookups = await lookupJobs(client, mappingEntries)
  const currentInventory = await collectInventory(client, config.origin)
  checkReviewedInventory(currentInventory, mapping, mappingEntries, lookups)
  const ready = await prepareAll(client, config.origin, config.serviceKey, mappingEntries, lookups)
  const result = await applyPrepared(client, config.origin, config.serviceKey, ready)
  await assertCutoverComplete(client, options.worker)
  console.log(`Attachment cutover apply complete: moved ${result.moved}, deleted ${result.deleted}, resumed ${result.resumed}, already complete ${result.alreadyComplete}.`)
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.mode === 'check') {
    const config = readTargetConfig(options.worker)
    await assertCutoverComplete(makeClient(config), options.worker)
    return
  }
  if (options.mode === 'inventory') {
    await runInventory(options)
    return
  }
  await runApply(options)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    const message = error instanceof CutoverError ? error.message : 'Unexpected failure; sensitive details suppressed.'
    console.error(`Quote attachment cutover refused: ${message}`)
    process.exitCode = 1
  })
}
