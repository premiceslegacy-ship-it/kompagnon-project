'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from './clients'
import type { SupplierPriceRequest } from '@/lib/data/mutations/supplier-price-requests'

export async function getSupplierPriceRequestsForQuote(quoteId: string): Promise<SupplierPriceRequest[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('supplier_price_requests')
    .select('*, supplier:suppliers(id, name)')
    .eq('organization_id', orgId)
    .eq('quote_id', quoteId)
    .order('created_at', { ascending: true })

  if (error) { console.error('[getSupplierPriceRequestsForQuote]', error); return [] }
  return (data ?? []) as SupplierPriceRequest[]
}

export async function getAllSupplierPriceRequests(): Promise<SupplierPriceRequest[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('supplier_price_requests')
    .select('*, supplier:suppliers(id, name)')
    .eq('organization_id', orgId)
    .not('status', 'eq', 'integre')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) { console.error('[getAllSupplierPriceRequests]', error); return [] }
  return (data ?? []) as SupplierPriceRequest[]
}
