import type { Organization } from '@/lib/data/queries/organization'
import type { InvoiceWithItems } from '@/lib/data/queries/invoices'
import { fmtCapitalSocial, formatDimDetail, pdfText, splitItemDescription } from '@/lib/pdf/pdf-design-system'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { embedImage } from '../engine/image'
import { drawImageContained } from '../engine/image'
import { drawKeyValueRow, textLineHeight, wrapText, type TextStyle } from '../engine/text'
import { drawTable, type TableCell, type TableColumn, type TableRow } from '../engine/table'
import { COL, COL_DESC_WIDTH, COLOR, CONTENT_WIDTH, PAGE, SIZE, SPACE } from '../engine/theme'

const INVOICE_SECTION_UNIT = '__section__'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number, currency = 'EUR') =>
  pdfText(new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n))

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })

function clientDisplayName(client: NonNullable<InvoiceWithItems['client']>): string {
  return client.company_name
    || [client.first_name, client.last_name].filter(Boolean).join(' ')
    || client.email
    || '-'
}

export type InvoicePdfData = {
  invoice: InvoiceWithItems
  organization: Organization
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
    invoiceType === 'acompte'   ? "FACTURE D'ACOMPTE" :
    invoiceType === 'solde'     ? 'FACTURE DE SOLDE'  :
    invoiceType === 'situation' ? `SITUATION DE TRAVAUX N°${invoice.situation_number ?? ''}` :
    'FACTURE'

  const items = (invoice.items ?? []).filter(i => !i.is_internal)
  const billableItems = items.filter(i => i.unit !== INVOICE_SECTION_UNIT)
  const currency = invoice.currency ?? 'EUR'

  const totalHt = billableItems.reduce((s, i) => s + i.quantity * i.unit_price, 0)
  const vatMap: Record<number, number> = {}
  if (isVatSubject) {
    for (const item of billableItems) {
      const v = item.quantity * item.unit_price * (item.vat_rate / 100)
      vatMap[item.vat_rate] = (vatMap[item.vat_rate] ?? 0) + v
    }
  }
  const totalTva = Object.values(vatMap).reduce((s, v) => s + v, 0)
  const totalTtc = (isVatSubject && !isReverseCharge) ? totalHt + totalTva : totalHt

  const orgStreet = organization.address_line1 ?? null
  const orgPostalCity = [organization.postal_code, organization.city].filter(Boolean).join(' ') || null

  const line1Parts: string[] = []
  if (organization.forme_juridique) line1Parts.push(organization.forme_juridique)
  const capitalFmt = fmtCapitalSocial(organization.capital_social)
  if (capitalFmt) line1Parts.push(`Capital social : ${capitalFmt}`)

  const line2Parts: string[] = []
  if (organization.siret) line2Parts.push(`SIRET : ${organization.siret}`)
  if (organization.rcs && organization.rcs_ville) line2Parts.push(`RCS ${organization.rcs_ville} ${organization.rcs}`)
  else if (organization.rcs) line2Parts.push(`RCS ${organization.rcs}`)
  if (!isVatSubject) line2Parts.push('TVA non applicable, art. 293B du CGI')
  else if (organization.vat_number) line2Parts.push(`TVA : ${organization.vat_number}`)

  let insuranceLine: string | null = null
  if (organization.insurance_info) {
    const label = organization.decennale_enabled
      ? 'Assurance responsabilité civile professionnelle et décennale'
      : 'Assurance responsabilité civile professionnelle'
    insuranceLine = `${label} : ${organization.insurance_info}`
  }

  const legalLines: string[] = [
    line1Parts.join(' · '),
    line2Parts.join(' · '),
    insuranceLine,
    organization.certifications,
    isReverseCharge ? 'Autoliquidation de la TVA — art. 283-2 nonies du CGI. La TVA est due par le preneur assujetti.' : null,
  ].filter((l): l is string => !!l && l.length > 0)

  const logoImg = organization.logo_url ? await embedImage(doc.doc, organization.logo_url) : null

  // ── Header répété sur chaque page ──
  doc.onNewPage = ({ page }) => {
    let y = PAGE.height - PAGE.headerTop
    const headerTop = y

    if (logoImg) {
      drawImageContained(doc, logoImg, { x: PAGE.margin, y: headerTop - 45, w: 90, h: 45 })
    } else {
      page.drawRectangle({ x: PAGE.margin, y: headerTop - 45, width: 90, height: 45, color: COLOR.black })
      page.drawText(pdfText(organization.name.slice(0, 2).toUpperCase()), {
        x: PAGE.margin + 30, y: headerTop - 28, size: SIZE.lg, font: F.headingXBold, color: COLOR.white,
      })
    }

    const rightX = PAGE.width - PAGE.margin - 210
    let ry = headerTop
    const drawRight = (text: string, style: TextStyle) => {
      const w = style.font.widthOfTextAtSize(text, style.size)
      ry -= style.size
      page.drawText(text, { x: rightX + 210 - w, y: ry, size: style.size, font: style.font, color: style.color })
      ry -= textLineHeight(style) - style.size
    }
    drawRight(pdfText(organization.name).toUpperCase(), { font: F.headingXBold, size: SIZE.md, color: COLOR.black })
    ry -= 4
    if (orgStreet) drawRight(pdfText(orgStreet), { font: F.regular, size: SIZE.xs, color: COLOR.secondary })
    if (orgPostalCity) drawRight(pdfText(orgPostalCity), { font: F.regular, size: SIZE.xs, color: COLOR.secondary })
    if (organization.phone) drawRight(`Tél : ${pdfText(organization.phone)}`, { font: F.regular, size: SIZE.xs, color: COLOR.secondary })
    if (organization.email) drawRight(pdfText(organization.email), { font: F.regular, size: SIZE.xs, color: COLOR.secondary })
    if (organization.siret) drawRight(`SIRET : ${pdfText(organization.siret)}`, { font: F.regular, size: SIZE.xs, color: COLOR.secondary })
    if (isVatSubject && organization.vat_number) drawRight(`TVA : ${pdfText(organization.vat_number)}`, { font: F.regular, size: SIZE.xs, color: COLOR.secondary })
    if (!isVatSubject) drawRight('TVA non applicable, art. 293B CGI', { font: F.regular, size: SIZE.xs, color: COLOR.secondary })

    y = Math.min(headerTop - 45, ry) - SPACE.sm
    page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.width - PAGE.margin, y }, thickness: 1, color: COLOR.divider })
    y -= SPACE.sm
    return y
  }

  doc.addPage()

  doc.onFinishPage = ({ page, pageIndex, pageCount }) => {
    const footerY = 14
    const lineStep = SIZE.xxs * 1.4
    page.drawLine({ start: { x: PAGE.margin, y: footerY + 8 + legalLines.length * lineStep }, end: { x: PAGE.width - PAGE.margin, y: footerY + 8 + legalLines.length * lineStep }, thickness: 0.5, color: COLOR.divider })
    let ly = footerY + (legalLines.length - 1) * lineStep
    for (const line of legalLines) {
      page.drawText(line, { x: PAGE.margin, y: ly, size: SIZE.xxs, font: F.regular, color: COLOR.muted })
      ly -= lineStep
    }
    if (pageCount > 1) {
      const label = `${pageIndex + 1} / ${pageCount}`
      const w = F.regular.widthOfTextAtSize(label, SIZE.xxs)
      page.drawText(label, { x: PAGE.width - PAGE.margin - w, y: footerY, size: SIZE.xxs, font: F.regular, color: COLOR.muted })
    }
  }

  // ── Title block ──
  const titleText = isSituation && invoice.number
    ? null // rendu en 2 lignes ci-dessous
    : `${invoiceTypeLabel}${invoice.number ? ` N° ${invoice.number}` : ''}`

  doc.ensureSpace(SIZE.xxxl * (titleText ? 1 : 2) + 20)
  if (isSituation && invoice.number) {
    doc.y -= SIZE.xl
    doc.page.drawText(invoiceTypeLabel, { x: PAGE.margin, y: doc.y, size: SIZE.xl, font: F.headingXBold, color: COLOR.black })
    doc.y -= 2
    doc.y -= SIZE.xl
    doc.page.drawText(`N° ${invoice.number}`, { x: PAGE.margin, y: doc.y, size: SIZE.xl, font: F.headingXBold, color: COLOR.black })
  } else {
    doc.y -= SIZE.xxxl
    doc.page.drawText(titleText!, { x: PAGE.margin, y: doc.y, size: SIZE.xxxl, font: F.headingXBold, color: COLOR.black })
  }
  doc.y -= 4
  doc.y -= SIZE.xs
  if (invoice.issue_date) {
    doc.page.drawText(`Date : ${fmtDate(invoice.issue_date)}`, { x: PAGE.margin, y: doc.y, size: SIZE.xs, font: F.regular, color: COLOR.secondary })
  }
  if (invoice.due_date) {
    doc.page.drawText(`Échéance : ${fmtDate(invoice.due_date)}`, { x: PAGE.margin + 150, y: doc.y, size: SIZE.xs, font: F.regular, color: COLOR.secondary })
  }
  doc.y -= SPACE.xs
  doc.page.drawRectangle({ x: PAGE.margin, y: doc.y, width: 40, height: 3, color: COLOR.accent })
  doc.y -= SPACE.xs
  doc.page.drawLine({ start: { x: PAGE.margin, y: doc.y }, end: { x: PAGE.width - PAGE.margin, y: doc.y }, thickness: 1, color: COLOR.black })
  doc.y -= SPACE.sm

  // ── Address blocks ──
  const addrBoxW = (CONTENT_WIDTH - SPACE.md) / 2
  function measureAddressBlock(lines: string[]): number {
    return SPACE.sm * 2 + SIZE.xxs + SPACE.xs + SIZE.md + 3 + lines.length * (SIZE.xs + 2)
  }
  function drawAddressBlock(x: number, label: string, name: string, lines: string[]): void {
    const h = measureAddressBlock(lines)
    doc.page.drawRectangle({ x, y: doc.y - h, width: addrBoxW, height: h, color: COLOR.surface })
    let cy = doc.y - SPACE.sm - SIZE.xxs
    doc.page.drawText(label.toUpperCase(), { x: x + SPACE.md, y: cy, size: SIZE.xxs, font: F.headingXBold, color: COLOR.secondary })
    cy -= SPACE.xs + SIZE.md
    doc.page.drawText(name, { x: x + SPACE.md, y: cy, size: SIZE.md, font: F.heading, color: COLOR.black })
    cy -= 3
    for (const line of lines) {
      cy -= SIZE.xs
      doc.page.drawText(line, { x: x + SPACE.md, y: cy, size: SIZE.xs, font: F.regular, color: COLOR.secondary })
      cy -= 2
    }
  }

  const orgLines = [orgStreet, orgPostalCity, organization.email, organization.siren ? `SIREN : ${organization.siren}` : null]
    .filter((l): l is string => !!l).map(pdfText)
  const invClient = invoice.client
  const clientLines = invClient
    ? [
        invClient.address_line1,
        [invClient.postal_code, invClient.city].filter(Boolean).join(' ') || null,
        invClient.email,
        invClient.phone,
        invClient.siret ? `SIRET : ${invClient.siret}` : (invClient.siren ? `SIREN : ${invClient.siren}` : null),
        invClient.vat_number ? `TVA : ${invClient.vat_number}` : null,
      ].filter((l): l is string => !!l).map(pdfText)
    : ['—']

  const addrBlockH = Math.max(measureAddressBlock(orgLines), measureAddressBlock(clientLines))
  doc.ensureSpace(addrBlockH)
  const addrY = doc.y
  drawAddressBlock(PAGE.margin, 'Émetteur', pdfText(organization.name), orgLines)
  doc.y = addrY
  drawAddressBlock(PAGE.margin + addrBoxW + SPACE.md, 'Facturé à', invClient ? pdfText(clientDisplayName(invClient)) : '—', clientLines)
  doc.y = addrY - addrBlockH
  doc.moveDown(SPACE.sm)

  // ── Garantie décennale ──
  if (organization.decennale_enabled && organization.decennale_assureur) {
    const parts = [
      `Assureur : ${organization.decennale_assureur}`,
      organization.decennale_police ? `Police n° ${organization.decennale_police}` : '',
      organization.decennale_couverture ? `Couverture : ${organization.decennale_couverture}` : '',
      (organization.decennale_date_debut || organization.decennale_date_fin)
        ? `Validité : ${organization.decennale_date_debut ? new Date(organization.decennale_date_debut).toLocaleDateString('fr-FR') : '?'} - ${organization.decennale_date_fin ? new Date(organization.decennale_date_fin).toLocaleDateString('fr-FR') : '?'}`
        : '',
    ].filter(Boolean)
    drawBoxedText(doc, 'Garantie décennale - Art. L241-1 Code des assurances', parts.join('  ·  '), F)
  }

  // ── Bloc situation de travaux ──
  if (isSituation) {
    const lines: string[] = []
    if (invoice.quote_id) {
      lines.push(`Avancement cumulé : ${invoice.cumulative_pct ?? 0}%${invoice.quote_number ? ` · sur devis N° ${invoice.quote_number}` : ''}`)
    }
    if (invoice.period_from && invoice.period_to) {
      lines.push(`Période d'exécution : du ${new Date(invoice.period_from).toLocaleDateString('fr-FR')} au ${new Date(invoice.period_to).toLocaleDateString('fr-FR')}`)
    }
    if (invoice.market_reference) lines.push(`Référence marché : ${invoice.market_reference}`)
    if ((invoice.retention_pct ?? 0) > 0) {
      lines.push(`Retenue de garantie : ${invoice.retention_pct}% (${fmt(invoice.retention_amount ?? 0, currency)})`)
    }
    drawBoxedText(doc, invoiceTypeLabel, lines.join('\n'), F, true)
  }

  // ── Notes client ──
  if (invoice.notes_client && !isSituation) {
    drawIntroBox(doc, invoice.notes_client, F)
  }

  // ── Table ──
  const withVat = isVatSubject
  const cols: TableColumn[] = [
    { width: COL_DESC_WIDTH(withVat), header: 'Désignation' },
    { width: COL.qty, header: 'Qté', align: 'right' },
    { width: COL.unit, header: 'Unité', align: 'center' },
    { width: COL.pu, header: 'PU HT', align: 'right' },
    ...(withVat ? [{ width: COL.vat, header: 'TVA %', align: 'right' as const }] : []),
    { width: COL.total, header: 'Total HT', align: 'right' },
  ]

  const cellStyle: TextStyle = { font: F.regular, size: SIZE.sm, color: COLOR.body }
  const detailStyle: TextStyle = { font: F.regular, size: SIZE.xs, color: COLOR.muted }
  const headerStyle: TextStyle = { font: F.headingXBold, size: SIZE.xxs, color: COLOR.black }

  function itemToRow(item: InvoiceWithItems['items'][number]): TableRow {
    const parts = splitItemDescription(item.description)
    const dimDetail = formatDimDetail(item)
    const detailLines = dimDetail
      ? [...(parts.details.length ? [`Comprend : ${parts.details.join(' · ')}`] : []), dimDetail]
      : (parts.details.length ? [`Comprend : ${parts.details.join(' · ')}`] : [])

    const cells: TableCell[] = [
      { value: parts.title, detailLines },
      { value: String(item.quantity) },
      { value: pdfText(item.unit) },
      { value: fmt(item.unit_price, currency) },
    ]
    if (withVat) cells.push({ value: `${item.vat_rate}%` })
    cells.push({ value: fmt(item.quantity * item.unit_price, currency) })
    return { cells }
  }

  const rows: TableRow[] = []
  for (const item of items) {
    if (item.unit === INVOICE_SECTION_UNIT) {
      rows.push({
        cells: [
          { value: pdfText(item.description).toUpperCase(), style: { font: F.heading, size: SIZE.sm, color: COLOR.black } },
          ...cols.slice(1).map(() => ({ value: '' })),
        ],
        zebra: true,
      })
    } else {
      rows.push(itemToRow(item))
    }
  }

  drawTable(doc, cols, rows, {
    x: PAGE.margin,
    headerStyle,
    cellStyle,
    detailStyle,
    rowPaddingY: SPACE.sm,
    headerPaddingY: SPACE.sm,
    repeatHeader: true,
  })

  doc.moveDown(SPACE.xs)
  doc.ensureSpace(2)
  doc.page.drawLine({ start: { x: PAGE.margin, y: doc.y }, end: { x: PAGE.width - PAGE.margin, y: doc.y }, thickness: 1, color: COLOR.black })
  doc.moveDown(SPACE.sm)

  // ── Totaux ──
  const totalsBoxW = 250
  const totalsX = PAGE.width - PAGE.margin - totalsBoxW
  const rowH = SIZE.sm + SPACE.sm * 2
  const labelStyle: TextStyle = { font: F.regular, size: SIZE.sm, color: COLOR.secondary }
  const valueStyle: TextStyle = { font: F.heading, size: SIZE.sm, color: COLOR.black }

  doc.ensureSpace(rowH * (1 + Object.keys(vatMap).length) + SIZE.md + SPACE.md * 2)
  drawKeyValueRow(doc, 'Total HT', fmt(totalHt, currency), { x: totalsX, width: totalsBoxW, labelStyle, valueStyle, rowHeight: rowH })
  doc.page.drawLine({ start: { x: totalsX, y: doc.y }, end: { x: totalsX + totalsBoxW, y: doc.y }, thickness: 0.5, color: COLOR.divider })

  if (isReverseCharge) {
    drawKeyValueRow(doc, 'TVA', 'Autoliquidation', { x: totalsX, width: totalsBoxW, labelStyle, valueStyle: { ...valueStyle, color: COLOR.muted }, rowHeight: rowH })
    doc.page.drawLine({ start: { x: totalsX, y: doc.y }, end: { x: totalsX + totalsBoxW, y: doc.y }, thickness: 0.5, color: COLOR.divider })
  } else if (isVatSubject) {
    for (const [rate, amount] of Object.entries(vatMap)) {
      drawKeyValueRow(doc, `TVA ${rate}%`, fmt(amount, currency), { x: totalsX, width: totalsBoxW, labelStyle, valueStyle, rowHeight: rowH })
      doc.page.drawLine({ start: { x: totalsX, y: doc.y }, end: { x: totalsX + totalsBoxW, y: doc.y }, thickness: 0.5, color: COLOR.divider })
    }
  } else {
    drawKeyValueRow(doc, 'TVA', 'Non applicable', { x: totalsX, width: totalsBoxW, labelStyle, valueStyle: { ...valueStyle, color: COLOR.muted }, rowHeight: rowH })
    doc.page.drawLine({ start: { x: totalsX, y: doc.y }, end: { x: totalsX + totalsBoxW, y: doc.y }, thickness: 0.5, color: COLOR.divider })
  }

  doc.moveDown(SPACE.sm)
  const ttcRowH = SIZE.md + SPACE.md * 2
  doc.ensureSpace(ttcRowH)
  doc.page.drawRectangle({ x: totalsX, y: doc.y - ttcRowH, width: totalsBoxW, height: ttcRowH, color: COLOR.black })
  drawKeyValueRow(doc, isReverseCharge ? 'TOTAL NET HT' : isVatSubject ? 'TOTAL TTC' : 'TOTAL HT', fmt(totalTtc, currency), {
    x: totalsX + SPACE.md, width: totalsBoxW - SPACE.md * 2,
    labelStyle: { font: F.headingXBold, size: SIZE.md, color: COLOR.white },
    valueStyle: { font: F.headingXBold, size: SIZE.md, color: COLOR.white },
    rowHeight: ttcRowH,
  })

  if (!isVatSubject) {
    doc.ensureSpace(SIZE.xs + 4)
    doc.y -= SIZE.xs
    const label = 'TVA non applicable, art. 293B du CGI'
    const w = F.regular.widthOfTextAtSize(label, SIZE.xs)
    doc.page.drawText(label, { x: totalsX + totalsBoxW - w, y: doc.y, size: SIZE.xs, font: F.regular, color: COLOR.muted })
    doc.y -= 4
  }

  if (invoice.aid_label && invoice.aid_amount != null && invoice.aid_amount > 0) {
    doc.moveDown(SPACE.sm)
    doc.ensureSpace(rowH)
    drawKeyValueRow(doc, pdfText(invoice.aid_label), `−${fmt(invoice.aid_amount, currency)}`, {
      x: totalsX, width: totalsBoxW, labelStyle, valueStyle: { ...valueStyle, color: COLOR.green }, rowHeight: rowH,
    })
    doc.moveDown(SPACE.xs)
    const rac = Math.max(0, totalTtc - invoice.aid_amount)
    doc.ensureSpace(ttcRowH)
    doc.page.drawRectangle({ x: totalsX, y: doc.y - ttcRowH, width: totalsBoxW, height: ttcRowH, color: COLOR.accent })
    drawKeyValueRow(doc, 'RESTE À CHARGE', fmt(rac, currency), {
      x: totalsX + SPACE.md, width: totalsBoxW - SPACE.md * 2,
      labelStyle: { font: F.headingXBold, size: SIZE.md, color: COLOR.white },
      valueStyle: { font: F.headingXBold, size: SIZE.md, color: COLOR.white },
      rowHeight: ttcRowH,
    })
  }

  if (isSituation && (invoice.retention_pct ?? 0) > 0) {
    doc.moveDown(SPACE.sm)
    doc.ensureSpace(rowH)
    drawKeyValueRow(doc, `Retenue de garantie ${invoice.retention_pct}%`, `−${fmt(invoice.retention_amount ?? 0, currency)}`, {
      x: totalsX, width: totalsBoxW, labelStyle, valueStyle: { ...valueStyle, color: COLOR.orange }, rowHeight: rowH,
    })
    doc.moveDown(SPACE.xs)
    const netAPayer = Math.max(0, totalHt - (invoice.retention_amount ?? 0))
    doc.ensureSpace(ttcRowH)
    doc.page.drawRectangle({ x: totalsX, y: doc.y - ttcRowH, width: totalsBoxW, height: ttcRowH, color: COLOR.accent })
    drawKeyValueRow(doc, 'NET À PAYER HT', fmt(netAPayer, currency), {
      x: totalsX + SPACE.md, width: totalsBoxW - SPACE.md * 2,
      labelStyle: { font: F.headingXBold, size: SIZE.md, color: COLOR.white },
      valueStyle: { font: F.headingXBold, size: SIZE.md, color: COLOR.white },
      rowHeight: ttcRowH,
    })
  }

  // ── Modalités de règlement ──
  if (organization.iban || organization.payment_terms_days || invoice.payment_conditions) {
    doc.moveDown(SPACE.xl)
    drawConditionsBlock(doc, 'Modalités de règlement', invoice.payment_conditions
      ? [pdfText(invoice.payment_conditions)]
      : organization.payment_terms_days
        ? [`Règlement à ${organization.payment_terms_days} jours à compter de la date de facturation.`]
        : [], F)
    if (organization.iban) {
      drawConditionsLine(doc, `Virement · IBAN : ${organization.iban}${organization.bic ? `  ·  BIC : ${organization.bic}` : ''}${organization.bank_name ? `  ·  ${organization.bank_name}` : ''}`, F)
    }
  }

  // ── Pénalités ──
  if (organization.late_penalty_rate) {
    doc.moveDown(SPACE.sm)
    const text = `Pénalités de retard : ${organization.late_penalty_rate}% par an exigibles dès le lendemain de la date d'échéance, sans mise en demeure préalable.`
      + (isClientPro ? ` ${organization.recovery_indemnity_text ?? "Conformément à l'article L441-10 du Code de commerce, une indemnité forfaitaire de 40 € pour frais de recouvrement est due de plein droit en cas de retard de paiement."}` : '')
      + (organization.court_competent ? ` En cas de litige : ${organization.court_competent}.` : '')
    drawConditionsLine(doc, text, F)
  }

  return doc.save()
}

// ─── Helpers de blocs ────────────────────────────────────────────────────────

function drawBoxedText(doc: PdfDoc, label: string, text: string, F: PdfDoc['fonts'], multiline = false): void {
  const labelStyle: TextStyle = { font: F.heading, size: SIZE.xxs, color: COLOR.secondary, maxWidth: CONTENT_WIDTH - SPACE.sm * 2 }
  const textStyle: TextStyle = { font: F.regular, size: SIZE.sm, color: COLOR.body, maxWidth: CONTENT_WIDTH - SPACE.sm * 2, lineHeight: 1.4 }
  const labelH = textLineHeight(labelStyle)

  const paragraphs = multiline ? text.split('\n').filter(Boolean) : [text]
  const allLines: string[] = []
  for (const p of paragraphs) allLines.push(...wrapText(pdfText(p), textStyle.font, textStyle.size, textStyle.maxWidth!))
  const textH = allLines.length * textLineHeight(textStyle)
  const boxH = SPACE.sm * 2 + labelH + SPACE.xs + textH

  doc.ensureSpace(boxH)
  doc.page.drawRectangle({ x: PAGE.margin, y: doc.y - boxH, width: CONTENT_WIDTH, height: boxH, color: COLOR.surface })
  let cy = doc.y - SPACE.sm - labelStyle.size
  doc.page.drawText(label.toUpperCase(), { x: PAGE.margin + SPACE.sm, y: cy, size: labelStyle.size, font: labelStyle.font, color: labelStyle.color })
  cy -= (labelH - labelStyle.size) + SPACE.xs
  for (const line of allLines) {
    cy -= textStyle.size
    doc.page.drawText(line, { x: PAGE.margin + SPACE.sm, y: cy, size: textStyle.size, font: textStyle.font, color: textStyle.color })
    cy -= textLineHeight(textStyle) - textStyle.size
  }
  doc.y -= boxH
  doc.moveDown(SPACE.sm)
}

function drawIntroBox(doc: PdfDoc, text: string, F: PdfDoc['fonts']): void {
  const textStyle: TextStyle = { font: F.regular, size: SIZE.sm, color: COLOR.body, maxWidth: CONTENT_WIDTH - SPACE.sm * 2 - 2, lineHeight: 1.5 }
  const lines = wrapText(pdfText(text), textStyle.font, textStyle.size, textStyle.maxWidth!)
  const textH = lines.length * textLineHeight(textStyle)
  const boxH = SPACE.sm * 2 + textH

  doc.ensureSpace(boxH)
  doc.page.drawRectangle({ x: PAGE.margin, y: doc.y - boxH, width: CONTENT_WIDTH, height: boxH, color: COLOR.surface })
  doc.page.drawRectangle({ x: PAGE.margin, y: doc.y - boxH, width: 2, height: boxH, color: COLOR.accent })
  let cy = doc.y - SPACE.sm - textStyle.size
  for (const line of lines) {
    doc.page.drawText(line, { x: PAGE.margin + SPACE.sm, y: cy, size: textStyle.size, font: textStyle.font, color: textStyle.color })
    cy -= textLineHeight(textStyle)
  }
  doc.y -= boxH
  doc.moveDown(SPACE.sm)
}

function drawConditionsBlock(doc: PdfDoc, title: string, lines: string[], F: PdfDoc['fonts']): void {
  doc.ensureSpace(SIZE.xs + 6)
  doc.y -= SIZE.xs
  doc.page.drawText(title.toUpperCase(), { x: PAGE.margin, y: doc.y, size: SIZE.xs, font: F.heading, color: COLOR.black })
  doc.y -= 6
  for (const line of lines) drawConditionsLine(doc, line, F)
}

function drawConditionsLine(doc: PdfDoc, text: string, F: PdfDoc['fonts']): void {
  const style: TextStyle = { font: F.regular, size: SIZE.xs, color: COLOR.secondary, maxWidth: CONTENT_WIDTH, lineHeight: 1.4 }
  const lines = wrapText(pdfText(text), style.font, style.size, style.maxWidth!)
  const lh = textLineHeight(style)
  for (const line of lines) {
    doc.ensureSpace(lh)
    doc.y -= style.size
    doc.page.drawText(line, { x: PAGE.margin, y: doc.y, size: style.size, font: style.font, color: style.color })
    doc.y -= lh - style.size
  }
  doc.y -= 2
}
