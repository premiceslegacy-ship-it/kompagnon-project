import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import {
  canonicalQuoteAttachmentMimeType,
  isOpaqueMigratedQuoteAttachmentStoragePath,
  isQuoteAttachmentMimeType,
  isValidQuoteAttachmentStoragePath,
  QUOTE_ATTACHMENT_BUCKET,
  QUOTE_ATTACHMENT_MAX_BYTES,
  safeQuoteAttachmentFilename,
} from '@/lib/quote-attachments'

export const dynamic = 'force-dynamic'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i


function notFound() {
  return new NextResponse('Fichier introuvable.', { status: 404, headers: { 'Cache-Control': 'no-store' } })
}

function contentDisposition(filename: string): string {
  const safe = safeQuoteAttachmentFilename(filename)
  const fallback = safe.replace(/[^\x20-\x7e]|["\\;]/g, '_') || 'piece-jointe'
  const encoded = encodeURIComponent(safe).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID_RE.test(id)) return notFound()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Non authentifié.', { status: 401, headers: { 'Cache-Control': 'no-store' } })

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return new NextResponse('Organisation introuvable.', { status: 403, headers: { 'Cache-Control': 'no-store' } })
  if (!await hasPermission('leads.manage')) return new NextResponse('Action non autorisée.', { status: 403, headers: { 'Cache-Control': 'no-store' } })

  const admin = createAdminClient()
  const { data: request, error: requestError } = await admin.from('quote_requests')
    .select('id, attachments')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (requestError || !request) return notFound()

  const attachmentRows = Array.isArray(request.attachments) ? request.attachments : []
  const firstAttachment = attachmentRows.find((item: unknown) =>
    item && typeof item === 'object' && typeof (item as Record<string, unknown>).storage_path === 'string',
  ) as Record<string, unknown> | undefined
  const path = typeof firstAttachment?.storage_path === 'string' ? firstAttachment.storage_path : null
  if (!path || !isValidQuoteAttachmentStoragePath(path, organizationId)) return notFound()

  const { data: ownership, error: ownershipError } = await admin
    .from('quote_attachment_object_ownership')
    .select('object_path')
    .eq('object_path', path)
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (ownershipError || !ownership) return notFound()

  const { data: file, error } = await admin.storage.from(QUOTE_ATTACHMENT_BUCKET).download(path)
  if (error || !file || file.size < 1 || file.size > QUOTE_ATTACHMENT_MAX_BYTES) return notFound()

  const filename = safeQuoteAttachmentFilename(
    typeof firstAttachment?.filename === 'string' ? firstAttachment.filename : path.split('/').pop() ?? 'piece-jointe',
  )
  const declaredMimeType = typeof firstAttachment?.content_type === 'string'
    ? firstAttachment.content_type
    : file.type
  const isOpaqueMigrationObject = isOpaqueMigratedQuoteAttachmentStoragePath(path, organizationId)
  let contentType: string
  if (isOpaqueMigrationObject) {
    contentType = 'application/octet-stream'
  } else {
    const signature = new Uint8Array(await file.slice(0, 32).arrayBuffer())
    const detectedContentType = canonicalQuoteAttachmentMimeType({ filename, declaredMimeType, signature })
    if (!detectedContentType || !isQuoteAttachmentMimeType(detectedContentType)) return notFound()
    contentType = detectedContentType
  }

  return new Response(file, {
    status: 200,
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Disposition': contentDisposition(filename),
      'Content-Length': String(file.size),
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
