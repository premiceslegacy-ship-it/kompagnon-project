import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { crc32 } from 'node:zlib'
import { PDFDocument } from 'pdf-lib'
import { embedImage } from '@/lib/pdf/engine/image'
import { loadPdfImage, MAX_PDF_IMAGE_BYTES } from '@/lib/pdf/engine/image-source'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO/jWkQAAAAASUVORK5CYII=', 'base64')
let server: Server
let origin: string
const requests: string[] = []
const storagePath = '/storage/v1/object/public/logos/'

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? ''
    requests.push(path)
    if (path === `${storagePath}redirect.png`) {
      res.writeHead(302, { location: `${origin}/internal-secret.png` })
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    if (path === `${storagePath}oversized.png`) {
      res.write(png)
      res.end(Buffer.alloc(MAX_PDF_IMAGE_BYTES + 1))
      return
    }
    res.end(png)
  })
  const ready = Promise.withResolvers<void>()
  server.once('error', ready.reject)
  server.listen(0, '127.0.0.1', ready.resolve)
  await ready.promise
  server.off('error', ready.reject)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected a local fixture socket')
  origin = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  server.closeAllConnections()
  const closed = Promise.withResolvers<void>()
  server.close(error => error ? closed.reject(error) : closed.resolve())
  await closed.promise
})

beforeEach(() => {
  requests.length = 0
  vi.stubEnv('SUPABASE_URL', origin)
})

afterEach(() => vi.unstubAllEnvs())

describe('PDF image resource authority', () => {
  it('embeds a managed PNG from its actual bytes even with a generic MIME type', async () => {
    const doc = await PDFDocument.create()
    const image = await embedImage(doc, `${origin}${storagePath}valid.png`)
    expect(image?.width).toBe(1)
    expect(image?.height).toBe(1)
    expect(requests).toEqual([`${storagePath}valid.png`])
  })

  it('does not contact an internal non-Storage endpoint even on the configured host', async () => {
    const doc = await PDFDocument.create()
    expect(await embedImage(doc, `${origin}/internal-secret.png`)).toBeNull()
    expect(requests).toEqual([])
  })

  it('does not contact an unmanaged origin that uses a Storage-looking path', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://different-project.supabase.co')
    expect(await loadPdfImage(`${origin}${storagePath}valid.png`)).toBeNull()
    expect(requests).toEqual([])
  })

  it('does not follow a managed image redirect to a different resource', async () => {
    const doc = await PDFDocument.create()
    expect(await embedImage(doc, `${origin}${storagePath}redirect.png`)).toBeNull()
    expect(requests).toEqual([`${storagePath}redirect.png`])
  })

  it('rejects an oversized chunked response before handing bytes to the decoder', async () => {
    expect(await loadPdfImage(`${origin}${storagePath}oversized.png`)).toBeNull()
    expect(requests).toEqual([`${storagePath}oversized.png`])
  })

  it('applies the same byte limit to inline images as remote images', async () => {
    const oversized = Buffer.alloc(MAX_PDF_IMAGE_BYTES + 1)
    png.copy(oversized)
    expect(await loadPdfImage(`data:image/png;base64,${oversized.toString('base64')}`)).toBeNull()
    expect(requests).toEqual([])
  })

  it('rejects excessive PNG geometry before a decoder can allocate its pixel buffer', async () => {
    const oversizedGeometry = Buffer.from(png)
    oversizedGeometry.writeUInt32BE(4096, 16)
    oversizedGeometry.writeUInt32BE(4096, 20)
    oversizedGeometry.writeUInt32BE(crc32(oversizedGeometry.subarray(12, 29)), 29)
    expect(await loadPdfImage(`data:image/png;base64,${oversizedGeometry.toString('base64')}`)).toBeNull()
  })
})
