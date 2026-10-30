export type PdfOrganizationData = {
  id: string
  name: string
  siret: string | null
  siren: string | null
  vat_number: string | null
  email: string
  email_from_name: string | null
  email_from_address: string | null
  phone: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  postal_code: string | null
  country: string | null
  logo_url: string | null
  forme_juridique: string | null
  capital_social: string | number | null
  rcs: string | null
  rcs_ville: string | null
  insurance_info: string | null
  certifications: string | string[] | null
  decennale_enabled: boolean | null
  decennale_assureur: string | null
  decennale_police: string | null
  decennale_couverture: string | null
  decennale_date_debut: string | null
  decennale_date_fin: string | null
  payment_terms_days: number | null
  late_penalty_rate: number | null
  iban: string | null
  bic: string | null
  bank_name: string | null
  court_competent: string | null
  signatory_name?: string | null
  recovery_indemnity_text: string | null
  is_vat_subject: boolean
}

export type QuoteDocumentClient = {
  id: string
  type: string
  company_name: string | null
  contact_name: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  address_line1: string | null
  postal_code: string | null
  city: string | null
  siret: string | null
}

export type QuoteDocumentItem = {
  id: string
  section_id: string | null
  description: string | null
  details: string | null
  designation: string | null
  quantity: number | null
  unit: string | null
  unit_price: number | null
  vat_rate: number | null
  length_m: number | null
  width_m: number | null
  height_m: number | null
  dim_quantity: number | null
  is_internal: boolean | null
  price_pending: boolean | null
}

export type QuoteDocumentSection = {
  id: string
  title: string | null
  items: QuoteDocumentItem[]
}

export type QuoteDocumentRecord = {
  id: string
  number: string | null
  title: string | null
  total_ht: number | null
  total_ttc: number | null
  currency: string
  validity_days: number
  valid_until: string | null
  sent_at: string | null
  signed_at?: string | null
  client_signature_image?: string | null
  client_signatory_name?: string | null
  client_signatory_role?: string | null
  created_at: string
  client_request_description: string | null
  client_request_visible_on_pdf: boolean
  notes_client: string | null
  payment_conditions: string | null
  show_section_subtotals: boolean
  sections: QuoteDocumentSection[]
  unsectionedItems: QuoteDocumentItem[]
}

export type InvoiceDocumentClient = {
  id: string
  type: string | null
  company_name: string | null
  contact_name?: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  address_line1: string | null
  postal_code: string | null
  city: string | null
  siret: string | null
  siren: string | null
  vat_number: string | null
}

export type InvoiceDocumentItem = {
  id: string
  description: string | null
  quantity: number | null
  unit: string | null
  unit_price: number
  vat_rate: number | null
  is_internal: boolean | null
  length_m: number | null
  width_m: number | null
  height_m: number | null
  dim_quantity: number | null
}

export type InvoiceDocumentRecord = {
  id: string
  number: string | null
  title: string | null
  status: string
  invoice_type: string | null
  total_ht: number | null
  total_tva: number | null
  total_ttc: number | null
  currency: string | null
  issue_date: string | null
  due_date: string | null
  sent_at: string | null
  created_at: string
  notes_client: string | null
  payment_conditions: string | null
  aid_label: string | null
  aid_amount: number | null
  quote_id: string | null
  client_id: string | null
  situation_number: number | null
  cumulative_pct: number | null
  period_from: string | null
  period_to: string | null
  retention_pct: number | null
  retention_amount: number | null
  market_reference: string | null
  is_reverse_charge: boolean
  quote_number: string | null
  client: InvoiceDocumentClient | null
  items: InvoiceDocumentItem[]
}
