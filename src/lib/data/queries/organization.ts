import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCachedOrganizationId } from './session-cache'
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
  // Garantie décennale (migration 064)
  decennale_enabled: boolean | null
  decennale_assureur: string | null
  decennale_police: string | null
  decennale_couverture: string | null
  decennale_date_debut: string | null
  decennale_date_fin: string | null
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
  public_form_catalog_item_ids: Array<{ id: string; item_type: 'material' | 'labor' | 'prestation' }> | null
  public_form_custom_mode_enabled: boolean
  public_form_notification_email: string | null
  // Suppression de compte RGPD (optionnel — champ ajouté par migration 060)
  deletion_requested_at?: string | null
  deletion_scheduled_at?: string | null
  // Email & documents (migration 061)
  email_signature?: string | null
  cgv_text?: string | null
  reminder_first_delay_days?: number | null
  // Validité devis par défaut (migration 065)
  default_quote_validity_days?: number | null
  // Rentabilité chantiers (migration 067)
  default_labor_cost_per_hour?: number | null
  default_hourly_rate?: number | null
  // Rapport mensuel auto aux membres individuels (migration 073)
  auto_send_member_reports?: boolean | null
}

export const getOrganization = cache(async (): Promise<Organization | null> => {
  const orgId = await getCachedOrganizationId()
  if (!orgId) return null

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, slug, siret, siren, vat_number, email, phone, address_line1, address_line2, city, postal_code, country, logo_url, email_from_name, email_from_address, forme_juridique, capital_social, rcs, rcs_ville, insurance_info, certifications, primary_color, payment_terms_days, late_penalty_rate, court_competent, iban, bic, bank_name, recovery_indemnity_text, auto_reminder_enabled, invoice_reminder_days, quote_reminder_days, reminder_hour_utc, sector, business_profile, business_activity_id, label_set, unit_set, default_categories, starter_presets, is_vat_subject, default_vat_rate, public_form_enabled, public_form_welcome_message, public_form_catalog_item_ids, public_form_custom_mode_enabled, public_form_notification_email, deletion_requested_at, deletion_scheduled_at, email_signature, cgv_text, reminder_first_delay_days, decennale_enabled, decennale_assureur, decennale_police, decennale_couverture, decennale_date_debut, decennale_date_fin, default_quote_validity_days, default_labor_cost_per_hour, default_hourly_rate, auto_send_member_reports')
    .eq('id', orgId)
    .single()

  if (error) {
    console.error('[getOrganization]', error)
    return null
  }

  return data as Organization
})
