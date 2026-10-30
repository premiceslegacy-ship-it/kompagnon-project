import { describe, expect, it } from 'vitest'
import {
  canonicalQuoteAttachmentMimeType,
  isOpaqueMigratedQuoteAttachmentStoragePath,
  isQuoteAttachmentMimeType,
  isSafeQuoteAttachmentOrganizationSlug,
  isValidQuoteAttachmentStoragePath,
  safeQuoteAttachmentFilename,
} from '@/lib/quote-attachments'

describe('quote attachment upload validation', () => {
  it('accepts a correctly signed PDF and canonicalizes an empty browser MIME type', () => {
    expect(canonicalQuoteAttachmentMimeType({
      filename: 'plan.pdf',
      declaredMimeType: '',
      signature: new TextEncoder().encode('%PDF-1.7'),
    })).toBe('application/pdf')
  })

  it('rejects a MIME/extension mismatch and unsupported format', () => {
    const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(canonicalQuoteAttachmentMimeType({
      filename: 'plan.pdf',
      declaredMimeType: 'application/pdf',
      signature: pngSignature,
    })).toBeNull()
    expect(canonicalQuoteAttachmentMimeType({
      filename: 'archive.zip',
      declaredMimeType: 'application/zip',
      signature: pngSignature,
    })).toBeNull()
  })

  it('supports advertised DWG and DXF files only when their signatures match', () => {
    expect(canonicalQuoteAttachmentMimeType({
      filename: 'plan.dwg',
      declaredMimeType: 'application/octet-stream',
      signature: new TextEncoder().encode('AC1021'),
    })).toBe('application/acad')
    expect(canonicalQuoteAttachmentMimeType({
      filename: 'plan.dxf',
      declaredMimeType: 'application/dxf',
      signature: new TextEncoder().encode('0\nSECTION\n2\nHEADER\n'),
    })).toBe('application/dxf')
    expect(isQuoteAttachmentMimeType('application/acad')).toBe(true)
    expect(isQuoteAttachmentMimeType('application/octet-stream')).toBe(false)
  })
})

describe('quote attachment storage scope', () => {
  it('accepts safe dotted slugs and rejects path separators or traversal segments', () => {
    expect(isSafeQuoteAttachmentOrganizationSlug('atelier.orsayn')).toBe(true)
    expect(isSafeQuoteAttachmentOrganizationSlug('../other')).toBe(false)
    expect(isSafeQuoteAttachmentOrganizationSlug('..')).toBe(false)
  })

  it('accepts only one safe filename under the immutable organization UUID prefix', () => {
    const organizationId = '11111111-1111-4111-8111-111111111111'
    expect(isValidQuoteAttachmentStoragePath(`quote-requests/${organizationId}/1234-abcd.pdf`, organizationId)).toBe(true)
    expect(isValidQuoteAttachmentStoragePath(`quote-requests/${organizationId}/migrated-${'a'.repeat(64)}.pdf`, organizationId)).toBe(true)
    const opaqueMigrationPath = `quote-requests/${organizationId}/migrated-${'a'.repeat(64)}.bin`
    expect(isOpaqueMigratedQuoteAttachmentStoragePath(opaqueMigrationPath, organizationId)).toBe(true)
    expect(isValidQuoteAttachmentStoragePath(opaqueMigrationPath, organizationId)).toBe(true)
    expect(isOpaqueMigratedQuoteAttachmentStoragePath(`quote-requests/${organizationId}/migrated-${'A'.repeat(64)}.bin`, organizationId)).toBe(false)
    expect(isValidQuoteAttachmentStoragePath(`quote-requests/${organizationId}/arbitrary.bin`, organizationId)).toBe(false)
    expect(canonicalQuoteAttachmentMimeType({
      filename: 'arbitrary.bin',
      declaredMimeType: 'application/octet-stream',
      signature: new Uint8Array([0, 1, 2, 3]),
    })).toBeNull()
    expect(isValidQuoteAttachmentStoragePath(`quote-requests/${organizationId}/../other.pdf`, organizationId)).toBe(false)
    expect(isValidQuoteAttachmentStoragePath(`quote-requests/${organizationId}/nested/1234.pdf`, organizationId)).toBe(false)
    expect(isValidQuoteAttachmentStoragePath('quote-requests/acme/1234-abcd.pdf', organizationId)).toBe(false)
    expect(isValidQuoteAttachmentStoragePath('quote-requests/22222222-2222-4222-8222-222222222222/1234-abcd.pdf', organizationId)).toBe(false)
    expect(isValidQuoteAttachmentStoragePath(`quote-requests/${organizationId}/1234-abcd.pdf`, 'acme')).toBe(false)
  })

  it('removes path separators and control characters from download names', () => {
    expect(safeQuoteAttachmentFilename('../plan\r\n.pdf')).toBe('.._plan__.pdf')
  })

  it('keeps the PDF extension so a long upload remains readable and submittable', () => {
    const filename = safeQuoteAttachmentFilename(`${'a'.repeat(121)}.pdf`)
    expect(canonicalQuoteAttachmentMimeType({
      filename,
      declaredMimeType: 'application/pdf',
      signature: new TextEncoder().encode('%PDF-1.7'),
    })).toBe('application/pdf')
    expect(filename.length).toBeLessThanOrEqual(120)
  })

  it('keeps a long Unicode download name encodable in Content-Disposition', () => {
    const filename = safeQuoteAttachmentFilename(`a${'🧰'.repeat(80)}.pdf`)
    expect(decodeURIComponent(encodeURIComponent(filename))).toBe(filename)
    expect(filename.endsWith('.pdf')).toBe(true)
  })
})
