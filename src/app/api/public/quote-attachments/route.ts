import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import {
  canonicalQuoteAttachmentMimeType,
  isSafeQuoteAttachmentOrganizationSlug,
  QUOTE_ATTACHMENT_BUCKET,
  QUOTE_ATTACHMENT_MAX_BYTES,
  QUOTE_ATTACHMENT_MULTIPART_MAX_BYTES,
  safeQuoteAttachmentFilename,
} from '@/lib/quote-attachments'

export const dynamic = 'force-dynamic'

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

async function readBoundedBody(request: Request, maxBytes: number): Promise<ArrayBuffer | null> {
  if (!request.body) return new ArrayBuffer(0)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const buffer = new ArrayBuffer(total)
  const bytes = new Uint8Array(buffer)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return buffer
}

export async function POST(request: NextRequest) {
  const honeypotHeader = request.headers.get('x-public-form-honeypot') ?? ''
  if (honeypotHeader.length > 0) return response({ ignored: true })

  const url = new URL(request.url)
  const orgSlugs = url.searchParams.getAll('org_slug')
  const orgSlug = orgSlugs.length === 1 ? orgSlugs[0] : null
  if (!orgSlug || !isSafeQuoteAttachmentOrganizationSlug(orgSlug)) {
    return response({ error: 'Formulaire indisponible.' }, 400)
  }

  const contentType = request.headers.get('content-type') ?? ''
  if (!/^multipart\/form-data\s*;\s*boundary=/i.test(contentType)) {
    return response({ error: 'Format de fichier invalide.' }, 415)
  }
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength)
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0 || declaredBytes > QUOTE_ATTACHMENT_MULTIPART_MAX_BYTES) {
      return response({ error: 'Fichier trop volumineux (max 10 Mo).' }, 413)
    }
  }

  const admin = createAdminClient()
  const { data: organization } = await admin
    .from('organizations')
    .select('id, slug, public_form_enabled')
    .eq('slug', orgSlug)
    .eq('public_form_enabled', true)
    .maybeSingle()
  if (!organization) return response({ error: 'Formulaire indisponible.' }, 404)

  const rateLimit = await checkRateLimit({
    scope: 'public_quote_attachment_upload',
    identifier: `${organization.id}:${getClientIp(request.headers)}`,
    limit: Number.parseInt(process.env.PUBLIC_FORM_RATE_LIMIT_PER_HOUR ?? '5', 10),
    windowSeconds: 60 * 60,
  })
  if (!rateLimit.allowed) return response({ error: 'Trop de fichiers envoyés. Veuillez réessayer plus tard.' }, 429)

  const body = await readBoundedBody(request, QUOTE_ATTACHMENT_MULTIPART_MAX_BYTES)
  if (!body) return response({ error: 'Fichier trop volumineux (max 10 Mo).' }, 413)

  let formData: FormData
  try {
    formData = await new Request(request.url, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    }).formData()
  } catch {
    return response({ error: 'Formulaire invalide.' }, 400)
  }

  const allowedFields: Record<string, true> = { org_slug: true, _hp_website: true, file: true }
  if ([...formData.keys()].some((key) => allowedFields[key] !== true)) {
    return response({ error: 'Formulaire invalide.' }, 400)
  }
  const slugFields = formData.getAll('org_slug')
  const honeypotFields = formData.getAll('_hp_website')
  const fileFields = formData.getAll('file')
  if (slugFields.length !== 1 || slugFields[0] !== organization.slug
    || honeypotFields.length !== 1 || typeof honeypotFields[0] !== 'string'
    || fileFields.length !== 1 || !(fileFields[0] instanceof File)) {
    return response({ error: 'Formulaire invalide.' }, 400)
  }
  if (honeypotFields[0].length > 0) return response({ ignored: true })

  const file = fileFields[0]
  if (file.size < 1 || file.size > QUOTE_ATTACHMENT_MAX_BYTES) {
    return response({ error: 'Fichier trop volumineux ou vide (max 10 Mo).' }, 413)
  }
  const signature = new Uint8Array(await file.slice(0, 32).arrayBuffer())
  const mimeType = canonicalQuoteAttachmentMimeType({
    filename: file.name,
    declaredMimeType: file.type,
    signature,
  })
  if (!mimeType) return response({ error: 'Type de fichier non autorisé ou fichier invalide.' }, 415)

  const extension = file.name.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase()
  if (!extension) return response({ error: 'Type de fichier non autorisé ou fichier invalide.' }, 415)
  const path = `quote-requests/${organization.id}/${crypto.randomUUID()}.${extension}`
  const { data, error } = await admin.storage.from(QUOTE_ATTACHMENT_BUCKET).upload(path, file, {
    upsert: false,
    contentType: mimeType,
    cacheControl: '3600',
  })
  if (error || !data) {
    console.error('[quote-attachments/upload] storage upload failed', { organizationId: organization.id })
    return response({ error: 'Impossible de joindre le fichier.' }, 500)
  }

  return response({
    attachment: {
      storage_path: data.path,
      filename: safeQuoteAttachmentFilename(file.name),
      size: file.size,
      content_type: mimeType,
    },
  })
}
