import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCachedOrganizationId } from './session-cache'
import { normalizeEinvoicingConfigFromDb, type EinvoicingConfig } from '@/lib/einvoicing-config'

async function _getOrganizationEinvoicingConfig(): Promise<EinvoicingConfig> {
  const orgId = await getCachedOrganizationId()
  if (!orgId) return normalizeEinvoicingConfigFromDb(null)

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('organization_einvoicing_config')
    .select('mode, provider, environment, annuaire_status, oauth_status, oauth_connected_at, super_pdp_connection_id, super_pdp_emission_enabled, super_pdp_reception_enabled')
    .eq('organization_id', orgId)
    .maybeSingle()

  if (error) {
    console.error('[getOrganizationEinvoicingConfig]', error)
    return normalizeEinvoicingConfigFromDb(null)
  }

  return normalizeEinvoicingConfigFromDb(data && {
    ...data,
    emission_enabled: data.super_pdp_emission_enabled,
    reception_enabled: data.super_pdp_reception_enabled,
  })
}

export const getOrganizationEinvoicingConfig = cache(_getOrganizationEinvoicingConfig)
