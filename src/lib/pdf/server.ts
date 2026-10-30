import type { PdfOrganizationData, InvoiceDocumentRecord, QuoteDocumentClient, QuoteDocumentRecord } from '@/lib/pdf/document-types'
import { createAdminClient } from '@/lib/supabase/admin'
import { sanitizeFileName } from '@/lib/organization-exports/csv'
import { generateFacturXml } from '@/lib/pdf/facturx-xml'
import { embedFacturXml } from '@/lib/pdf/facturx-embed'
import { getMemberPointages } from '@/lib/data/queries/members'
import { renderQuotePdf } from '@/lib/pdf/documents/quote'
import { renderInvoicePdf } from '@/lib/pdf/documents/invoice'
import { renderChantierPdf } from '@/lib/pdf/documents/chantier'
import { renderMemberHoursReportPdf } from '@/lib/pdf/documents/member-hours-report'
import { renderContractPdf } from '@/lib/pdf/documents/contract'
import {
  contractDocumentSnapshotFromVerifiedPublication,
  type ContractDocumentPublicationRecord,
} from '@/lib/contracts/document-authority'
import { renderDgdPdf, type DgdLine } from '@/lib/pdf/documents/dgd'
import { z } from 'zod'
export const INVOICE_ISSUANCE_AUTHORITY_ERROR_MESSAGE =
  'Aucune autorité historique vérifiée n’est disponible pour cette facture. Le PDF/XML ne peut pas être régénéré à partir des données actuelles.'

export class InvoiceIssuanceAuthorityError extends Error {
  readonly code = 'INVOICE_ISSUANCE_AUTHORITY_MISSING'

  constructor() {
    super(INVOICE_ISSUANCE_AUTHORITY_ERROR_MESSAGE)
    this.name = 'InvoiceIssuanceAuthorityError'
  }
}
export const QUOTE_DOCUMENT_AUTHORITY_ERROR_MESSAGE =
  'Aucune autorité historique vérifiée n’est disponible pour ce devis. Le PDF ne peut pas être régénéré à partir des données actuelles.'

export class QuoteDocumentAuthorityUnavailableError extends Error {
  readonly code = 'QUOTE_DOCUMENT_AUTHORITY_MISSING'

  constructor() {
    super(QUOTE_DOCUMENT_AUTHORITY_ERROR_MESSAGE)
    this.name = 'QuoteDocumentAuthorityUnavailableError'
  }
}

export type QuoteDocumentPayload = {
  quoteRecord: QuoteDocumentRecord
  organization: PdfOrganizationData
  client: QuoteDocumentClient | null
}

export type InvoiceIssuanceAuthorityData = {
  invoice: InvoiceDocumentRecord
  organization: PdfOrganizationData
}

export type InvoicePdfResult = {
  buffer: Buffer
  fileName: string
  authority: InvoiceIssuanceAuthorityData
}
const nullableText = z.string().nullable()
const nullableNumber = z.number().nullable()
const invoiceQuoteReferenceSchema = z.union([
  z.object({ number: nullableText }).passthrough(),
  z.array(z.object({ number: nullableText }).passthrough()),
]).nullable()
const pdfOrganizationDataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  siret: nullableText,
  siren: nullableText,
  vat_number: nullableText,
  email: z.string(),
  email_from_name: nullableText,
  email_from_address: nullableText,
  phone: nullableText,
  address_line1: nullableText,
  address_line2: nullableText,
  city: nullableText,
  postal_code: nullableText,
  country: nullableText,
  logo_url: nullableText,
  forme_juridique: nullableText,
  capital_social: z.union([z.string(), z.number()]).nullable(),
  rcs: nullableText,
  rcs_ville: nullableText,
  insurance_info: nullableText,
  certifications: z.union([z.string(), z.array(z.string())]).nullable(),
  decennale_enabled: z.boolean().nullable(),
  decennale_assureur: nullableText,
  decennale_police: nullableText,
  decennale_couverture: nullableText,
  decennale_date_debut: nullableText,
  decennale_date_fin: nullableText,
  payment_terms_days: nullableNumber,
  late_penalty_rate: nullableNumber,
  bank_name: nullableText,
  court_competent: nullableText,
  signatory_name: nullableText.optional(),
  iban: nullableText,
  bic: nullableText,
  recovery_indemnity_text: nullableText,
  is_vat_subject: z.boolean(),
})
const invoiceIssuanceSnapshotSchema = z.object({
  schema_version: z.literal(1),
  issued_at: z.string().min(1),
  invoice: z.object({
    id: z.string().min(1),
    number: nullableText,
    title: nullableText,
    invoice_type: nullableText,
    total_ht: nullableNumber,
    total_tva: nullableNumber,
    total_ttc: nullableNumber,
    currency: nullableText,
    issue_date: nullableText,
    due_date: nullableText,
    created_at: z.string().min(1),
    notes_client: nullableText,
    payment_conditions: nullableText,
    aid_label: nullableText,
    aid_amount: nullableNumber,
    quote_id: nullableText,
    client_id: nullableText,
    situation_number: nullableNumber,
    cumulative_pct: nullableNumber,
    period_from: nullableText,
    period_to: nullableText,
    retention_pct: nullableNumber,
    retention_amount: nullableNumber,
    market_reference: nullableText,
    is_reverse_charge: z.boolean(),
  }).passthrough(),
  seller: pdfOrganizationDataSchema.extend({
    capital_social: nullableNumber,
    primary_color: nullableText,
    tva_sur_debits: z.boolean().nullable(),
    business_profile: nullableText,
    default_vat_rate: nullableNumber,
  }).passthrough(),
  buyer: z.object({
    id: z.string().min(1),
    type: z.string(),
    company_name: nullableText,
    contact_name: nullableText,
    first_name: nullableText,
    last_name: nullableText,
    email: nullableText,
    phone: nullableText,
    address_line1: nullableText,
    address_line2: nullableText,
    postal_code: nullableText,
    city: nullableText,
    country: nullableText,
    siret: nullableText,
    siren: nullableText,
    vat_number: nullableText,
  }).passthrough().nullable(),
  quote: z.object({ id: z.string().min(1), number: nullableText, title: nullableText }).passthrough().nullable(),
  chantier: z.object({ id: z.string().min(1), title: nullableText }).passthrough().nullable(),
  items: z.array(z.object({
    id: z.string().min(1),
    description: nullableText,
    quantity: nullableNumber,
    unit: nullableText,
    unit_price: z.number(),
    vat_rate: nullableNumber,
    is_internal: z.boolean().nullable(),
    length_m: nullableNumber,
    width_m: nullableNumber,
    height_m: nullableNumber,
    dim_quantity: nullableNumber,
  }).passthrough()),
  payment_schedule: z.array(z.object({
    id: z.string().min(1),
    label: z.string(),
    due_date: z.string(),
    amount: z.number(),
    amount_type: z.string(),
    percentage: nullableNumber,
    position: z.number(),
    paid_payment_id: nullableText,
  }).passthrough()),
}).passthrough()

export type InvoiceIssuanceSnapshot = z.infer<typeof invoiceIssuanceSnapshotSchema>

export type FacturXInvoicePayload = {
  xml: string
  buyerType: string | null
  buyerSiret: string | null
}

export function isInvoiceIssuanceSnapshot(
  value: unknown,
  invoiceId: string,
): value is InvoiceIssuanceSnapshot {
  const parsed = invoiceIssuanceSnapshotSchema.safeParse(value)
  return parsed.success && parsed.data.invoice.id === invoiceId
}
const quoteItemSnapshotSchema = z.array(z.object({
  id: z.string().min(1),
  section_id: nullableText,
  description: nullableText,
  details: nullableText,
  designation: nullableText,
  quantity: z.number(),
  unit: nullableText,
  unit_price: nullableNumber,
  vat_rate: z.number(),
  length_m: nullableNumber,
  width_m: nullableNumber,
  height_m: nullableNumber,
  dim_quantity: z.number(),
  is_internal: z.boolean(),
  price_pending: z.boolean(),
}).passthrough())
const quoteDraftItemSchema = z.array(z.object({
  id: z.string().min(1),
  section_id: nullableText,
  description: nullableText,
  details: nullableText,
  designation: nullableText,
  quantity: nullableNumber,
  unit: nullableText,
  unit_price: nullableNumber,
  vat_rate: nullableNumber,
  length_m: nullableNumber,
  width_m: nullableNumber,
  height_m: nullableNumber,
  dim_quantity: nullableNumber,
  is_internal: z.boolean().nullable(),
  price_pending: z.boolean().nullable(),
}).passthrough())
const quoteSectionSnapshotSchema = z.object({
  id: z.string().min(1),
  quote_id: z.string().min(1),
  title: nullableText,
  position: z.number(),
}).passthrough()
const quoteOrganizationSnapshotSchema = pdfOrganizationDataSchema.extend({
  capital_social: nullableNumber,
  primary_color: nullableText,
  tva_sur_debits: z.boolean().nullable(),
  business_profile: nullableText,
  default_vat_rate: nullableNumber,
})
const quoteDocumentSnapshotSchema = z.object({
  version: z.literal(1),
  captured_at: z.string().min(1),
  organization: quoteOrganizationSnapshotSchema,
  quote: z.object({
    id: z.string().min(1),
    number: nullableText,
    title: nullableText,
    total_ht: z.number(),
    total_tva: z.number(),
    total_ttc: z.number(),
    currency: z.string().min(1),
    validity_days: z.number(),
    valid_until: nullableText,
    sent_at: nullableText,
    created_at: z.string().min(1),
    notes_client: nullableText,
    payment_conditions: nullableText,
    client_request_description: nullableText,
    client_request_visible_on_pdf: z.boolean(),
    show_section_subtotals: z.boolean(),
    sections: z.array(quoteSectionSnapshotSchema.extend({ items: quoteItemSnapshotSchema })),
    unsectionedItems: quoteItemSnapshotSchema,
    items: quoteItemSnapshotSchema,
    client: invoiceIssuanceSnapshotSchema.shape.buyer,
  }).passthrough(),
}).passthrough()

function pdfOrigin(): string {
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin) throw new Error('NEXT_PUBLIC_APP_URL manquant, requis pour charger les polices PDF')
  return origin
}


async function getOrganizationForPdf(orgId: string): Promise<PdfOrganizationData | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('organizations')
    .select(`
      id, name, siret, siren, vat_number, email, email_from_name, email_from_address,
      phone, address_line1, address_line2, city, postal_code, country, logo_url, primary_color,
      forme_juridique, capital_social, rcs, rcs_ville, insurance_info, certifications,
      decennale_enabled, decennale_assureur, decennale_police, decennale_couverture,
      decennale_date_debut, decennale_date_fin, payment_terms_days, late_penalty_rate,
      court_competent, iban, bic, bank_name, recovery_indemnity_text,
      signatory_name,
      is_vat_subject, tva_sur_debits, default_vat_rate
    `)
    .eq('id', orgId)
    .single()

  if (!data) return null

  return pdfOrganizationDataSchema.parse(data)
}

export type QuoteDocumentSnapshotRecord = {
  id: string
  status: string
  signed_at: string | null
  client_signature_image: string | null
  client_signatory_name: string | null
  client_signatory_role: string | null
  document_snapshot: unknown
}

// Public callers pass the same row that authorized their capability. Reloading
// by ID could otherwise serve a different draft/publication after revocation.
export function quoteDocumentPayloadFromSnapshot(
  current: QuoteDocumentSnapshotRecord,
  orgId: string,
): QuoteDocumentPayload {
  const parsed = quoteDocumentSnapshotSchema.safeParse(current.document_snapshot)
  if (
    current.status === 'draft'
    || !parsed.success
    || parsed.data.quote.id !== current.id
    || parsed.data.organization.id !== orgId
  ) {
    throw new QuoteDocumentAuthorityUnavailableError()
  }
  const snapshot = parsed.data
  const quoteRecord: QuoteDocumentRecord = {
    id: snapshot.quote.id,
    number: snapshot.quote.number,
    title: snapshot.quote.title,
    total_ht: snapshot.quote.total_ht,
    total_ttc: snapshot.quote.total_ttc,
    currency: snapshot.quote.currency,
    validity_days: snapshot.quote.validity_days,
    valid_until: snapshot.quote.valid_until,
    sent_at: snapshot.quote.sent_at,
    signed_at: current.signed_at,
    client_signature_image: current.client_signature_image,
    client_signatory_name: current.client_signatory_name,
    client_signatory_role: current.client_signatory_role,
    created_at: snapshot.quote.created_at,
    client_request_description: snapshot.quote.client_request_description,
    client_request_visible_on_pdf: snapshot.quote.client_request_visible_on_pdf,
    notes_client: snapshot.quote.notes_client,
    payment_conditions: snapshot.quote.payment_conditions,
    show_section_subtotals: snapshot.quote.show_section_subtotals,
    sections: snapshot.quote.sections.map(({ id, title, items }) => ({ id, title, items })),
    unsectionedItems: snapshot.quote.unsectionedItems,
  }
  return {
    quoteRecord,
    organization: snapshot.organization,
    client: snapshot.quote.client,
  }
}

export async function getQuoteDocumentPayload(
  quoteId: string,
  orgId: string,
): Promise<QuoteDocumentPayload | null> {
  const admin = createAdminClient()
  const { data: current, error: currentError } = await admin
    .from('quotes')
    .select('id, status, signed_at, client_signature_image, client_signatory_name, client_signatory_role, document_snapshot')
    .eq('id', quoteId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (currentError) throw currentError
  if (!current) return null

  if (current.status !== 'draft') {
    return quoteDocumentPayloadFromSnapshot(current, orgId)
  }

  const { data: quote, error: quoteError } = await admin
    .from('quotes')
    .select(`
      id, number, title, status, total_ht, total_tva, total_ttc, currency,
      validity_days, valid_until, sent_at, signed_at, created_at,
      client_signature_image, client_signatory_name, client_signatory_role,
      notes_client, payment_conditions, discount_rate, deposit_rate, aid_label, aid_amount,
      show_section_subtotals,
      client_request_description, client_request_visible_on_pdf,
      client:clients(id, company_name, contact_name, email)
    `)
    .eq('id', quoteId)
    .eq('organization_id', orgId)
    .eq('status', 'draft')
    .maybeSingle()

  if (quoteError) throw quoteError
  if (!quote) return getQuoteDocumentPayload(quoteId, orgId)
  const quoteClient = Array.isArray(quote.client) ? quote.client[0] : quote.client

  const [{ data: sections, error: sectionError }, { data: items, error: itemError }, { data: client, error: clientError }, organization] = await Promise.all([
    admin.from('quote_sections').select('id, quote_id, title, position').eq('quote_id', quoteId).order('position', { ascending: true }),
    admin.from('quote_items').select('id, quote_id, section_id, type, material_id, labor_rate_id, designation, details, description, quantity, unit, unit_price, unit_cost_ht, ai_confidence, ai_source, ai_warnings, vat_rate, total_ht, position, length_m, width_m, height_m, dim_quantity, is_internal, metal_grid_id, dimension_values, variant_label, catalog_variant_id, price_pending, labor_category').eq('quote_id', quoteId).order('position', { ascending: true }),
    quoteClient?.id
      ? admin.from('clients').select('id, type, company_name, contact_name, first_name, last_name, email, phone, address_line1, postal_code, city, siret').eq('id', quoteClient.id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    getOrganizationForPdf(orgId),
  ])
  const { data: latest, error: latestError } = await admin
    .from('quotes')
    .select('status')
    .eq('id', quoteId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (latestError) throw latestError
  if (!latest) return null
  if (latest.status !== 'draft') return getQuoteDocumentPayload(quoteId, orgId)


  if (sectionError) throw sectionError
  if (itemError) throw itemError
  if (clientError) throw clientError
  if (!organization) return null

  const quoteItems = quoteDraftItemSchema.parse(items ?? [])
  const quoteSections = z.array(quoteSectionSnapshotSchema).parse(sections ?? [])
  const quoteRecord: QuoteDocumentRecord = {
    id: quote.id,
    number: quote.number,
    title: quote.title,
    total_ht: quote.total_ht,
    total_ttc: quote.total_ttc,
    currency: quote.currency,
    validity_days: quote.validity_days,
    valid_until: quote.valid_until,
    sent_at: quote.sent_at,
    signed_at: quote.signed_at,
    client_signature_image: quote.client_signature_image,
    client_signatory_name: quote.client_signatory_name,
    client_signatory_role: quote.client_signatory_role,
    created_at: quote.created_at,
    client_request_description: quote.client_request_description,
    client_request_visible_on_pdf: quote.client_request_visible_on_pdf,
    notes_client: quote.notes_client,
    payment_conditions: quote.payment_conditions,
    show_section_subtotals: quote.show_section_subtotals,
    sections: quoteSections.map(section => ({
      id: section.id,
      title: section.title,
      items: quoteItems.filter(item => item.section_id === section.id),
    })),
    unsectionedItems: quoteItems.filter(item => item.section_id === null),
  }

  return {
    quoteRecord,
    organization,
    client,
  }
}

export async function renderQuotePdfBufferById(quoteId: string, orgId: string): Promise<{ buffer: Buffer; fileName: string } | null> {
  const payload = await getQuoteDocumentPayload(quoteId, orgId)
  if (!payload) return null

  const buffer = await renderQuotePdf({
    quote: payload.quoteRecord,
    organization: payload.organization,
    client: payload.client,
  }, pdfOrigin())

  const fileName = `${sanitizeFileName(payload.quoteRecord.number ?? payload.quoteRecord.title ?? quoteId, 'devis')}.pdf`
  return { buffer, fileName }
}

async function loadInvoiceAuthorityForPdf(invoiceId: string, orgId: string) {
  const admin = createAdminClient()
  const { data: current, error } = await admin
    .from('invoices')
    .select('id, status, sent_at, issuance_snapshot')
    .eq('id', invoiceId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (error) throw error
  if (!current) return null

  const fromSnapshot = (row: { id: string; status: string; sent_at: string | null; issuance_snapshot: unknown }) => {
    const rawSnapshot = row.issuance_snapshot
    if (!isInvoiceIssuanceSnapshot(rawSnapshot, row.id)) {
      throw new InvoiceIssuanceAuthorityError()
    }
    const snapshot = rawSnapshot
    const invoiceRecord: InvoiceDocumentRecord = {
      ...snapshot.invoice,
      status: row.status,
      sent_at: row.sent_at,
      client: snapshot.buyer,
      quote_number: snapshot.quote?.number ?? null,
      items: snapshot.items,
    }
    const organization: PdfOrganizationData = snapshot.seller

    return {
      invoiceRecord,
      organization,
      status: row.status,
    }
  }

  if (current.status !== 'draft') return fromSnapshot(current)

  // Draft previews intentionally remain live and do not create or claim authority.
  const [invoice, organization] = await Promise.all([
    admin
      .from('invoices')
      .select(`
        id, number, title, status, invoice_type, total_ht, total_tva, total_ttc, total_paid, currency,
        issue_date, due_date, sent_at, paid_at, created_at,
        notes_client, payment_conditions, aid_label, aid_amount, quote_id, chantier_id, client_id,
        situation_number, cumulative_pct, period_from, period_to, retention_pct, retention_amount, market_reference, is_reverse_charge,
        quote:quotes!invoices_quote_id_fkey(number),
        client:clients(id, company_name, contact_name, first_name, last_name, email, phone,
          address_line1, address_line2, postal_code, city, country, siret, siren, vat_number, type),
        items:invoice_items(id, description, quantity, unit, unit_price, unit_cost_ht, vat_rate, position, length_m, width_m, height_m, dim_quantity, is_internal, material_id, dimension_values, variant_label, catalog_variant_id),
        payment_schedule:invoice_payment_schedule(id, invoice_id, label, due_date, amount, amount_type, percentage, position, paid_payment_id)
      `)
      .eq('id', invoiceId)
      .eq('organization_id', orgId)
      .eq('status', 'draft')
      .order('position', { referencedTable: 'invoice_items', ascending: true })
      .order('position', { referencedTable: 'invoice_payment_schedule', ascending: true })
      .maybeSingle(),
    getOrganizationForPdf(orgId),
  ])
  if (invoice.error) throw invoice.error

  const { data: latest, error: latestError } = await admin
    .from('invoices')
    .select('id, status, sent_at, issuance_snapshot')
    .eq('id', invoiceId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (latestError) throw latestError
  if (!latest) return null
  if (latest.status !== 'draft') return fromSnapshot(latest)
  if (!invoice.data || !organization || invoice.data.status !== 'draft') return null

  const invoiceData = invoice.data
  const invoiceClient = Array.isArray(invoiceData.client) ? invoiceData.client[0] : invoiceData.client
  const quoteReference = invoiceQuoteReferenceSchema.parse(invoiceData.quote)
  const quoteNumber = Array.isArray(quoteReference)
    ? quoteReference[0]?.number ?? null
    : quoteReference?.number ?? null
  const invoiceRecord: InvoiceDocumentRecord = {
    id: invoiceData.id,
    number: invoiceData.number,
    title: invoiceData.title,
    status: invoiceData.status,
    invoice_type: invoiceData.invoice_type,
    total_ht: invoiceData.total_ht,
    total_tva: invoiceData.total_tva,
    total_ttc: invoiceData.total_ttc,
    currency: invoiceData.currency,
    issue_date: invoiceData.issue_date,
    due_date: invoiceData.due_date,
    sent_at: latest.sent_at,
    created_at: invoiceData.created_at,
    notes_client: invoiceData.notes_client,
    payment_conditions: invoiceData.payment_conditions,
    aid_label: invoiceData.aid_label,
    aid_amount: invoiceData.aid_amount,
    quote_id: invoiceData.quote_id,
    client_id: invoiceData.client_id,
    situation_number: invoiceData.situation_number,
    cumulative_pct: invoiceData.cumulative_pct,
    period_from: invoiceData.period_from,
    period_to: invoiceData.period_to,
    retention_pct: invoiceData.retention_pct,
    retention_amount: invoiceData.retention_amount,
    market_reference: invoiceData.market_reference,
    is_reverse_charge: invoiceData.is_reverse_charge,
    quote_number: quoteNumber,
    client: invoiceClient ?? null,
    items: invoiceData.items ?? [],
  }

  return {
    invoiceRecord,
    organization,
    status: 'draft',
  }
}

/** Factur-X standalone payload for PDP uses the same issued snapshot as the embedded XML. */
export async function getFacturXmlForInvoice(
  invoiceId: string,
  orgId: string,
): Promise<FacturXInvoicePayload | null> {
  const loaded = await loadInvoiceAuthorityForPdf(invoiceId, orgId)
  if (!loaded || loaded.status === 'draft') return null
  return {
    xml: generateFacturXml(loaded.invoiceRecord, loaded.organization),
    buyerType: loaded.invoiceRecord.client?.type ?? null,
    buyerSiret: loaded.invoiceRecord.client?.siret ?? null,
  }
}

export async function renderInvoicePdfBufferById(
  invoiceId: string,
  orgId: string,
): Promise<InvoicePdfResult | null> {
  const loaded = await loadInvoiceAuthorityForPdf(invoiceId, orgId)
  if (!loaded) return null
  const { invoiceRecord, organization } = loaded

  const pdfBuffer = await renderInvoicePdf({
    invoice: invoiceRecord,
    organization,
    useStoredTotals: loaded.status !== 'draft',
  }, pdfOrigin())

  // The embedded Factur-X XML and visual PDF both consume the same authority.
  const xml = generateFacturXml(invoiceRecord, organization)
  const buffer = await embedFacturXml(pdfBuffer, xml, {
    conformanceLevel: 'EN 16931',
    language: 'fr-FR',
  })

  const fileName = `${sanitizeFileName(invoiceRecord.number ?? invoiceRecord.title ?? invoiceId, 'facture')}.pdf`
  return {
    buffer,
    fileName,
    authority: { invoice: invoiceRecord, organization },
  }
}

export async function renderChantierPdfBufferById(chantierId: string, orgId: string): Promise<{ buffer: Buffer; fileName: string } | null> {
  const admin = createAdminClient()

  const [chantier, taches, notes, organization] = await Promise.all([
    admin.from('chantiers').select('*').eq('id', chantierId).eq('organization_id', orgId).single(),
    admin.from('chantier_taches').select('*').eq('chantier_id', chantierId).order('position', { ascending: true }),
    admin
      .from('chantier_notes')
      .select(`
        id, chantier_id, content, created_at,
        author:profiles(full_name)
      `)
      .eq('chantier_id', chantierId)
      .order('created_at', { ascending: false }),
    getOrganizationForPdf(orgId),
  ])

  if (!chantier.data || !organization) return null

  const normalizedNotes = (notes.data ?? []).map((row: any) => ({
    ...row,
    author_name: row.author?.full_name ?? 'Inconnu',
  }))

  const buffer = await renderChantierPdf({
    chantier: chantier.data,
    taches: taches.data ?? [],
    notes: normalizedNotes,
    organization,
    periodFrom: null,
    periodTo: null,
  }, pdfOrigin())

  const fileName = `${sanitizeFileName(chantier.data.title ?? chantierId, 'chantier')}.pdf`
  return { buffer, fileName }
}

export async function renderMemberHoursReportPdfBuffer(
  memberId: string,
  orgId: string,
  dateFrom: string,
  dateTo: string,
): Promise<{ buffer: Buffer; fileName: string } | null> {
  const admin = createAdminClient()

  const { getMemberByIdAdmin } = await import('@/lib/data/queries/members')
  const [member, orgResult] = await Promise.all([
    getMemberByIdAdmin(memberId),
    admin
      .from('organizations')
      .select('name, logo_url, address_line1, postal_code, city')
      .eq('id', orgId)
      .single(),
  ])

  if (!member || member.organization_id !== orgId || !orgResult.data) return null

  const org = orgResult.data

  const pointages = await getMemberPointages(memberId, { dateFrom, dateTo, useAdmin: true })
  const totalHours = pointages.reduce((s, p) => s + p.hours, 0)

  const buffer = await renderMemberHoursReportPdf({
    member,
    organization: org,
    pointages,
    periodFrom: dateFrom,
    periodTo: dateTo,
    totalHours,
  }, pdfOrigin())

  const memberSlug = [member.prenom, member.name].filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9-]/gi, '-')
  const fileName = `rapport-heures-${memberSlug}-${dateFrom}-${dateTo}.pdf`
  return { buffer, fileName }
}

export async function renderContractPdfBufferFromPublication(
  record: ContractDocumentPublicationRecord,
): Promise<{ buffer: Buffer; fileName: string } | null> {
  const snapshot = await contractDocumentSnapshotFromVerifiedPublication(record)
  if (!snapshot) return null
  const buffer = await renderContractPdf(snapshot, pdfOrigin())
  const fileName = `${sanitizeFileName(snapshot.reference, 'contrat')}.pdf`
  return { buffer, fileName }
}

export async function renderContractPdfBufferById(
  contractId: string,
  orgId: string,
): Promise<{ buffer: Buffer; fileName: string } | null> {
  const admin = createAdminClient()
  const { data: contract, error } = await admin.from('contracts')
    .select(`id, organization_id, status, sent_at, signed_at, client_signed_at,
      client_signature_image, client_signatory_name, client_signatory_role,
      pdf_reference, signature_document_hash, pdf_snapshot, linked_quote_document`)
    .eq('id', contractId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (error) throw error
  return contract ? renderContractPdfBufferFromPublication(contract) : null
}

// ─── DGD — Décompte Général Définitif ────────────────────────────────────────

export async function renderDgdPdfBufferByChantierId(
  chantierId: string,
  orgId: string,
): Promise<{ buffer: Buffer; fileName: string } | null> {
  const admin = createAdminClient()

  const [chantierRes, invoicesRes, organization] = await Promise.all([
    admin
      .from('chantiers')
      .select('id, title, address_line1, postal_code, city, reception_status, reception_at, quote_id, client_id, client:clients(company_name, first_name, last_name)')
      .eq('id', chantierId)
      .eq('organization_id', orgId)
      .single(),
    admin
      .from('invoices')
      .select('id, number, title, invoice_type, issue_date, total_ht, retention_pct, retention_amount, cumulative_pct, market_reference, status')
      .eq('chantier_id', chantierId)
      .eq('organization_id', orgId)
      .in('invoice_type', ['situation', 'solde', 'acompte'])
      .in('status', ['sent', 'paid', 'partial'])
      .order('issue_date', { ascending: true }),
    getOrganizationForPdf(orgId),
  ])

  if (!chantierRes.data || !organization) return null

  const chantier = chantierRes.data
  const invoices = invoicesRes.data ?? []

  // Devis-marche du chantier + ses avenants (lien explicite, pas inference depuis les factures)
  const marketQuotes = chantier.quote_id
    ? (await admin
        .from('quotes')
        .select('id, number, title, total_ht, parent_quote_id')
        .eq('organization_id', orgId)
        .or(`id.eq.${chantier.quote_id},parent_quote_id.eq.${chantier.quote_id}`)
        .order('created_at', { ascending: true })
      ).data ?? []
    : []

  const clientRaw = Array.isArray(chantier.client) ? chantier.client[0] : chantier.client
  const clientName = clientRaw
    ? (clientRaw as any).company_name || [(clientRaw as any).first_name, (clientRaw as any).last_name].filter(Boolean).join(' ') || null
    : null

  const chantierAddress = [chantier.address_line1, chantier.postal_code, chantier.city].filter(Boolean).join(', ')

  // Construire les lignes du DGD
  const lines: DgdLine[] = []
  let totalMarcheHt = 0
  let totalSituationsHt = 0
  let totalRetentionHt = 0
  let marketRef: string | null = null

  // Marche initial + avenants, depuis le devis-marche lie au chantier
  for (const q of marketQuotes) {
    const isAvenant = !!q.parent_quote_id
    const qHt = q.total_ht ?? 0
    lines.push({
      label: q.title ?? (isAvenant ? 'Avenant' : 'Marche initial'),
      reference: q.number ?? null,
      amount_ht: qHt,
      net_ht: qHt,
      type: isAvenant ? 'avenant' : 'marche',
    })
    totalMarcheHt += qHt
  }

  // Lignes situations / solde
  for (const inv of invoices) {
    const amountHt = inv.total_ht ?? 0
    const retAmt = inv.retention_amount ?? 0
    const netHt = amountHt - retAmt

    if (!marketRef && inv.market_reference) marketRef = inv.market_reference

    lines.push({
      label: inv.title ?? `Facture ${inv.number ?? ''}`,
      reference: inv.number ?? null,
      date: inv.issue_date,
      amount_ht: amountHt,
      retention_pct: inv.retention_pct,
      retention_amount: retAmt > 0 ? retAmt : null,
      net_ht: netHt,
      cumulative_pct: inv.cumulative_pct,
      type: inv.invoice_type === 'solde' ? 'solde' : 'situation',
    })

    totalSituationsHt += amountHt
    totalRetentionHt += retAmt
  }

  const totalNetHt = totalSituationsHt - totalRetentionHt

  // Ligne total
  lines.push({
    label: 'TOTAL GENERAL',
    amount_ht: totalSituationsHt,
    retention_amount: totalRetentionHt > 0 ? totalRetentionHt : null,
    net_ht: totalNetHt,
    type: 'total',
  })

  const buffer = await renderDgdPdf({
    chantierTitle: chantier.title,
    chantierAddress: chantierAddress || null,
    clientName,
    marketReference: marketRef,
    lines,
    totalMarcheHt,
    totalSituationsHt,
    totalRetentionHt,
    totalNetHt,
    receptionDate: chantier.reception_at ?? null,
    receptionStatus: chantier.reception_status ?? null,
    organization,
  }, pdfOrigin())

  const fileName = `${sanitizeFileName(chantier.title, 'dgd')}.pdf`
  return { buffer, fileName }
}
