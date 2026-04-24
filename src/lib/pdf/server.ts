import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { createAdminClient } from '@/lib/supabase/admin'
import QuotePDF from '@/components/pdf/QuotePDF'
import InvoicePDF from '@/components/pdf/InvoicePDF'
import ChantierPDF from '@/components/pdf/ChantierPDF'
import { sanitizeFileName } from '@/lib/organization-exports/csv'
import { generateFacturXml } from '@/lib/pdf/facturx-xml'
import { embedFacturXml } from '@/lib/pdf/facturx-embed'

async function fetchLogoAsDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const contentType = res.headers.get('content-type') ?? 'image/png'
    return `data:${contentType};base64,${Buffer.from(buf).toString('base64')}`
  } catch {
    return null
  }
}

async function getOrganizationForPdf(orgId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from('organizations')
    .select('id, name, slug, siret, siren, vat_number, email, phone, address_line1, address_line2, city, postal_code, country, logo_url, email_from_name, email_from_address, forme_juridique, capital_social, rcs, rcs_ville, insurance_info, certifications, primary_color, payment_terms_days, late_penalty_rate, court_competent, iban, bic, bank_name, recovery_indemnity_text, auto_reminder_enabled, invoice_reminder_days, quote_reminder_days, reminder_hour_utc, sector, business_profile, business_activity_id, label_set, unit_set, default_categories, starter_presets, is_vat_subject, default_vat_rate, public_form_enabled, public_form_welcome_message, public_form_catalog_item_ids, public_form_custom_mode_enabled, public_form_notification_email')
    .eq('id', orgId)
    .single()

  if (!data) return null

  const logoDataUrl = await fetchLogoAsDataUrl(data.logo_url)
  return { ...data, logo_url: logoDataUrl ?? data.logo_url }
}

export async function renderQuotePdfBufferById(quoteId: string, orgId: string): Promise<{ buffer: Buffer; fileName: string } | null> {
  const admin = createAdminClient()

  const { data: quote } = await admin
    .from('quotes')
    .select(`
      id, number, title, status, total_ht, total_tva, total_ttc, currency,
      validity_days, valid_until, sent_at, signed_at, created_at,
      notes_client, payment_conditions, discount_rate, deposit_rate,
      client_request_description, client_request_visible_on_pdf,
      client:clients(id, company_name, contact_name, email)
    `)
    .eq('id', quoteId)
    .eq('organization_id', orgId)
    .single()

  if (!quote) return null
  const quoteClient = Array.isArray(quote.client) ? quote.client[0] : quote.client

  const [{ data: sections }, { data: items }, { data: client }, organization] = await Promise.all([
    admin.from('quote_sections').select('id, quote_id, title, position').eq('quote_id', quoteId).order('position', { ascending: true }),
    admin.from('quote_items').select('id, quote_id, section_id, type, material_id, labor_rate_id, description, quantity, unit, unit_price, vat_rate, total_ht, position, length_m, width_m, height_m, is_internal, dimension_values, variant_label, catalog_variant_id').eq('quote_id', quoteId).order('position', { ascending: true }),
    quoteClient?.id
      ? admin.from('clients').select('*').eq('id', quoteClient.id).single()
      : Promise.resolve({ data: null as Record<string, unknown> | null }),
    getOrganizationForPdf(orgId),
  ])

  if (!organization) return null

  const typedSections = (sections ?? []).map((section: any) => ({
    ...section,
    items: (items ?? []).filter((item: any) => item.section_id === section.id),
  }))

  const fullQuote = {
    ...quote,
    client: quoteClient ?? null,
    sections: typedSections,
    unsectionedItems: (items ?? []).filter((item: any) => item.section_id === null),
  }

  const buffer = await renderToBuffer(
    React.createElement(QuotePDF, {
      quote: fullQuote,
      organization,
      client,
    }) as any,
  )

  const fileName = `${sanitizeFileName(quote.number ?? quote.title ?? quoteId, 'devis')}.pdf`
  return { buffer, fileName }
}

export async function renderInvoicePdfBufferById(invoiceId: string, orgId: string): Promise<{ buffer: Buffer; fileName: string } | null> {
  const admin = createAdminClient()

  const [invoice, organization] = await Promise.all([
    admin
      .from('invoices')
      .select(`
        id, number, title, status, invoice_type, total_ht, total_tva, total_ttc, currency,
        issue_date, due_date, sent_at, paid_at, created_at,
        notes_client, payment_conditions, quote_id, client_id,
        client:clients(id, company_name, contact_name, first_name, last_name, email, phone,
          address_line1, postal_code, city, siret, siren, vat_number, type),
        items:invoice_items(id, description, quantity, unit, unit_price, vat_rate, position, length_m, width_m, height_m, is_internal, material_id, dimension_values, variant_label, catalog_variant_id)
      `)
      .eq('id', invoiceId)
      .eq('organization_id', orgId)
      .order('position', { referencedTable: 'invoice_items', ascending: true })
      .single(),
    getOrganizationForPdf(orgId),
  ])

  if (!invoice.data || !organization) return null
  const invoiceClient = Array.isArray(invoice.data.client) ? invoice.data.client[0] : invoice.data.client
  const invoiceRecord = {
    ...invoice.data,
    client: invoiceClient ?? null,
  }

  const pdfBuffer = await renderToBuffer(
    React.createElement(InvoicePDF, {
      invoice: invoiceRecord,
      organization,
    }) as any,
  )

  // Embarquer le XML Factur-X dans le PDF (PDF/A-3 + XMP)
  const xml = generateFacturXml(invoiceRecord as any, organization)
  const buffer = await embedFacturXml(pdfBuffer, xml, {
    conformanceLevel: 'EN 16931',
    language: 'fr-FR',
  })

  const fileName = `${sanitizeFileName(invoiceRecord.number ?? invoiceRecord.title ?? invoiceId, 'facture')}.pdf`
  return { buffer, fileName }
}

export async function renderChantierPdfBufferById(chantierId: string, orgId: string): Promise<{ buffer: Buffer; fileName: string } | null> {
  const admin = createAdminClient()

  const [chantier, taches, pointages, notes, organization] = await Promise.all([
    admin.from('chantiers').select('*').eq('id', chantierId).eq('organization_id', orgId).single(),
    admin.from('chantier_taches').select('*').eq('chantier_id', chantierId).order('position', { ascending: true }),
    admin
      .from('chantier_pointages')
      .select(`
        id, chantier_id, tache_id, user_id, date, hours, description, created_at, start_time,
        profile:profiles(full_name),
        tache:chantier_taches(title)
      `)
      .eq('chantier_id', chantierId)
      .order('date', { ascending: false }),
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

  const normalizedPointages = (pointages.data ?? []).map((row: any) => ({
    ...row,
    user_name: row.profile?.full_name ?? 'Inconnu',
    tache_title: row.tache?.title ?? null,
  }))

  const normalizedNotes = (notes.data ?? []).map((row: any) => ({
    ...row,
    author_name: row.author?.full_name ?? 'Inconnu',
  }))

  const buffer = await renderToBuffer(
    React.createElement(ChantierPDF, {
      chantier: chantier.data,
      taches: taches.data ?? [],
      pointages: normalizedPointages,
      notes: normalizedNotes,
      organization,
      periodFrom: null,
      periodTo: null,
    }) as any,
  )

  const fileName = `${sanitizeFileName(chantier.data.title ?? chantierId, 'chantier')}.pdf`
  return { buffer, fileName }
}
