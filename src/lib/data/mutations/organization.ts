'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { hasPermission } from '@/lib/data/queries/membership'
import type { BusinessActivityId, BusinessProfile, CatalogLabelSet, DefaultCategories, StarterPreset } from '@/lib/catalog-context'

export type UpdateOrganizationInput = {
  name?: string
  siret?: string
  siren?: string
  vat_number?: string
  email?: string
  phone?: string
  address_line1?: string | null
  city?: string | null
  postal_code?: string | null
  country?: string
  logo_url?: string | null
  // Mentions légales
  forme_juridique?: string | null
  capital_social?: string | null
  rcs?: string | null
  rcs_ville?: string | null
  insurance_info?: string | null
  certifications?: string | null
  // Garantie décennale (migration 064)
  decennale_enabled?: boolean | null
  decennale_assureur?: string | null
  decennale_police?: string | null
  decennale_couverture?: string | null
  decennale_date_debut?: string | null
  decennale_date_fin?: string | null
  // Paiement & RIB
  iban?: string | null
  bic?: string | null
  bank_name?: string | null
  payment_terms_days?: number | null
  late_penalty_rate?: number | null
  court_competent?: string | null
  recovery_indemnity_text?: string | null
  // Relances automatiques
  auto_reminder_enabled?: boolean
  invoice_reminder_days?: number[]
  quote_reminder_days?: number[]
  reminder_hour_utc?: number
  // Secteur d'activité
  sector?: string
  business_profile?: BusinessProfile
  business_activity_id?: BusinessActivityId
  label_set?: CatalogLabelSet
  unit_set?: string[]
  default_categories?: DefaultCategories
  starter_presets?: StarterPreset[]
  // TVA
  is_vat_subject?: boolean
  default_vat_rate?: number | null
  // Email & documents (migration 061)
  email_signature?: string | null
  cgv_text?: string | null
  reminder_first_delay_days?: number | null
  // Validité devis par défaut (migration 065)
  default_quote_validity_days?: number | null
  // Rentabilité chantiers (migration 067)
  default_labor_cost_per_hour?: number | null
  // Rapports membres mensuels (migration 073)
  auto_send_member_reports?: boolean
}

/**
 * Met à jour les informations de l'organisation de l'utilisateur connecté.
 */
export async function updateOrganization(input: UpdateOrganizationInput): Promise<{ error?: string }> {
  if (!(await hasPermission('settings.edit_org'))) return { error: 'Permission refusée.' }

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: 'Non authentifié' }

  const { data: membership } = await supabase
    .from('memberships')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (!membership?.organization_id) return { error: 'Organisation introuvable' }

  const { error } = await supabase
    .from('organizations')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', membership.organization_id)

  if (error) {
    console.error('[updateOrganization]', error)
    return { error: error.message }
  }

  revalidatePath('/', 'layout')
  revalidatePath('/settings')
  revalidatePath('/catalog')
  return {}
}
