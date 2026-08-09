import type { Organization } from '@/lib/data/queries/organization'
import type { QuoteWithItems } from '@/lib/data/queries/quotes'
import type { Client } from '@/lib/data/queries/clients'
import { fmtCapitalSocial, formatDimDetail, pdfText, splitItemDescription } from '@/lib/pdf/pdf-design-system'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { drawImageContained, embedImage } from '../engine/image'
import { drawKeyValueRow, textLineHeight, wrapText, type TextStyle } from '../engine/text'
import { drawSolidBlock, drawTable, type TableCell, type TableColumn, type TableRow } from '../engine/table'
import { COL, COL_DESC_WIDTH, COLOR, CONTENT_WIDTH, PAGE, SIZE, SPACE } from '../engine/theme'

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

function clientDisplayName(client: Client): string {
  return client.company_name || [client.first_name, client.last_name].filter(Boolean).join(' ') || client.email || ''
}

export type QuotePdfData = {
  quote: QuoteWithItems & { notes_client?: string | null; payment_conditions?: string | null }
  organization: Organization
  client: Client | null
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
    .reduce((s, i) => s + i.quantity * i.unit_price, 0)
  const vatMap: Record<number, number> = {}
  if (isVatSubject) {
    for (const item of [...visibleSections.flatMap(s => s.items), ...visibleUnsectioned]) {
      const v = item.quantity * item.unit_price * (item.vat_rate / 100)
      vatMap[item.vat_rate] = (vatMap[item.vat_rate] ?? 0) + v
    }
  }
  const totalTva = Object.values(vatMap).reduce((s, v) => s + v, 0)
  const totalTtc = isVatSubject ? totalHt + totalTva : totalHt

  const validUntil = quote.valid_until ? quote.valid_until : addDays(quote.created_at, quote.validity_days ?? 30)
  const hasClientSignature = Boolean(quote.signed_at && quote.client_signature_image)

  const orgStreet = organization.address_line1 ?? null
  const orgPostalCity = [organization.postal_code, organization.city].filter(Boolean).join(' ') || null

  // ── Footer légal multi-ligne (identique à l'ancienne version react-pdf) ──
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
  ].filter((l): l is string => !!l && l.length > 0)

  // ── Logo (une seule fois, réutilisé sur chaque page) ──
  const logoImg = organization.logo_url ? await embedImage(doc.doc, organization.logo_url) : null
  const signatureImg = quote.client_signature_image ? await embedImage(doc.doc, quote.client_signature_image) : null

  // ── Header répété sur chaque nouvelle page ──
  doc.onNewPage = ({ page }) => {
    let y = PAGE.height - PAGE.headerTop
    const headerTop = y

    // Logo à gauche
    if (logoImg) {
      drawImageContained(doc, logoImg, { x: PAGE.margin, y: headerTop - 45, w: 90, h: 45 })
    } else {
      page.drawRectangle({ x: PAGE.margin, y: headerTop - 45, width: 90, height: 45, color: COLOR.black })
      page.drawText(pdfText(organization.name.slice(0, 2).toUpperCase()), {
        x: PAGE.margin + 30, y: headerTop - 28, size: SIZE.lg, font: F.headingXBold, color: COLOR.white,
      })
    }

    // Bloc entreprise à droite (aligné à droite)
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

    y = Math.min(headerTop - 45, ry) - SPACE.md
    page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.width - PAGE.margin, y }, thickness: 1, color: COLOR.divider })
    y -= SPACE.md
    return y
  }

  doc.addPage()

  // ── Footer légal + pagination, dessiné en 2e passe sur chaque page ──
  doc.onFinishPage = ({ page, pageIndex, pageCount }) => {
    const footerY = 14
    page.drawLine({ start: { x: PAGE.margin, y: footerY + 12 }, end: { x: PAGE.width - PAGE.margin, y: footerY + 12 }, thickness: 0.5, color: COLOR.divider })
    let ly = footerY + 12 - 4
    for (const line of legalLines) {
      ly -= SIZE.xxs
      page.drawText(line, { x: PAGE.margin, y: ly, size: SIZE.xxs, font: F.regular, color: COLOR.muted })
      ly -= (SIZE.xxs * 1.4) - SIZE.xxs
    }
    if (pageCount > 1) {
      const label = `${pageIndex + 1} / ${pageCount}`
      const w = F.regular.widthOfTextAtSize(label, SIZE.xxs)
      page.drawText(label, { x: PAGE.width - PAGE.margin - w, y: footerY, size: SIZE.xxs, font: F.regular, color: COLOR.muted })
    }
  }

  // ── Title block ──
  const titleText = `DEVIS${quote.number ? ` N° ${quote.number}` : ''}`
  doc.ensureSpace(SIZE.xxxl + 20)
  doc.y -= SIZE.xxxl
  doc.page.drawText(titleText, { x: PAGE.margin, y: doc.y, size: SIZE.xxxl, font: F.headingXBold, color: COLOR.black })
  doc.y -= 6
  doc.y -= SIZE.xs
  doc.page.drawText(`Date : ${fmtDate(quote.created_at)}`, { x: PAGE.margin, y: doc.y, size: SIZE.xs, font: F.regular, color: COLOR.secondary })
  doc.page.drawText(`Valable jusqu'au : ${fmtDate(validUntil)}`, { x: PAGE.margin + 150, y: doc.y, size: SIZE.xs, font: F.regular, color: COLOR.secondary })
  doc.y -= SPACE.sm
  doc.page.drawRectangle({ x: PAGE.margin, y: doc.y, width: 40, height: 3, color: COLOR.accent })
  doc.y -= SPACE.sm
  doc.page.drawLine({ start: { x: PAGE.margin, y: doc.y }, end: { x: PAGE.width - PAGE.margin, y: doc.y }, thickness: 1, color: COLOR.black })
  doc.y -= SPACE.md

  // ── Address blocks (émetteur / client) ──
  const addrBoxW = (CONTENT_WIDTH - SPACE.md) / 2
  const addrLabelStyle: TextStyle = { font: F.headingXBold, size: SIZE.xxs, color: COLOR.secondary }
  const addrNameStyle: TextStyle = { font: F.heading, size: SIZE.md, color: COLOR.black }
  const addrLineStyle: TextStyle = { font: F.regular, size: SIZE.xs, color: COLOR.secondary }

  function measureAddressBlock(lines: string[]): number {
    return SPACE.md * 2 + SIZE.xxs + SPACE.sm + SIZE.md + 4 + lines.length * (SIZE.xs + 2)
  }

  function drawAddressBlock(x: number, label: string, name: string, lines: string[]): void {
    doc.page.drawRectangle({ x, y: doc.y - measureAddressBlock(lines), width: addrBoxW, height: measureAddressBlock(lines), color: COLOR.surface })
    let cy = doc.y - SPACE.md - SIZE.xxs
    doc.page.drawText(label.toUpperCase(), { x: x + SPACE.md, y: cy, size: SIZE.xxs, font: addrLabelStyle.font, color: addrLabelStyle.color })
    cy -= SPACE.sm + SIZE.md
    doc.page.drawText(name, { x: x + SPACE.md, y: cy, size: SIZE.md, font: addrNameStyle.font, color: addrNameStyle.color })
    cy -= 4
    for (const line of lines) {
      cy -= SIZE.xs
      doc.page.drawText(line, { x: x + SPACE.md, y: cy, size: SIZE.xs, font: addrLineStyle.font, color: addrLineStyle.color })
      cy -= 2
    }
  }

  const orgLines = [orgStreet, orgPostalCity, organization.email].filter((l): l is string => !!l).map(pdfText)
  const clientLines = client
    ? [
        client.address_line1,
        [client.postal_code, client.city].filter(Boolean).join(' ') || null,
        client.email,
        client.phone,
        client.siret ? `SIRET : ${client.siret}` : null,
      ].filter((l): l is string => !!l).map(pdfText)
    : ['—']

  const addrBlockH = Math.max(measureAddressBlock(orgLines), measureAddressBlock(clientLines))
  doc.ensureSpace(addrBlockH)
  const addrY = doc.y
  drawAddressBlock(PAGE.margin, 'Émetteur', pdfText(organization.name), orgLines)
  doc.y = addrY
  drawAddressBlock(PAGE.margin + addrBoxW + SPACE.md, 'Client', client ? pdfText(clientDisplayName(client)) : '—', clientLines)
  doc.y = addrY - addrBlockH
  doc.moveDown(SPACE.md)

  // ── Demande du client (formulaire public) ──
  if (quote.client_request_description && quote.client_request_visible_on_pdf) {
    drawBoxedText(doc, 'Votre demande', quote.client_request_description, F)
  }

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

  // ── Intro ──
  if (quote.notes_client) {
    drawIntroBox(doc, quote.notes_client, F)
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

  function itemToRow(item: (typeof visibleSections)[number]['items'][number]): TableRow {
    const legacyParts = splitItemDescription(item.description)
    const title = pdfText(item.designation?.trim() || legacyParts.title)
    const detailLines = item.details?.trim()
      ? item.details.split('\n').map(l => pdfText(l.replace(/^\s*[-•]\s*/, '').trim())).filter(Boolean)
      : legacyParts.details
    const dimDetail = formatDimDetail(item)
    const allDetails = dimDetail
      ? [...(detailLines.length ? [`Comprend : ${detailLines.join(' · ')}`] : []), dimDetail]
      : (detailLines.length ? [`Comprend : ${detailLines.join(' · ')}`] : [])

    const cells: TableCell[] = [
      { value: title, detailLines: allDetails },
      { value: String(item.quantity) },
      { value: item.unit ?? '' },
      item.price_pending
        ? { value: '—', style: { color: COLOR.gray } }
        : { value: fmt(item.unit_price, quote.currency) },
    ]
    if (withVat) cells.push({ value: item.price_pending ? '' : `${item.vat_rate}%` })
    cells.push(
      item.price_pending
        ? { value: 'A confirmer', style: { color: COLOR.gray } }
        : { value: fmt(item.quantity * item.unit_price, quote.currency) },
    )
    return { cells }
  }

  const rows: TableRow[] = []
  for (const section of visibleSections) {
    if (section.title) {
      rows.push({ cells: [{ value: section.title.toUpperCase(), style: { font: F.heading, size: SIZE.sm, color: COLOR.black } }, ...cols.slice(1).map(() => ({ value: '' }))] })
    }
    for (const item of section.items) rows.push(itemToRow(item))
    if (quote.show_section_subtotals && section.title && section.items.length > 0) {
      const subtotal = section.items.filter(i => !i.price_pending).reduce((s, i) => s + i.quantity * i.unit_price, 0)
      rows.push({
        cells: [
          { value: `Sous-total — ${section.title}`, style: { font: F.regular, size: SIZE.sm, color: COLOR.secondary } },
          ...cols.slice(1, -1).map(() => ({ value: '' })),
          { value: fmt(subtotal, quote.currency), style: { font: F.heading, size: SIZE.sm, color: COLOR.black } },
        ],
        zebra: true,
      })
    }
  }
  for (const item of visibleUnsectioned) rows.push(itemToRow(item))

  drawTable(doc, cols, rows, {
    x: PAGE.margin,
    headerStyle,
    cellStyle,
    detailStyle,
    rowPaddingY: SPACE.sm,
    headerPaddingY: SPACE.sm,
    repeatHeader: true,
  })

  doc.moveDown(SPACE.md)

  // ── Totaux ──
  const totalsBoxW = 250
  const totalsX = PAGE.width - PAGE.margin - totalsBoxW
  const rowH = SIZE.sm + SPACE.sm * 2
  const labelStyle: TextStyle = { font: F.regular, size: SIZE.sm, color: COLOR.secondary }
  const valueStyle: TextStyle = { font: F.heading, size: SIZE.sm, color: COLOR.black }

  doc.ensureSpace(rowH * (1 + Object.keys(vatMap).length) + SIZE.md + SPACE.md * 2)
  drawKeyValueRow(doc, 'Total HT', fmt(totalHt, quote.currency), { x: totalsX, width: totalsBoxW, labelStyle, valueStyle, rowHeight: rowH })
  doc.page.drawLine({ start: { x: totalsX, y: doc.y }, end: { x: totalsX + totalsBoxW, y: doc.y }, thickness: 0.5, color: COLOR.divider })

  if (isVatSubject) {
    for (const [rate, amount] of Object.entries(vatMap)) {
      drawKeyValueRow(doc, `TVA ${rate}%`, fmt(amount, quote.currency), { x: totalsX, width: totalsBoxW, labelStyle, valueStyle, rowHeight: rowH })
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
  drawKeyValueRow(doc, isVatSubject ? 'TOTAL TTC' : 'TOTAL HT', fmt(totalTtc, quote.currency), {
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

  doc.moveDown(SPACE.md)

  // ── Conditions + Signature ──
  const bottomColW = (CONTENT_WIDTH - SPACE.lg - 190) // conditionsBox flex, signatureBox 190 fixe
  const conditionsLines: { title?: string; text: string }[] = []
  if (quote.payment_conditions) conditionsLines.push({ title: 'Conditions de paiement', text: quote.payment_conditions })
  if (organization.iban || organization.payment_terms_days) {
    const parts: string[] = []
    if (organization.payment_terms_days) parts.push(`Règlement à ${organization.payment_terms_days} jours à compter de la date de facturation.`)
    conditionsLines.push({ title: 'Modalités de règlement', text: parts.join(' ') })
    if (organization.iban) {
      conditionsLines.push({ text: `Virement · IBAN : ${organization.iban}${organization.bic ? `  ·  BIC : ${organization.bic}` : ''}${organization.bank_name ? `  ·  ${organization.bank_name}` : ''}` })
    }
    if (organization.late_penalty_rate) {
      conditionsLines.push({ text: `Pénalités de retard : ${organization.late_penalty_rate}% par an.` })
      if (isClientPro) {
        conditionsLines.push({ text: organization.recovery_indemnity_text ?? "Conformément à l'article L441-10 du Code de commerce, une indemnité forfaitaire de 40 € pour frais de recouvrement est due de plein droit en cas de retard de paiement." })
      }
    }
    if (organization.court_competent) conditionsLines.push({ text: `En cas de litige : ${organization.court_competent}.` })
  }

  const condTextStyle: TextStyle = { font: F.regular, size: SIZE.xs, color: COLOR.secondary, maxWidth: bottomColW }
  const condLh = textLineHeight(condTextStyle)
  const sigBoxH = hasClientSignature ? 118 : 70
  const bottomBlockH = Math.max(
    conditionsLines.reduce((s, l) => {
      const wrapped = wrapText(pdfText(l.text), condTextStyle.font, condTextStyle.size, bottomColW)
      return s + (l.title ? SIZE.xs + 6 : 0) + wrapped.length * condLh + 2
    }, 0),
    sigBoxH,
  )
  doc.ensureSpace(bottomBlockH)
  const bottomY = doc.y

  let condY = bottomY
  for (const line of conditionsLines) {
    if (line.title) {
      condY -= SIZE.xs + 6
      doc.page.drawText(line.title.toUpperCase(), { x: PAGE.margin, y: condY, size: SIZE.xs, font: F.heading, color: COLOR.black })
    }
    const wrapped = wrapText(pdfText(line.text), condTextStyle.font, condTextStyle.size, bottomColW)
    for (const wline of wrapped) {
      condY -= SIZE.xs
      doc.page.drawText(wline, { x: PAGE.margin, y: condY, size: SIZE.xs, font: F.regular, color: COLOR.secondary })
      condY -= condLh - SIZE.xs
    }
    condY -= 2
  }

  const sigX = PAGE.width - PAGE.margin - 190
  doc.page.drawRectangle({ x: sigX, y: bottomY - sigBoxH, width: 190, height: sigBoxH, borderColor: COLOR.divider, borderWidth: 0.5, color: undefined })
  if (hasClientSignature) {
    let sy = bottomY - SPACE.md
    sy -= SIZE.xxs
    doc.page.drawText('BON POUR ACCORD', { x: sigX + SPACE.md, y: sy, size: SIZE.xxs, font: F.headingXBold, color: COLOR.black })
    sy -= SPACE.xs + SIZE.xxs
    doc.page.drawText(`Nom : ${pdfText(quote.client_signatory_name ?? '')}`, { x: sigX + SPACE.md, y: sy, size: SIZE.xxs, font: F.regular, color: COLOR.secondary })
    if (quote.client_signatory_role) {
      sy -= SIZE.xxs + 2
      doc.page.drawText(`Qualité : ${pdfText(quote.client_signatory_role)}`, { x: sigX + SPACE.md, y: sy, size: SIZE.xxs, font: F.regular, color: COLOR.secondary })
    }
    sy -= SIZE.xxs + 2
    doc.page.drawText(`Date : ${quote.signed_at ? fmtDate(quote.signed_at) : ''}`, { x: sigX + SPACE.md, y: sy, size: SIZE.xxs, font: F.regular, color: COLOR.secondary })
    if (signatureImg) {
      drawImageContained(doc, signatureImg, { x: sigX + (190 - 130) / 2, y: bottomY - sigBoxH + 4, w: 130, h: 46 }, 'center')
    }
  } else {
    const label = 'Bon pour accord, date et signature'
    const style: TextStyle = { font: F.regular, size: SIZE.xs, color: COLOR.muted, align: 'center', maxWidth: 190 - SPACE.md * 2 }
    const w = F.regular.widthOfTextAtSize(label, SIZE.xs)
    doc.page.drawText(label, { x: sigX + (190 - w) / 2, y: bottomY - sigBoxH + SPACE.md, size: SIZE.xs, font: F.regular, color: COLOR.muted })
    void style
  }

  doc.y = bottomY - bottomBlockH

  return doc.save()
}

// ─── Helpers de blocs encadrés ──────────────────────────────────────────────

function drawBoxedText(doc: PdfDoc, label: string, text: string, F: PdfDoc['fonts']): void {
  const labelStyle: TextStyle = { font: F.heading, size: SIZE.xxs, color: COLOR.secondary, maxWidth: CONTENT_WIDTH - SPACE.md * 2 }
  const textStyle: TextStyle = { font: F.regular, size: SIZE.sm, color: COLOR.body, maxWidth: CONTENT_WIDTH - SPACE.md * 2, lineHeight: 1.5 }
  const labelH = textLineHeight(labelStyle)
  const textLines = wrapText(pdfText(text), textStyle.font, textStyle.size, textStyle.maxWidth!)
  const textH = textLines.length * textLineHeight(textStyle)
  const boxH = SPACE.md * 2 + labelH + SPACE.sm + textH

  doc.ensureSpace(boxH)
  doc.page.drawRectangle({ x: PAGE.margin, y: doc.y - boxH, width: CONTENT_WIDTH, height: boxH, color: COLOR.surface })
  let cy = doc.y - SPACE.md - labelStyle.size
  doc.page.drawText(label.toUpperCase(), { x: PAGE.margin + SPACE.md, y: cy, size: labelStyle.size, font: labelStyle.font, color: labelStyle.color })
  cy -= (labelH - labelStyle.size) + SPACE.sm
  for (const line of textLines as string[]) {
    cy -= textStyle.size
    doc.page.drawText(line, { x: PAGE.margin + SPACE.md, y: cy, size: textStyle.size, font: textStyle.font, color: textStyle.color })
    cy -= textLineHeight(textStyle) - textStyle.size
  }
  doc.y -= boxH
  doc.moveDown(SPACE.lg)
}

function drawIntroBox(doc: PdfDoc, text: string, F: PdfDoc['fonts']): void {
  const textStyle: TextStyle = { font: F.regular, size: SIZE.sm, color: COLOR.body, maxWidth: CONTENT_WIDTH - SPACE.md * 2 - 2, lineHeight: 1.6 }
  const lines = wrapText(pdfText(text), textStyle.font, textStyle.size, textStyle.maxWidth!)
  const textH = lines.length * textLineHeight(textStyle)
  const boxH = SPACE.md * 2 + textH

  doc.ensureSpace(boxH)
  doc.page.drawRectangle({ x: PAGE.margin, y: doc.y - boxH, width: CONTENT_WIDTH, height: boxH, color: COLOR.surface })
  doc.page.drawRectangle({ x: PAGE.margin, y: doc.y - boxH, width: 2, height: boxH, color: COLOR.accent })
  let cy = doc.y - SPACE.md - textStyle.size
  for (const line of lines as string[]) {
    doc.page.drawText(line, { x: PAGE.margin + SPACE.md, y: cy, size: textStyle.size, font: textStyle.font, color: textStyle.color })
    cy -= textLineHeight(textStyle)
  }
  doc.y -= boxH
  doc.moveDown(SPACE.lg)
}
