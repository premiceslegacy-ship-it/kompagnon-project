import { createClient } from '@/lib/supabase/server'
import type { BusinessActivityId, BusinessProfile, CatalogLabelSet, DefaultCategories, StarterPreset } from '@/lib/catalog-context'

export type Organization = {
  id: string
  name: string
  slug: string | null
  siret: string | null
  siren: string | null
  vat_number: string | null
  email: string
  phone: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  postal_code: string | null
  country: string | null
  logo_url: string | null
  email_from_name: string | null
  email_from_address: string | null
  // Mentions légales
  forme_juridique: string | null
  capital_social: string | null
  rcs: string | null
  rcs_ville: string | null
  insurance_info: string | null
  certifications: string | null
  primary_color: string | null
  // Paiement
  payment_terms_days: number | null
  late_penalty_rate: number | null
  court_competent: string | null
  iban: string | null
  bic: string | null
  bank_name: string | null
  recovery_indemnity_text: string | null
  // Relances automatiques
  auto_reminder_enabled: boolean | null
  invoice_reminder_days: number[] | null
  quote_reminder_days: number[] | null
  reminder_hour_utc: number | null
  // Secteur d'activité
  sector: string | null
  business_profile: BusinessProfile | null
  business_activity_id: BusinessActivityId | null
  label_set: CatalogLabelSet | null
  unit_set: string[] | null
  default_categories: DefaultCategories | null
  starter_presets: StarterPreset[] | null
  // TVA
  is_vat_subject: boolean
  default_vat_rate: number | null
  // Formulaire public
  public_form_enabled: boolean
  public_form_welcome_message: string | null
  public_form_catalog_item_ids: Array<{ id: string; item_type: 'material' | 'prestation' }> | null
  public_form_custom_mode_enabled: boolean
  public_form_notification_email: string | null
}

/**
 * Récupère les informations de l'organisation de l'utilisateur connecté.
 */
export async function getOrganization(): Promise<Organization | null> {
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
    .from('organizations')
    .select('id, name, slug, siret, siren, vat_number, email, phone, address_line1, address_line2, city, postal_code, country, logo_url, email_from_name, email_from_address, forme_juridique, capital_social, rcs, rcs_ville, insurance_info, certifications, primary_color, payment_terms_days, late_penalty_rate, court_competent, iban, bic, bank_name, recovery_indemnity_text, auto_reminder_enabled, invoice_reminder_days, quote_reminder_days, reminder_hour_utc, sector, business_profile, business_activity_id, label_set, unit_set, default_categories, starter_presets, is_vat_subject, default_vat_rate, public_form_enabled, public_form_welcome_message, public_form_catalog_item_ids, public_form_custom_mode_enabled, public_form_notification_email')
    .eq('id', membership.organization_id)
    .single()

  if (error) {
    console.error('[getOrganization]', error)
    return null
  }

  return data as Organization
}
