import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import RequestsClient from './RequestsClient'
import { safeQuoteAttachmentFilename } from '@/lib/quote-attachments'

export type CatalogRequestItem = {
  id: string
  item_type: 'material' | 'labor' | 'prestation'
  description: string
  unit: string | null
  unit_price?: number
  quantity: number
}

export type RequestAttachment = {
  filename?: string
  size?: number
}

export type QuoteRequest = {
  id: string
  name: string
  email: string
  phone: string | null
  company_name: string | null
  subject: string | null
  description: string
  prestation_type: string | null
  dimensions: string | null
  has_attachment: boolean
  attachments: RequestAttachment[]
  type: string
  catalog_items: CatalogRequestItem[] | null
  freeform_notes: string | null
  chantier_address_line1: string | null
  chantier_postal_code: string | null
  chantier_city: string | null
  status: string
  client_id: string | null
  quote_id: string | null
  created_at: string
}

async function getQuoteRequests(): Promise<QuoteRequest[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('quote_requests')
    .select('id, name, email, phone, company_name, subject, description, prestation_type, dimensions, attachment_url, attachments, type, catalog_items, freeform_notes, chantier_address_line1, chantier_postal_code, chantier_city, status, client_id, quote_id, created_at')
    .eq('organization_id', orgId)
    .neq('status', 'archived')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[getQuoteRequests]', error)
    return []
  }
  return (data ?? []).map((row) => {
    const { attachment_url, attachments: rawAttachments, ...requestFields } = row
    const attachmentRows = Array.isArray(rawAttachments) ? rawAttachments : []
    const hasAttachment = Boolean(attachment_url) || attachmentRows.some((attachment: unknown) => {
      if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) return false
      const metadata = attachment as Record<string, unknown>
      return typeof metadata.storage_path === 'string' || typeof metadata.public_url === 'string'
    })
    const attachments = attachmentRows.flatMap((attachment: unknown) => {
      if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) return []
      const metadata = attachment as Record<string, unknown>
      return [{
        filename: typeof metadata.filename === 'string' ? safeQuoteAttachmentFilename(metadata.filename) : undefined,
        size: typeof metadata.size === 'number' ? metadata.size : undefined,
      }]
    })
    return { ...requestFields, has_attachment: hasAttachment, attachments }
  }) as QuoteRequest[]
}

export default async function RequestsPage() {
  const requests = await getQuoteRequests()
  return <RequestsClient initialRequests={requests} />
}
