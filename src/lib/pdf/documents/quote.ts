import type { PdfOrganizationData, QuoteDocumentClient, QuoteDocumentRecord } from '@/lib/pdf/document-types'
import { formatDimDetail, pdfText, splitItemDescription } from '@/lib/pdf/pdf-design-system'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { drawImageContained, embedImage } from '../engine/image'
import {
  K, bottomBlockTop, drawCompactHeader, drawHeader, drawKitTable, drawMeta, drawNote, drawOutlineBox, drawParties,
  drawTextCard, drawTotals, installFooter, measureCard,
  type CardParagraph, type KitCell, type KitColumn, type KitRow, type TotalLine,
} from '../engine/kit'
import { DECENNALE_LABEL, decennaleText, legalFooterLines, organizationPartyLines } from '../engine/legal'
import { COLOR, CONTENT_WIDTH, PAGE } from '../engine/theme'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number, currency = 'EUR') =>
  pdfText(new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n))

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })

function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

function clientDisplayName(client: QuoteDocumentClient): string {
  return client.company_name || [client.first_name, client.last_name].filter(Boolean).join(' ') || client.email || ''
}

export type QuotePdfData = {
  quote: QuoteDocumentRecord
  organization: PdfOrganizationData
  client: QuoteDocumentClient | null
}

export async function renderQuotePdf(data: QuotePdfData, origin: string): Promise<Buffer> {
  const fontBytes = await loadFontBytes(origin)
  return renderQuotePdfWithFonts(data, fontBytes)
}

export async function renderQuotePdfWithFonts(data: QuotePdfData, fontBytes: FontBytes): Promise<Buffer> {
  const { quote, organization, client } = data
  const doc = await PdfDoc.create(fontBytes)
  const F = doc.fonts

  const isVatSubject = organization.is_vat_subject !== false
  const isClientPro = client?.type === 'company'

  const visibleSections = quote.sections.map(s => ({
    ...s,
    items: s.items.filter(i => !i.is_internal),
  })).filter(s => s.items.length > 0)
  const visibleUnsectioned = quote.unsectionedItems.filter(i => !i.is_internal)

  const totalHt = [...visibleSections.flatMap(s => s.items), ...visibleUnsectioned]
    .reduce((s, i) => s + (i.quantity ?? 0) * (i.unit_price ?? 0), 0)
  const vatMap: Record<number, number> = {}
  if (isVatSubject) {
    for (const item of [...visibleSections.flatMap(s => s.items), ...visibleUnsectioned]) {
      if (item.quantity == null || item.unit_price == null || item.vat_rate == null) continue
      const v = item.quantity * item.unit_price * (item.vat_rate / 100)
      vatMap[item.vat_rate] = (vatMap[item.vat_rate] ?? 0) + v
    }
  }
  const totalTva = Object.values(vatMap).reduce((s, v) => s + v, 0)
  const totalTtc = isVatSubject ? totalHt + totalTva : totalHt

  const validUntil = quote.valid_until ? quote.valid_until : addDays(quote.created_at, quote.validity_days ?? 30)
  const hasClientSignature = Boolean(quote.signed_at && quote.client_signature_image)

  const logoImg = organization.logo_url ? await embedImage(doc.doc, organization.logo_url) : null
  const signatureImg = quote.client_signature_image ? await embedImage(doc.doc, quote.client_signature_image) : null

  const brand = { logo: logoImg, name: organization.name }
  const heading = { title: 'Devis', number: quote.number }
  doc.onNewPage = ({ pageIndex }) => pageIndex === 0 ? drawHeader(doc, brand, heading) : drawCompactHeader(doc, brand, heading)
  installFooter(doc, legalFooterLines(organization, isVatSubject))
  doc.addPage()

  // ── Repères, parties, demande ──
  drawMeta(doc, [
    { label: 'Date', value: fmtLongDate(quote.created_at) },
    { label: "Valable jusqu'au", value: fmtLongDate(validUntil) },
    ...(quote.title ? [{ label: 'Objet', value: quote.title }] : []),
  ])
  drawParties(
    doc,
    { label: 'De', name: organization.name, lines: organizationPartyLines(organization) },
    {
      label: 'Pour',
      name: client ? clientDisplayName(client) : '—',
      lines: client
        ? [
            client.address_line1,
            [client.postal_code, client.city].filter(Boolean).join(' ') || null,
            [client.email, client.phone].filter(Boolean).join(' · ') || null,
            client.siret ? `SIRET ${client.siret}` : null,
          ].filter((l): l is string => !!l).map(pdfText)
        : [],
    },
  )
  if (quote.client_request_description && quote.client_request_visible_on_pdf) {
    drawNote(doc, 'Votre demande', quote.client_request_description, 12)
  }
  if (quote.notes_client) drawNote(doc, null, quote.notes_client, 9)
  const decennale = decennaleText(organization)
  if (decennale) drawNote(doc, DECENNALE_LABEL, decennale, 9)

  // ── Tableau ──
  const withVat = isVatSubject
  const fixed = 52.5 + 61.5 + 69 + (withVat ? 33 : 0)
  const gap = 7.5
  const descWidth = CONTENT_WIDTH - fixed - gap * (withVat ? 4 : 3)
  const cols: KitColumn[] = [
    { width: descWidth, header: 'Désignation' },
    { width: 52.5, header: 'Qté' },
    { width: 61.5, header: 'P.U. HT' },
    ...(withVat ? [{ width: 33, header: 'TVA' }] : []),
    { width: 69, header: 'Total HT' },
  ]

  function itemToRow(item: (typeof visibleSections)[number]['items'][number]): KitRow {
    const legacyParts = splitItemDescription(item.description)
    const title = pdfText(item.designation?.trim() || legacyParts.title)
    const detailLines = item.details?.trim()
      ? item.details.split('\n').map(l => pdfText(l.replace(/^\s*[-•]\s*/, '').trim())).filter(Boolean)
      : legacyParts.details
    const dimDetail = formatDimDetail(item)
    const details = [
      ...(detailLines.length ? [`Comprend : ${detailLines.join(' · ')}`] : []),
      ...(dimDetail ? [dimDetail] : []),
    ]
    const quantity = item.quantity == null ? '' : `${item.quantity}${item.unit ? ` ${item.unit}` : ''}`
    const cells: KitCell[] = [
      { value: title, details },
      { value: quantity },
      item.price_pending
        ? { value: '—', color: COLOR.muted }
        : { value: item.unit_price == null ? '' : fmt(item.unit_price, quote.currency) },
    ]
    if (withVat) cells.push({ value: item.price_pending || item.vat_rate == null ? '' : `${item.vat_rate} %` })
    cells.push(
      item.price_pending
        ? { value: 'À confirmer', color: COLOR.muted }
        : { value: item.quantity == null || item.unit_price == null ? '' : fmt(item.quantity * item.unit_price, quote.currency), bold: true },
    )
    return { cells }
  }

  const rows: KitRow[] = []
  for (const section of visibleSections) {
    if (section.title) {
      const subtotal = section.items.filter(i => !i.price_pending).reduce((s, i) => s + (i.quantity ?? 0) * (i.unit_price ?? 0), 0)
      rows.push({ kind: 'section', title: section.title, amount: quote.show_section_subtotals ? fmt(subtotal, quote.currency) : undefined })
    }
    for (const item of section.items) rows.push(itemToRow(item))
  }
  for (const item of visibleUnsectioned) rows.push(itemToRow(item))
  drawKitTable(doc, cols, rows, { gap })

  // ── Totaux ──
  const totalLines: TotalLine[] = [{ label: 'Total HT', value: fmt(totalHt, quote.currency) }]
  if (isVatSubject) {
    for (const [rate, amount] of Object.entries(vatMap)) totalLines.push({ label: `TVA ${rate} %`, value: fmt(amount, quote.currency) })
  } else {
    totalLines.push({ label: 'TVA', value: 'Non applicable' })
  }
  drawTotals(doc, totalLines, { label: isVatSubject ? 'Total TTC' : 'Total HT', value: fmt(totalTtc, quote.currency) })
  if (!isVatSubject) drawNote(doc, null, 'TVA non applicable, art. 293B du CGI', 6)

  // ── Conditions et signature ──
  const gapCols = 12
  const leftW = (CONTENT_WIDTH - gapCols) * 1.25 / 2.25
  const rightW = CONTENT_WIDTH - gapCols - leftW
  const paragraphs: CardParagraph[] = []
  if (quote.payment_conditions) paragraphs.push({ text: quote.payment_conditions })
  if (organization.payment_terms_days) {
    paragraphs.push({ text: `Règlement à ${organization.payment_terms_days} jours à compter de la date de facturation.`, gapBefore: paragraphs.length ? 4.5 : 0 })
  }
  if (organization.iban) {
    paragraphs.push({ text: `Virement · IBAN ${organization.iban}${organization.bic ? ` · BIC ${organization.bic}` : ''}${organization.bank_name ? ` · ${organization.bank_name}` : ''}`, gapBefore: paragraphs.length ? 4.5 : 0 })
  }
  if (organization.late_penalty_rate) {
    paragraphs.push({ text: `Pénalités de retard : ${organization.late_penalty_rate} % par an.`, gapBefore: 4.5 })
    if (isClientPro) {
      paragraphs.push({ text: organization.recovery_indemnity_text ?? "Conformément à l'article L441-10 du Code de commerce, une indemnité forfaitaire de 40 € pour frais de recouvrement est due de plein droit en cas de retard de paiement." })
    }
  }
  if (organization.court_competent) paragraphs.push({ text: `En cas de litige : ${organization.court_competent}.` })

  const sigH = hasClientSignature ? 96 : 81
  const blockH = Math.max(paragraphs.length ? measureCard(doc, leftW, 'Conditions', paragraphs) : 0, sigH)
  const top = bottomBlockTop(doc, blockH, 12)
  if (paragraphs.length) drawTextCard(doc, PAGE.margin, top, leftW, 'Conditions', paragraphs, blockH)
  const sigX = PAGE.margin + leftW + gapCols
  drawOutlineBox(doc, sigX, top, rightW, blockH)
  doc.page.drawText('Bon pour accord', { x: sigX + 13.5, y: top - 10.5 - K.label, size: K.label, font: F.bold, color: COLOR.secondary })
  if (hasClientSignature) {
    let sy = top - 10.5 - K.label * 1.4 - 8
    const small = { size: K.small, font: F.regular, color: COLOR.body }
    doc.page.drawText(`Nom : ${pdfText(quote.client_signatory_name ?? '')}`, { x: sigX + 13.5, y: sy, ...small })
    if (quote.client_signatory_role) { sy -= 10.5; doc.page.drawText(`Qualité : ${pdfText(quote.client_signatory_role)}`, { x: sigX + 13.5, y: sy, ...small }) }
    sy -= 10.5
    doc.page.drawText(`Date : ${quote.signed_at ? fmtDate(quote.signed_at) : ''}`, { x: sigX + 13.5, y: sy, ...small })
    if (signatureImg) drawImageContained(doc, signatureImg, { x: sigX + 13.5, y: top - blockH + 6, w: rightW - 27, h: 34 }, 'center')
  } else {
    doc.page.drawText('Date, signature précédée de « Lu et approuvé »', { x: sigX + 13.5, y: top - blockH + 10.5, size: K.label, font: F.regular, color: COLOR.secondary })
  }
  doc.y = top - blockH

  return doc.save()
}

const fmtLongDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
