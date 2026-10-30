// Non-régression de la validation de signature manuscrite (audit du 26/10/2026).
// Avant correctif, seul le préfixe `data:image/` était contrôlé : une valeur
// tronquée marquait le devis accepté sans preuve, et un PNG aux dimensions
// énormes faisait gonfler la décompression à chaque rendu PDF.

import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { normalizeSignatureImage } from '@/lib/security'

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex')

function pngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  chunk.write(type, 4, 'ascii')
  data.copy(chunk, 8)

  let crc = 0xffffffff
  const crcInput = Buffer.concat([Buffer.from(type, 'ascii'), data])
  for (const byte of crcInput) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length)
  return chunk
}

function pngDataUrl(width: number, height: number): string {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6

  const scanlines = Buffer.alloc((width * 4 + 1) * height)
  const png = Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
  return `data:image/png;base64,${png.toString('base64')}`
}

const VALID = pngDataUrl(300, 120)
const TOO_WIDE = pngDataUrl(2001, 120)

describe('normalizeSignatureImage', () => {
  it('accepte un PNG de dimensions raisonnables', () => {
    expect(normalizeSignatureImage(VALID)).toBe(VALID)
  })

  it('accepts the capped high-DPI backing dimensions used by the signature pad', () => {
    const output = pngDataUrl(2000, 643)
    expect(normalizeSignatureImage(output)).toBe(output)
  })

  it('refuse une valeur vide ou absente', () => {
    expect(normalizeSignatureImage(null)).toBeNull()
    expect(normalizeSignatureImage('')).toBeNull()
  })

  it('refuse un préfixe non PNG (SVG non rendu par pdf-lib)', () => {
    expect(normalizeSignatureImage('data:image/svg+xml;base64,PHN2Zy8+')).toBeNull()
    expect(normalizeSignatureImage('data:image/jpeg;base64,/9j/4AAQ')).toBeNull()
  })

  it('refuse un base64 tronqué', () => {
    expect(normalizeSignatureImage('data:image/png;base64,AAAA')).toBeNull()
  })

  it('refuse un PNG aux dimensions excessives', () => {
    expect(normalizeSignatureImage(TOO_WIDE)).toBeNull()
  })

  it('refuse une data URL sans base64 valide', () => {
    expect(normalizeSignatureImage('data:image/png;base64,!!!!')).toBeNull()
  })
})
