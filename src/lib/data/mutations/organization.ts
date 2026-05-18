'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { hasPermission } from '@/lib/data/queries/membership'
import type { BusinessActivityId, BusinessProfile, CatalogLabelSet, DefaultCategories, StarterPreset } from '@/lib/catalog-context'
import { LEGAL_VAT_RATES } from '@/lib/utils'
import {
  normalizeBic,
  normalizeCommercialCourt,
  normalizeEmail,
  normalizeFrenchIban,
  normalizeFrenchVatNumber,
  normalizePostalCode,
  normalizeSiret,
  type OrganizationFieldErrors,
} from '@/lib/validations/organization'

export type UpdateOrganizationInput = {
  name?: string
  siret?: string | null
  siren?: string | null
  vat_number?: string | null
  email?: string | null
  phone?: string | null
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
  // Signataire par défaut des contrats (migration 084)
  signatory_name?: string | null
  signatory_role?: string | null
  signature_image?: string | null
  // Point de départ des tournées (migration 098)
  departure_address?: string | null
  departure_postal_code?: string | null
  departure_city?: string | null
}

/**
 * Met à jour les informations de l'organisation de l'utilisateur connecté.
 */
function hasInputKey<K extends keyof UpdateOrganizationInput>(input: UpdateOrganizationInput, key: K): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
}

function normalizeOrganizationInput(input: UpdateOrganizationInput): {
  payload: UpdateOrganizationInput
  fieldErrors: OrganizationFieldErrors
} {
  const payload: UpdateOrganizationInput = { ...input }
  const fieldErrors: OrganizationFieldErrors = {}

  if (hasInputKey(input, 'name')) {
    const name = input.name?.trim() ?? ''
    if (!name) fieldErrors.name = "Le nom de l'entreprise est obligatoire."
    else payload.name = name
  }

  if (hasInputKey(input, 'siret')) {
    const normalized = normalizeSiret(input.siret)
    payload.siret = normalized.value
    payload.siren = normalized.siren
    if (normalized.error) fieldErrors.siret = normalized.error
  }

  if (hasInputKey(input, 'vat_number')) {
    const normalized = normalizeFrenchVatNumber(input.vat_number)
    payload.vat_number = normalized.value
    if (normalized.error) fieldErrors.vat_number = normalized.error
  }

  if (hasInputKey(input, 'email')) {
    if (!input.email?.trim()) {
      fieldErrors.email = "L'email de contact est obligatoire."
    } else {
      const normalized = normalizeEmail(input.email)
      payload.email = normalized.value ?? ''
      if (normalized.error) fieldErrors.email = normalized.error
    }
  }

  if (hasInputKey(input, 'postal_code')) {
    const normalized = normalizePostalCode(input.postal_code)
    payload.postal_code = normalized.value
    if (normalized.error) fieldErrors.postal_code = normalized.error
  }

  if (hasInputKey(input, 'iban')) {
    const normalized = normalizeFrenchIban(input.iban)
    payload.iban = normalized.value
    if (normalized.error) fieldErrors.iban = normalized.error
  }

  if (hasInputKey(input, 'bic')) {
    const normalized = normalizeBic(input.bic)
    payload.bic = normalized.value
    if (normalized.error) fieldErrors.bic = normalized.error
  }

  if (hasInputKey(input, 'court_competent')) {
    payload.court_competent = normalizeCommercialCourt(input.court_competent)
  }

  if (hasInputKey(input, 'payment_terms_days')) {
    const days = input.payment_terms_days
    if (days != null && (!Number.isFinite(days) || days < 0 || days > 90)) {
      fieldErrors.payment_terms_days = 'Le délai de paiement doit être compris entre 0 et 90 jours.'
    }
  }

  if (hasInputKey(input, 'late_penalty_rate')) {
    const rate = input.late_penalty_rate
    if (rate != null && (!Number.isFinite(rate) || rate < 0 || rate > 100)) {
      fieldErrors.late_penalty_rate = 'Le taux de pénalités doit être compris entre 0 et 100 %.'
    }
  }

  if (hasInputKey(input, 'default_vat_rate')) {
    const rate = input.default_vat_rate
    if (rate != null && !LEGAL_VAT_RATES.includes(rate as typeof LEGAL_VAT_RATES[number])) {
      fieldErrors.default_vat_rate = 'Choisissez un taux de TVA légal : 0, 5,5, 10 ou 20 %.'
    }
  }

  return { payload, fieldErrors }
}

export async function updateOrganization(input: UpdateOrganizationInput): Promise<{ error?: string; fieldErrors?: OrganizationFieldErrors }> {
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

  const { payload, fieldErrors } = normalizeOrganizationInput(input)
  if (Object.keys(fieldErrors).length > 0) {
    return { error: 'Certains champs doivent être corrigés.', fieldErrors }
  }

  const { error } = await supabase
    .from('organizations')
    .update({ ...payload, updated_at: new Date().toISOString() })
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
