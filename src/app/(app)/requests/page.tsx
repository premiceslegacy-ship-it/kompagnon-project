import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import RequestsClient from './RequestsClient'

export type CatalogRequestItem = {
  id: string
  item_type: 'material' | 'labor'
  description: string
  unit: string | null
  unit_price: number
  quantity: number
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
  attachment_url: string | null
  type: string
  catalog_items: CatalogRequestItem[] | null
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
    .select('id, name, email, phone, company_name, subject, description, prestation_type, dimensions, attachment_url, type, catalog_items, chantier_address_line1, chantier_postal_code, chantier_city, status, client_id, quote_id, created_at')
    .eq('organization_id', orgId)
    .neq('status', 'archived')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[getQuoteRequests]', error)
    return []
  }
  return (data ?? []) as QuoteRequest[]
}

export default async function RequestsPage() {
  const requests = await getQuoteRequests()
  return <RequestsClient initialRequests={requests} />
}
