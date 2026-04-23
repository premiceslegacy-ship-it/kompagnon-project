import { createClient } from '@/lib/supabase/server'

export type ClientStatus = 'active' | 'prospect' | 'lead_hot' | 'lead_cold' | 'inactive'

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
  created_at: string
}

/**
 * Récupère tous les clients de l'organisation courante.
 * Se base sur le membership de l'utilisateur connecté pour déterminer l'organisation.
 */
export async function getClients(): Promise<Client[]> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return []

  // Récupère l'organisation via le membership
  const { data: membership } = await supabase
    .from('memberships')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (!membership?.organization_id) return []

  // Récupère les clients avec leurs factures pour calculer total_revenue en temps réel
  // (évite la dépendance au champ dénormalisé total_revenue maintenu par trigger sur payments)
  const { data, error } = await supabase
    .from('clients')
    .select(`
      id, organization_id, type, company_name, contact_name, first_name, last_name,
      email, phone, siret, address_line1, city, postal_code, status, source,
      payment_terms_days, created_at,
      invoices!client_id(total_ttc, status, is_archived)
    `)
    .eq('organization_id', membership.organization_id)
    .eq('is_archived', false)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[getClients]', error)
    return []
  }

  return (data ?? []).map((c: any) => {
    const invoices: Array<{ total_ttc: number; status: string; is_archived: boolean }> = c.invoices ?? []
    const total_revenue = invoices
      .filter(inv => inv.status === 'paid' && !inv.is_archived)
      .reduce((sum, inv) => sum + (inv.total_ttc ?? 0), 0)
    const { invoices: _inv, ...rest } = c
    return { ...rest, total_revenue } as Client
  })
}

/**
 * Récupère l'organization_id de l'utilisateur connecté.
 * Utile pour les mutations.
 */
export async function getCurrentOrganizationId(): Promise<string | null> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data } = await supabase
    .from('memberships')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  return data?.organization_id ?? null
}

/**
 * Récupère un client par son ID (vérifie qu'il appartient à l'org courante).
 */
export async function getClientById(clientId: string): Promise<Client | null> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: membership } = await supabase
    .from('memberships')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (!membership?.organization_id) return null

  const { data, error } = await supabase
    .from('clients')
    .select('*, invoices!client_id(total_ttc, status, is_archived)')
    .eq('id', clientId)
    .eq('organization_id', membership.organization_id)
    .single()

  if (error || !data) return null

  const invs: Array<{ total_ttc: number; status: string; is_archived: boolean }> = (data as any).invoices ?? []
  const total_revenue = invs
    .filter(inv => inv.status === 'paid' && !inv.is_archived)
    .reduce((sum, inv) => sum + (inv.total_ttc ?? 0), 0)

  const { invoices: _inv, ...rest } = data as any
  return { ...rest, total_revenue } as Client
}
