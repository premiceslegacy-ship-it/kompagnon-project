import type { InvoiceDocumentClient, InvoiceDocumentRecord, PdfOrganizationData } from '@/lib/pdf/document-types'
import { formatDimDetail, pdfText, splitItemDescription } from '@/lib/pdf/pdf-design-system'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { embedImage } from '../engine/image'
import {
  K, bottomBlockTop, drawCompactHeader, drawHeader, drawKitTable, drawMeta, drawNote, drawOutlineBox, drawParties,
  drawTextCard, drawTotals, installFooter, measureCard,
  type CardParagraph, type KitCell, type KitColumn, type KitRow, type TotalLine,
} from '../engine/kit'
import { DECENNALE_LABEL, decennaleText, legalFooterLines, organizationPartyLines } from '../engine/legal'
import { COLOR, CONTENT_WIDTH, PAGE } from '../engine/theme'

import { calculateMonetaryTotals, roundMoney } from '@/lib/utils/money'
const INVOICE_SECTION_UNIT = '__section__'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number, currency = 'EUR') =>
  pdfText(new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n))

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })

function clientDisplayName(client: InvoiceDocumentClient): string {
  return client.company_name
    || [client.first_name, client.last_name].filter(Boolean).join(' ')
    || client.email
    || '-'
}

export type InvoicePdfData = {
  invoice: InvoiceDocumentRecord
  organization: PdfOrganizationData
  useStoredTotals?: boolean
}

export async function renderInvoicePdf(data: InvoicePdfData, origin: string): Promise<Buffer> {
  const fontBytes = await loadFontBytes(origin)
  return renderInvoicePdfWithFonts(data, fontBytes)
}

export async function renderInvoicePdfWithFonts(data: InvoicePdfData, fontBytes: FontBytes): Promise<Buffer> {
  const { invoice, organization } = data
  const doc = await PdfDoc.create(fontBytes)
  const F = doc.fonts

  const isVatSubject = organization.is_vat_subject !== false
  const isReverseCharge = invoice.is_reverse_charge === true
  const isClientPro = invoice.client?.type === 'company'

  const invoiceType = invoice.invoice_type ?? 'standard'
  const isSituation = invoiceType === 'situation' || invoiceType === 'solde'
  const invoiceTypeLabel =
    invoiceType === 'avoir'     ? 'Avoir' :
    invoiceType === 'acompte'   ? "Facture d'acompte" :
    invoiceType === 'solde'     ? 'Facture de solde'  :
    invoiceType === 'situation' ? `Situation de travaux n° ${invoice.situation_number ?? ''}`.trim() :
    'Facture'

  const items = invoice.items.filter(i => !i.is_internal)
  const billableItems = items.filter(i => i.unit !== INVOICE_SECTION_UNIT)
  const currency = invoice.currency ?? 'EUR'

  const calculatedTotals = calculateMonetaryTotals(billableItems, {
    isVatSubject,
    isReverseCharge,
  })
  const calculatedTotalHt = calculatedTotals.totalHt
  const calculatedTotalTva = calculatedTotals.totalTva
  const totalHt = data.useStoredTotals ? invoice.total_ht ?? calculatedTotalHt : calculatedTotalHt
  const vatMap = data.useStoredTotals && invoice.vat_breakdown
    ? Object.fromEntries(invoice.vat_breakdown.map(bucket => [String(bucket.rate), bucket.tax_amount]))
    : calculatedTotals.vatByRate
  const totalTva = data.useStoredTotals && invoice.vat_breakdown
    ? invoice.vat_breakdown.reduce((sum, bucket) => sum + bucket.tax_amount, 0)
    : calculatedTotalTva
  const calculatedTotalTtc = roundMoney(calculatedTotalHt + calculatedTotalTva)
  const totalTtc = data.useStoredTotals ? invoice.total_ttc ?? calculatedTotalTtc : calculatedTotalTtc

  const logoImg = organization.logo_url ? await embedImage(doc.doc, organization.logo_url) : null
  const brand = { logo: logoImg, name: organization.name }
  const heading = { title: invoiceTypeLabel, number: invoice.number }
  doc.onNewPage = ({ pageIndex }) => pageIndex === 0 ? drawHeader(doc, brand, heading) : drawCompactHeader(doc, brand, heading)
  installFooter(doc, legalFooterLines(organization, isVatSubject))
  doc.addPage()

  // ── Repères, parties ──
  const meta: { label: string; value: string }[] = [
    ...(invoice.issue_date ? [{ label: 'Date', value: fmtLongDate(invoice.issue_date) }] : []),
    ...(invoice.preceding_invoice_ref ? [{
      label: 'Facture corrigée',
      value: `N° ${invoice.preceding_invoice_ref}${invoice.preceding_invoice_date ? ` · ${fmtDate(invoice.preceding_invoice_date)}` : ''}`,
    }] : []),
    ...(invoice.due_date ? [{ label: 'À régler avant le', value: fmtLongDate(invoice.due_date) }] : []),
    ...(invoice.title ? [{ label: 'Objet', value: invoice.title }] : invoice.quote_number ? [{ label: 'Devis', value: invoice.quote_number }] : []),
  ]
  drawMeta(doc, meta.length ? meta : [{ label: 'Date', value: fmtLongDate(invoice.created_at) }])
  const invClient = invoice.client
  drawParties(
    doc,
    { label: 'De', name: organization.name, lines: organizationPartyLines(organization, { siren: true }) },
    {
      label: 'Pour',
      name: invClient ? clientDisplayName(invClient) : '—',
      lines: invClient
        ? [
            invClient.address_line1,
            [invClient.postal_code, invClient.city].filter(Boolean).join(' ') || null,
            [invClient.email, invClient.phone].filter(Boolean).join(' · ') || null,
            invClient.siret ? `SIRET ${invClient.siret}` : (invClient.siren ? `SIREN ${invClient.siren}` : null),
            invClient.vat_number ? `TVA ${invClient.vat_number}` : null,
          ].filter((l): l is string => !!l).map(pdfText)
        : [],
    },
  )
  const decennale = decennaleText(organization)
  if (decennale) drawNote(doc, DECENNALE_LABEL, decennale, 12)

  // ── Situation de travaux ──
  if (isSituation) {
    const lines: string[] = []
    if (invoice.quote_id) {
      lines.push(`Avancement cumulé : ${invoice.cumulative_pct ?? 0} %${invoice.quote_number ? ` · sur devis n° ${invoice.quote_number}` : ''}`)
    }
    if (invoice.period_from && invoice.period_to) {
      lines.push(`Période d'exécution : du ${new Date(invoice.period_from).toLocaleDateString('fr-FR')} au ${new Date(invoice.period_to).toLocaleDateString('fr-FR')}`)
    }
    if (invoice.market_reference) lines.push(`Référence marché : ${invoice.market_reference}`)
    if ((invoice.retention_pct ?? 0) > 0) {
      lines.push(`Retenue de garantie : ${invoice.retention_pct} % (${fmt(invoice.retention_amount ?? 0, currency)})`)
    }
    if (lines.length) drawNote(doc, invoiceTypeLabel, lines.join(' · '), 9)
  }
  if (invoice.notes_client && !isSituation) drawNote(doc, null, invoice.notes_client, 9)

  // ── Tableau ──
  const withVat = isVatSubject
  const fixed = 52.5 + 61.5 + 69 + (withVat ? 33 : 0)
  const gap = 7.5
  const cols: KitColumn[] = [
    { width: CONTENT_WIDTH - fixed - gap * (withVat ? 4 : 3), header: 'Désignation' },
    { width: 52.5, header: 'Qté' },
    { width: 61.5, header: 'P.U. HT' },
    ...(withVat ? [{ width: 33, header: 'TVA' }] : []),
    { width: 69, header: 'Total HT' },
  ]

  function itemToRow(item: InvoiceDocumentRecord['items'][number]): KitRow {
    const parts = splitItemDescription(item.description)
    const dimDetail = formatDimDetail(item)
    const details = [
      ...(parts.details.length ? [`Comprend : ${parts.details.join(' · ')}`] : []),
      ...(dimDetail ? [dimDetail] : []),
    ]
    const quantity = item.quantity == null ? '' : `${item.quantity}${item.unit ? ` ${pdfText(item.unit)}` : ''}`
    const cells: KitCell[] = [
      { value: parts.title, details },
      { value: quantity },
      { value: fmt(item.unit_price, currency) },
    ]
    if (withVat) cells.push({ value: item.vat_rate == null ? '' : `${item.vat_rate} %` })
    cells.push({ value: fmt(roundMoney((item.quantity ?? 0) * item.unit_price), currency), bold: true })
    return { cells }
  }

  const rows: KitRow[] = []
  items.forEach((item, index) => {
    if (item.unit === INVOICE_SECTION_UNIT) {
      let sum = 0
      for (let i = index + 1; i < items.length && items[i].unit !== INVOICE_SECTION_UNIT; i++) sum = roundMoney(sum + roundMoney((items[i].quantity ?? 0) * items[i].unit_price))
      rows.push({ kind: 'section', title: pdfText(item.description), amount: fmt(sum, currency) })
    } else {
      rows.push(itemToRow(item))
    }
  })
  drawKitTable(doc, cols, rows, { gap })

  // ── Totaux ──
  const hasAid = Boolean(invoice.aid_label && invoice.aid_amount != null && invoice.aid_amount > 0)
  const hasRetention = isSituation && (invoice.retention_pct ?? 0) > 0
  const totalLines: TotalLine[] = [{ label: 'Total HT', value: fmt(totalHt, currency) }]
  if (isReverseCharge) totalLines.push({ label: 'TVA', value: 'Autoliquidation' })
  else if (isVatSubject) for (const [rate, amount] of Object.entries(vatMap)) totalLines.push({ label: `TVA ${rate} %`, value: fmt(amount, currency) })
  else totalLines.push({ label: 'TVA', value: 'Non applicable' })

  const rac = hasAid ? Math.max(0, totalTtc - (invoice.aid_amount ?? 0)) : 0
  const netAPayer = hasRetention ? Math.max(0, totalHt - (invoice.retention_amount ?? 0)) : 0
  let grand: TotalLine = { label: isReverseCharge ? 'Net HT' : isVatSubject ? 'Total TTC' : 'Total HT', value: fmt(totalTtc, currency) }
  if (hasAid || hasRetention) {
    totalLines.push({ label: isReverseCharge ? 'Net HT' : isVatSubject ? 'Total TTC' : 'Total HT', value: fmt(totalTtc, currency) })
  }
  if (hasAid) {
    totalLines.push({ label: pdfText(invoice.aid_label), value: `−${fmt(invoice.aid_amount ?? 0, currency)}` })
    grand = { label: 'Reste à charge', value: fmt(rac, currency) }
  }
  if (hasRetention) {
    totalLines.push({ label: `Retenue de garantie ${invoice.retention_pct} %`, value: `−${fmt(invoice.retention_amount ?? 0, currency)}` })
    if (hasAid) totalLines.push({ label: 'Reste à charge', value: fmt(rac, currency) })
    grand = { label: 'Net à payer HT', value: fmt(netAPayer, currency) }
  }
  drawTotals(doc, totalLines, grand)
  if (!isVatSubject) drawNote(doc, null, 'TVA non applicable, art. 293B du CGI', 6)
  if (invoiceType === 'solde' && data.useStoredTotals && (invoice.applied_acompte_ht ?? 0) > 0) {
    drawNote(
      doc,
      null,
      `Acomptes déjà imputés dans ce solde (HT) : ${fmt(invoice.applied_acompte_ht ?? 0, currency)}. Aucun nouvel acompte n’est à déduire.`,
      6,
    )
  }

  // ── Règlement et statut ──
  const gapCols = 12
  const leftW = (CONTENT_WIDTH - gapCols) * 1.25 / 2.25
  const rightW = CONTENT_WIDTH - gapCols - leftW
  const paragraphs: CardParagraph[] = []
  if (invoice.payment_conditions) paragraphs.push({ text: invoice.payment_conditions })
  else if (organization.payment_terms_days) paragraphs.push({ text: `Règlement à ${organization.payment_terms_days} jours à compter de la date de facturation.` })
  if (organization.iban) {
    paragraphs.push({ text: `Virement · IBAN ${organization.iban}${organization.bic ? ` · BIC ${organization.bic}` : ''}${organization.bank_name ? ` · ${organization.bank_name}` : ''}`, gapBefore: paragraphs.length ? 4.5 : 0 })
  }
  if (invoice.number) paragraphs.push({ text: `Référence à rappeler : ${invoice.number}`, gapBefore: paragraphs.length ? 3 : 0 })
  if (organization.late_penalty_rate) {
    paragraphs.push({
      text: `Pénalités de retard : ${organization.late_penalty_rate} % par an, exigibles dès le lendemain de la date d'échéance, sans mise en demeure préalable.`
        + (isClientPro ? ` ${organization.recovery_indemnity_text ?? "Conformément à l'article L441-10 du Code de commerce, une indemnité forfaitaire de 40 € pour frais de recouvrement est due de plein droit en cas de retard de paiement."}` : ''),
      gapBefore: 4.5,
    })
  }
  if (organization.court_competent) paragraphs.push({ text: `En cas de litige : ${organization.court_competent}.`, gapBefore: 3 })

  const status = invoiceStatus(invoice.status, invoice.due_date)
  const blockH = Math.max(paragraphs.length ? measureCard(doc, leftW, 'Règlement', paragraphs) : 0, 66)
  const top = bottomBlockTop(doc, blockH, 12)
  if (paragraphs.length) drawTextCard(doc, PAGE.margin, top, leftW, 'Règlement', paragraphs, blockH)
  const px = PAGE.margin + leftW + gapCols
  drawOutlineBox(doc, px, top, rightW, blockH)
  const midY = top - blockH / 2
  doc.page.drawText('Statut', { x: px + 13.5, y: midY + 13, size: K.label, font: F.bold, color: COLOR.secondary })
  doc.page.drawText(status.label, { x: px + 13.5, y: midY - 6, size: 15, font: F.heading, color: COLOR.black })
  if (status.detail) doc.page.drawText(status.detail, { x: px + 13.5, y: midY - 18, size: K.small + 0.4, font: F.regular, color: COLOR.body })
  doc.y = top - blockH

  return doc.save()
}

const fmtLongDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

/** Pastille de statut du bas de facture : payée, en retard, partiellement payée, sinon à payer. */
export function invoiceStatus(status: string, dueDate: string | null): { label: string; detail: string | null } {
  if (status === 'paid') return { label: 'Payée', detail: null }
  if (status === 'partial' || status === 'partially_paid') return { label: 'Partiellement payée', detail: dueDate ? `échéance le ${fmtLongDate(dueDate)}` : null }
  if (status === 'overdue') return { label: 'En retard', detail: dueDate ? `échéance dépassée le ${fmtLongDate(dueDate)}` : null }
  return { label: 'À payer', detail: dueDate ? `avant le ${fmtLongDate(dueDate)}` : null }
}
