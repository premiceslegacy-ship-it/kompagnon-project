import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { unstable_dev, type Unstable_DevWorker } from 'wrangler'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO/jWkQAAAAASUVORK5CYII=', 'base64')
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../')
const storagePath = '/storage/v1/object/public/logos/'
const host = '127.0.0.1'
const oversizedBytes = 8 * 1024 * 1024
const chunkBytes = 16 * 1024

type OversizedTransfer = {
  sentBytes: number
  readonly totalBytes: number
  readonly hasContentLength: boolean
  completed: boolean
  cancelled: boolean
  timer?: ReturnType<typeof setTimeout>
  readonly closed: Promise<void>
}

let fixtureServer: Server | undefined
let trapServer: Server | undefined
let fixtureOrigin: string
let trapOrigin: string
let tempDirectory: string | undefined
let worker: Unstable_DevWorker | undefined
let oversizedTransfer: OversizedTransfer | undefined
const fixtureRequests: string[] = []
const trapRequests: string[] = []

function listen(server: Server): Promise<string> {
  const ready = Promise.withResolvers<string>()
  const onError = (error: Error) => ready.reject(error)
  server.once('error', onError)
  server.listen(0, host, () => {
    server.off('error', onError)
    const address = server.address()
    if (!address || typeof address === 'string') {
      ready.reject(new Error('Expected a loopback fixture socket'))
      return
    }
    ready.resolve(`http://${host}:${address.port}`)
  })
  return ready.promise
}

function close(server: Server | undefined): Promise<void> {
  if (!server?.listening) return Promise.resolve()
  const closed = Promise.withResolvers<void>()
  server.close((error) => error ? closed.reject(error) : closed.resolve())
  server.closeAllConnections()
  return closed.promise
}

function createOversizedResponse(response: ServerResponse): void {
  response.writeHead(200, {
    'content-type': 'application/octet-stream',
    'transfer-encoding': 'chunked',
  })
  const closed = Promise.withResolvers<void>()
  const transfer: OversizedTransfer = {
    sentBytes: 0,
    totalBytes: oversizedBytes,
    hasContentLength: response.hasHeader('content-length'),
    completed: false,
    cancelled: false,
    closed: closed.promise,
  }
  oversizedTransfer = transfer

  let onDrain: (() => void) | undefined
  response.once('close', () => {
    transfer.cancelled = !transfer.completed
    if (transfer.timer !== undefined) {
      clearTimeout(transfer.timer)
      transfer.timer = undefined
    }
    if (onDrain) response.off('drain', onDrain)
    closed.resolve()
  })

  const chunk = Buffer.alloc(chunkBytes, 0x5a)
  const writeNext = () => {
    if (response.destroyed) return
    const size = Math.min(chunk.length, transfer.totalBytes - transfer.sentBytes)
    if (size === 0) {
      transfer.completed = true
      response.end()
      return
    }
    transfer.sentBytes += size
    const writable = response.write(chunk.subarray(0, size))
    if (transfer.sentBytes === transfer.totalBytes) {
      transfer.completed = true
      response.end()
    } else if (writable) {
      // Pace the real socket stream so workerd cancellation stops the producer before the full payload is sent.
      transfer.timer = setTimeout(writeNext, 1)
    } else {
      onDrain = () => {
        onDrain = undefined
        transfer.timer = setTimeout(writeNext, 1)
      }
      response.once('drain', onDrain)
    }
  }
  writeNext()
}

beforeAll(async () => {
  trapServer = createServer((request, response) => {
    trapRequests.push(request.url ?? '')
    response.writeHead(200, { 'content-type': 'image/png' })
    response.end(png)
  })
  trapOrigin = await listen(trapServer)

  fixtureServer = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture.invalid').pathname
    fixtureRequests.push(path)

    if (path === `${storagePath}redirect.png`) {
      response.writeHead(302, { location: `${trapOrigin}${storagePath}forbidden.png` })
      response.end()
      return
    }
    if (path === `${storagePath}oversized.png`) {
      createOversizedResponse(response)
      return
    }
    if (path === `${storagePath}valid.png`) {
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      response.end(png)
      return
    }
    response.writeHead(404)
    response.end()
  })
  fixtureOrigin = await listen(fixtureServer)

  tempDirectory = await mkdtemp(join(projectRoot, '.image-workerd-regression-'))
  const entryPath = join(tempDirectory, 'worker.ts')
  const configPath = join(tempDirectory, 'wrangler.jsonc')
  const imageModule = resolve(projectRoot, 'src/lib/pdf/engine/image.ts')
  const workerSource = `
import { PDFDocument } from 'pdf-lib'
import { embedImage } from ${JSON.stringify(imageModule)}

export default {
  async fetch(request: Request): Promise<Response> {
    const asset = new URL(request.url).searchParams.get('asset')
    if (asset !== 'valid' && asset !== 'redirect' && asset !== 'oversized') {
      return new Response('Unknown test asset', { status: 404 })
    }
    const source = \`\${process.env.SUPABASE_URL}${storagePath}\${asset}.png\`
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([24, 24])
    const image = await embedImage(pdf, source)
    if (!image) return new Response(JSON.stringify({ embedded: false }), {
      status: 422,
      headers: { 'content-type': 'application/json' },
    })
    page.drawImage(image, { x: 0, y: 0, width: 24, height: 24 })
    return new Response(await pdf.save(), { headers: { 'content-type': 'application/pdf' } })
  },
}
`
  await writeFile(entryPath, workerSource)
  await writeFile(configPath, JSON.stringify({
    name: `pdf-image-regression-${randomUUID()}`,
    main: entryPath,
    compatibility_date: '2026-10-23',
    compatibility_flags: ['nodejs_compat'],
    vars: { SUPABASE_URL: fixtureOrigin },
    send_metrics: false,
    observability: { enabled: false },
  }, null, 2))

  // Only these non-secret Wrangler control flags are read/restored; envFiles and the isolated config keep host variables out of the Worker.
  const inheritedProcessEnv = process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV
  const inheritedMetrics = process.env.WRANGLER_SEND_METRICS
  process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = 'false'
  process.env.WRANGLER_SEND_METRICS = 'false'
  try {
    worker = await unstable_dev(entryPath, {
      config: configPath,
      envFiles: [],
      port: 0,
      inspectorPort: 0,
      local: true,
      persist: false,
      logLevel: 'none',
      experimental: { disableExperimentalWarning: true, disableDevRegistry: true, forceLocal: true },
    })
  } finally {
    if (inheritedProcessEnv === undefined) delete process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV
    else process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = inheritedProcessEnv
    if (inheritedMetrics === undefined) delete process.env.WRANGLER_SEND_METRICS
    else process.env.WRANGLER_SEND_METRICS = inheritedMetrics
  }
}, 30_000)

afterAll(async () => {
  const cleanupErrors: unknown[] = []
  try {
    await worker?.stop()
  } catch (error) {
    cleanupErrors.push(error)
  }
  for (const server of [fixtureServer, trapServer]) {
    try {
      await close(server)
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (tempDirectory) {
    try {
      await rm(tempDirectory, { recursive: true, force: true })
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Could not clean up the isolated workerd regression fixture')
}, 15_000)

function workerResponse(asset: 'valid' | 'redirect' | 'oversized') {
  if (!worker) throw new Error('The isolated workerd fixture did not start')
  return worker.fetch(`/pdf?asset=${asset}`)
}

// This timeout guards a missing close event; fake timers cannot drive workerd's real network reader.
async function closesWithin(promise: Promise<void>, milliseconds: number): Promise<boolean> {
  const timeout = Promise.withResolvers<boolean>()
  const timer = setTimeout(() => timeout.resolve(false), milliseconds)
  const closed = await Promise.race([promise.then(() => true), timeout.promise])
  clearTimeout(timer)
  return closed
}

describe('actual workerd PDF image embedding', () => {
  it('embeds the configured Storage PNG in a real PDF', async () => {
    fixtureRequests.length = 0
    const response = await workerResponse('valid')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')

    const pdf = await PDFDocument.load(await response.arrayBuffer())
    expect(pdf.getPageCount()).toBe(1)
    const embeddedImages = pdf.context.enumerateIndirectObjects().filter(([, object]) => (
      object instanceof PDFRawStream
      && object.dict.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText() === 'Image'
    ))
    expect(embeddedImages).toHaveLength(1)
    const imageStream = embeddedImages[0]?.[1]
    if (!(imageStream instanceof PDFRawStream)) throw new Error('Expected the generated PDF to contain an image stream')
    expect(imageStream.dict.lookup(PDFName.of('Width'), PDFNumber).asNumber()).toBe(1)
    expect(fixtureRequests).toEqual([`${storagePath}valid.png`])
  })

  it('rejects a redirect without requesting the forbidden loopback origin', async () => {
    fixtureRequests.length = 0
    trapRequests.length = 0
    const response = await workerResponse('redirect')
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ embedded: false })
    expect(fixtureRequests).toEqual([`${storagePath}redirect.png`])
    expect(trapRequests).toEqual([])
  })

  it('cancels an oversized chunked response before the producer completes', async () => {
    fixtureRequests.length = 0
    oversizedTransfer = undefined
    const response = await workerResponse('oversized')
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ embedded: false })
    expect(fixtureRequests).toEqual([`${storagePath}oversized.png`])

    // The node:http callback records this after the Worker makes its request; TS cannot observe that mutation across the SDK boundary.
    const transfer = oversizedTransfer as OversizedTransfer | undefined
    if (!transfer) throw new Error('The oversize fixture did not receive the image request')
    expect(transfer.hasContentLength).toBe(false)
    await expect(closesWithin(transfer.closed, 3_000)).resolves.toBe(true)
    expect(transfer.cancelled).toBe(true)
    expect(transfer.completed).toBe(false)
    expect(transfer.sentBytes).toBeLessThan(transfer.totalBytes)
  })
})
