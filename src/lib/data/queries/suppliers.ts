import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from './clients'

export type Supplier = {
  id: string
  organization_id: string
  name: string
  contact_name: string | null
  email: string | null
  phone: string | null
  address: string | null
  siret: string | null
  payment_terms: string | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export async function getSuppliers(): Promise<Supplier[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) {
    console.error('[getSuppliers]', error)
    return []
  }

  return (data ?? []) as Supplier[]
}

export async function getSupplierById(id: string): Promise<Supplier | null> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return null

  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .eq('id', id)
    .eq('organization_id', orgId)
    .single()

  if (error) {
    console.error('[getSupplierById]', error)
    return null
  }

  return data as Supplier
}
