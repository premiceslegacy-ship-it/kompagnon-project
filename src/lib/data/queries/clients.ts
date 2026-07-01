import { createClient } from '@/lib/supabase/server'
import { getCachedOrganizationId } from './session-cache'

export type ClientStatus = 'active' | 'prospect' | 'lead_hot' | 'lead_cold' | 'subcontractor' | 'inactive'

export type Client = {
  id: string
  organization_id: string
  type: string
  company_name: string | null
  contact_name: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  siret: string | null
  address_line1: string | null
  city: string | null
  postal_code: string | null
  status: ClientStatus | null
  source: string | null
  total_revenue: number
  payment_terms_days: number
  internal_notes: string | null
  created_at: string
}

/**
 * Récupère tous les clients de l'organisation courante.
 * Se base sur le membership de l'utilisateur connecté pour déterminer l'organisation.
 */
export async function getClients(): Promise<Client[]> {
  const orgId = await getCachedOrganizationId()
  if (!orgId) return []

  const supabase = await createClient()

  const [{ data, error }, { data: revenueRows }] = await Promise.all([
    supabase
      .from('clients')
      .select(`
        id, organization_id, type, company_name, contact_name, first_name, last_name,
        email, phone, siret, address_line1, city, postal_code, status, source,
        payment_terms_days, internal_notes, created_at
      `)
      .eq('organization_id', orgId)
      .eq('is_archived', false)
      .order('created_at', { ascending: false }),
    supabase
      .from('invoices')
      .select('client_id, total_ttc')
      .eq('organization_id', orgId)
      .eq('status', 'paid')
      .eq('is_archived', false),
  ])

  if (error) {
    console.error('[getClients]', error)
    return []
  }

  const revenueByClient: Record<string, number> = {}
  for (const inv of revenueRows ?? []) {
    if (inv.client_id) revenueByClient[inv.client_id] = (revenueByClient[inv.client_id] ?? 0) + (inv.total_ttc ?? 0)
  }

  return (data ?? []).map((c: any) => ({
    ...c,
    total_revenue: revenueByClient[c.id] ?? 0,
  } as Client))
}

/**
 * Récupère l'organization_id de l'utilisateur connecté.
 * Utile pour les mutations. Dédupliqué via React cache() dans session-cache.
 */
export async function getCurrentOrganizationId(): Promise<string | null> {
  return getCachedOrganizationId()
}

/**
 * Récupère un client par son ID (vérifie qu'il appartient à l'org courante).
 */
export async function getClientById(clientId: string): Promise<Client | null> {
  const orgId = await getCachedOrganizationId()
  if (!orgId) return null

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('clients')
    .select('*, paid_invoices:invoices!client_id(total_ttc)')
    .eq('id', clientId)
    .eq('organization_id', orgId)
    .eq('paid_invoices.status', 'paid')
    .eq('paid_invoices.is_archived', false)
    .single()

  if (error || !data) return null

  const paidInvoices: Array<{ total_ttc: number }> = (data as any).paid_invoices ?? []
  const total_revenue = paidInvoices.reduce((sum, inv) => sum + (inv.total_ttc ?? 0), 0)

  const { paid_invoices: _inv, ...rest } = data as any
  return { ...rest, total_revenue } as Client
}
