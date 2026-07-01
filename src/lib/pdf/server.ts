import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { createAdminClient } from '@/lib/supabase/admin'
import QuotePDF from '@/components/pdf/QuotePDF'
import InvoicePDF from '@/components/pdf/InvoicePDF'
import ChantierPDF from '@/components/pdf/ChantierPDF'
import MemberHoursReportPDF from '@/components/pdf/MemberHoursReportPDF'
import ContractPDF, { type ContractPdfSnapshot } from '@/components/pdf/ContractPDF'
import DgdPDF, { type DgdLine } from '@/components/pdf/DgdPDF'
import { sanitizeFileName } from '@/lib/organization-exports/csv'
import { generateFacturXml } from '@/lib/pdf/facturx-xml'
import { embedFacturXml } from '@/lib/pdf/facturx-embed'
import { getMemberPointages } from '@/lib/data/queries/members'
import { assertSafeExternalFetchUrl } from '@/lib/security'

async function fetchLogoAsDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null
  if (url.startsWith('data:')) return url
  const safeUrl = assertSafeExternalFetchUrl(url)
  if (!safeUrl) return null
  try {
    const res = await fetch(safeUrl)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const contentType = res.headers.get('content-type') ?? 'image/png'
    if (contentType.includes('svg')) return null
    return `data:${contentType};base64,${Buffer.from(buf).toString('base64')}`
  } catch {
    return null
  }
}

async function getOrganizationForPdf(orgId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from('organizations')
    .select('id, name, slug, siret, siren, vat_number, email, phone, address_line1, address_line2, city, postal_code, country, logo_url, email_from_name, email_from_address, forme_juridique, capital_social, rcs, rcs_ville, insurance_info, certifications, primary_color, payment_terms_days, late_penalty_rate, court_competent, iban, bic, bank_name, recovery_indemnity_text, auto_reminder_enabled, invoice_reminder_days, quote_reminder_days, reminder_hour_utc, sector, business_profile, business_activity_id, secondary_activity_ids, label_set, unit_set, default_categories, starter_presets, is_vat_subject, tva_sur_debits, default_vat_rate, public_form_enabled, public_form_welcome_message, public_form_catalog_item_ids, public_form_custom_mode_enabled, public_form_notification_email, decennale_enabled, decennale_assureur, decennale_police, decennale_couverture, decennale_date_debut, decennale_date_fin, cgv_text, signatory_name, signatory_role, signature_image')
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
      client_signature_image, client_signatory_name, client_signatory_role,
      notes_client, payment_conditions, discount_rate, deposit_rate, aid_label, aid_amount,
      show_section_subtotals,
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
    admin.from('quote_items').select('id, quote_id, section_id, type, material_id, labor_rate_id, designation, details, description, quantity, unit, unit_price, unit_cost_ht, ai_confidence, ai_source, ai_warnings, vat_rate, total_ht, position, length_m, width_m, height_m, dim_quantity, is_internal, metal_grid_id, dimension_values, variant_label, catalog_variant_id, price_pending, labor_category').eq('quote_id', quoteId).order('position', { ascending: true }),
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
    variant_group_id: (quote as any).variant_group_id ?? null,
    variant_label: (quote as any).variant_label ?? null,
    technical_checklist: (quote as any).technical_checklist ?? null,
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
        id, number, title, status, invoice_type, total_ht, total_tva, total_ttc, total_paid, currency,
        issue_date, due_date, sent_at, paid_at, created_at,
        notes_client, payment_conditions, aid_label, aid_amount, quote_id, chantier_id, client_id,
        situation_number, cumulative_pct, period_from, period_to, retention_pct, retention_amount, market_reference, is_reverse_charge,
        quote:quotes(number),
        client:clients(id, company_name, contact_name, first_name, last_name, email, phone,
          address_line1, postal_code, city, siret, siren, vat_number, type),
        items:invoice_items(id, description, quantity, unit, unit_price, unit_cost_ht, vat_rate, position, length_m, width_m, height_m, dim_quantity, is_internal, material_id, dimension_values, variant_label, catalog_variant_id),
        payment_schedule:invoice_payment_schedule(id, invoice_id, label, due_date, amount, amount_type, percentage, position, paid_payment_id)
      `)
      .eq('id', invoiceId)
      .eq('organization_id', orgId)
      .order('position', { referencedTable: 'invoice_items', ascending: true })
      .order('position', { referencedTable: 'invoice_payment_schedule', ascending: true })
      .single(),
    getOrganizationForPdf(orgId),
  ])

  if (!invoice.data || !organization) return null
  const invoiceClient = Array.isArray(invoice.data.client) ? invoice.data.client[0] : invoice.data.client
  const quoteData = invoice.data.quote as { number: string | null } | { number: string | null }[] | null
  const quoteNumber = Array.isArray(quoteData) ? (quoteData[0]?.number ?? null) : (quoteData?.number ?? null)
  const invoiceRecord = {
    ...invoice.data,
    client: invoiceClient ?? null,
    quote_number: quoteNumber,
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

  const buffer = await renderToBuffer(
    React.createElement(MemberHoursReportPDF as any, {
      member,
      organization: org,
      pointages,
      periodFrom: dateFrom,
      periodTo: dateTo,
      totalHours,
    }) as any,
  )

  const memberSlug = [member.prenom, member.name].filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9-]/gi, '-')
  const fileName = `rapport-heures-${memberSlug}-${dateFrom}-${dateTo}.pdf`
  return { buffer, fileName }
}

export async function renderContractPdfBufferById(contractId: string, orgId: string): Promise<{ buffer: Buffer; fileName: string } | null> {
  const admin = createAdminClient()

  const { data: contract } = await admin
    .from('contracts')
    .select('id, organization_id, title, pdf_reference, pdf_snapshot')
    .eq('id', contractId)
    .eq('organization_id', orgId)
    .single()

  if (!contract?.pdf_snapshot) return null

  const snapshot = contract.pdf_snapshot as ContractPdfSnapshot
  const logoUrl = snapshot.organization?.logo_url ?? null
  const logoDataUrl = logoUrl?.startsWith('data:') ? logoUrl : await fetchLogoAsDataUrl(logoUrl)
  const snapshotForPdf: ContractPdfSnapshot = logoDataUrl && snapshot.organization
    ? {
        ...snapshot,
        organization: {
          ...snapshot.organization,
          logo_url: logoDataUrl,
        },
      }
    : snapshot

  const buffer = await renderToBuffer(
    React.createElement(ContractPDF, {
      snapshot: snapshotForPdf,
    }) as any,
  )

  const fileName = `${sanitizeFileName(contract.pdf_reference ?? contract.title ?? contractId, 'contrat')}.pdf`
  return { buffer, fileName }
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
      .in('status', ['sent', 'paid', 'partially_paid'])
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

  const buffer = await renderToBuffer(
    React.createElement(DgdPDF, {
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
    }) as any,
  )

  const fileName = `${sanitizeFileName(chantier.title, 'dgd')}.pdf`
  return { buffer, fileName }
}
