import {
  CLAUSE_LABELS,
  CONTRACT_TYPE_LABELS,
  getRoleLabel,
  type ContractClauseKey,
  type ContractClauses,
  type ContractCustomSection,
  type ContractRole,
  type ContractStatus,
  type ContractType,
} from '@/lib/contracts/templates'
import { pdfText } from '@/lib/pdf/pdf-design-system'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { drawImageContained, embedImage } from '../engine/image'
import { textLineHeight, wrapText, type TextStyle } from '../engine/text'
import { COLOR, CONTENT_WIDTH, PAGE, SIZE, SPACE } from '../engine/theme'

export type ContractPdfSnapshot = {
  generatedAt: string
  reference: string
  disclaimer?: string
  contract: {
    id: string
    title: string
    type: ContractType
    role: ContractRole
    status: ContractStatus
    templateTitle: string
    clauses: ContractClauses
    customSections?: ContractCustomSection[]
  }
  organization: {
    name: string
    email: string | null
    phone: string | null
    address_line1: string | null
    address_line2: string | null
    postal_code: string | null
    city: string | null
    country: string | null
    siret: string | null
    siren: string | null
    vat_number: string | null
    logo_url: string | null
    forme_juridique: string | null
    capital_social: string | null
    rcs: string | null
    rcs_ville: string | null
    insurance_info: string | null
    court_competent?: string | null
    decennale_enabled?: boolean | null
    decennale_assureur?: string | null
    decennale_police?: string | null
    signatory_name?: string | null
    signatory_role?: string | null
    signature_image?: string | null
  } | null
  counterparty: {
    name: string
    email: string | null
    phone: string | null
    address: string | null
    signature_image?: string | null
    signatory_name?: string | null
    signatory_role?: string | null
    signed_at?: string | null
    client?: {
      type?: string | null
      company_name?: string | null
      contact_name?: string | null
      first_name?: string | null
      last_name?: string | null
      email?: string | null
      phone?: string | null
      address_line1?: string | null
      postal_code?: string | null
      city?: string | null
      siret?: string | null
      siren?: string | null
      vat_number?: string | null
    } | null
  }
  chantier: {
    title: string
    address_line1: string | null
    postal_code: string | null
    city: string | null
    start_date: string | null
    estimated_end_date: string | null
    budget_ht: number | null
  } | null
}

const CLAUSE_ORDER = Object.keys(CLAUSE_LABELS) as ContractClauseKey[]

function fmtDate(value: string | null | undefined): string {
  if (!value) return '-'
  const part = value.includes('T') ? value.slice(0, 10) : value
  const [year, month, day] = part.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

function compactLines(lines: Array<string | null | undefined>): string[] {
  return lines.map(line => pdfText(line).trim()).filter(Boolean)
}

function counterpartRole(role: ContractRole): ContractRole {
  return role === 'donneur_ordre' ? 'sous_traitant' : 'donneur_ordre'
}

function cleanContractTitle(title: string): string {
  return pdfText(title).replace(/\s+générique/gi, '').trim()
}

function initials(name: string | null | undefined): string {
  return pdfText(name ?? 'AT').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'AT'
}

export async function renderContractPdf(snapshot: ContractPdfSnapshot, origin: string): Promise<Buffer> {
  const fontBytes = await loadFontBytes(origin)
  return renderContractPdfWithFonts(snapshot, fontBytes)
}

export async function renderContractPdfWithFonts(snapshot: ContractPdfSnapshot, fontBytes: FontBytes): Promise<Buffer> {
  const doc = await PdfDoc.create(fontBytes)
  const F = doc.fonts

  const org = snapshot.organization
  const counterpartyClient = snapshot.counterparty.client ?? null
  const orgLines = compactLines([
    org?.forme_juridique,
    org?.address_line1,
    org?.address_line2,
    [org?.postal_code, org?.city].filter(Boolean).join(' '),
    org?.siret ? `SIRET : ${org.siret}` : org?.siren ? `SIREN : ${org.siren}` : null,
    org?.vat_number ? `TVA : ${org.vat_number}` : null,
    org?.email,
    org?.phone,
  ])
  const counterpartyLines = compactLines([
    snapshot.counterparty.address || [counterpartyClient?.address_line1, counterpartyClient?.postal_code, counterpartyClient?.city].filter(Boolean).join(' '),
    counterpartyClient?.siret ? `SIRET : ${counterpartyClient.siret}` : counterpartyClient?.siren ? `SIREN : ${counterpartyClient.siren}` : null,
    counterpartyClient?.vat_number ? `TVA : ${counterpartyClient.vat_number}` : null,
    counterpartyClient?.contact_name ? `Contact : ${counterpartyClient.contact_name}` : null,
    snapshot.counterparty.email ?? counterpartyClient?.email,
    snapshot.counterparty.phone ?? counterpartyClient?.phone,
  ])
  const chantierLines = compactLines([
    snapshot.chantier?.address_line1,
    [snapshot.chantier?.postal_code, snapshot.chantier?.city].filter(Boolean).join(' '),
    snapshot.chantier?.start_date ? `Début prévu : ${fmtDate(snapshot.chantier.start_date)}` : null,
    snapshot.chantier?.estimated_end_date ? `Fin estimée : ${fmtDate(snapshot.chantier.estimated_end_date)}` : null,
  ])

  const logoImg = org?.logo_url ? await embedImage(doc.doc, org.logo_url) : null
  const orgSignatureImg = org?.signature_image ? await embedImage(doc.doc, org.signature_image) : null
  const counterpartySignatureImg = snapshot.counterparty.signature_image ? await embedImage(doc.doc, snapshot.counterparty.signature_image) : null

  doc.onNewPage = ({ page }) => {
    let y = PAGE.height - PAGE.headerTop
    const headerTop = y

    if (logoImg) {
      drawImageContained(doc, logoImg, { x: PAGE.margin, y: headerTop - 42, w: 88, h: 42 })
    } else {
      page.drawRectangle({ x: PAGE.margin, y: headerTop - 42, width: 88, height: 42, color: COLOR.black })
      page.drawText(pdfText(initials(org?.name)), { x: PAGE.margin + 28, y: headerTop - 26, size: SIZE.lg, font: F.headingXBold, color: COLOR.white })
    }

    let ry = headerTop
    const drawRight = (text: string, style: TextStyle) => {
      const w = style.font.widthOfTextAtSize(text, style.size)
      ry -= style.size
      page.drawText(text, { x: PAGE.width - PAGE.margin - w, y: ry, size: style.size, font: style.font, color: style.color })
      ry -= textLineHeight(style) - style.size
    }
    drawRight(`Référence : ${pdfText(snapshot.reference)}`, { font: F.regular, size: SIZE.xs, color: COLOR.secondary })
    drawRight(`Généré le ${fmtDate(snapshot.generatedAt)}`, { font: F.regular, size: SIZE.xs, color: COLOR.secondary })

    y = Math.min(headerTop - 42, ry) - SPACE.lg
    page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.width - PAGE.margin, y }, thickness: 1, color: COLOR.divider })
    y -= SPACE.md
    return y
  }

  doc.addPage()

  doc.onFinishPage = ({ page, pageIndex, pageCount }) => {
    const footerY = 14
    page.drawLine({ start: { x: PAGE.margin, y: footerY + 10 }, end: { x: PAGE.width - PAGE.margin, y: footerY + 10 }, thickness: 0.5, color: COLOR.divider })
    page.drawText(pdfText(snapshot.reference), { x: PAGE.margin, y: footerY, size: SIZE.xxs, font: F.regular, color: COLOR.muted })
    const label = `Page ${pageIndex + 1}/${pageCount}`
    const w = F.regular.widthOfTextAtSize(label, SIZE.xxs)
    page.drawText(label, { x: PAGE.width - PAGE.margin - w, y: footerY, size: SIZE.xxs, font: F.regular, color: COLOR.muted })
  }

  // ── Titre ──
  doc.ensureSpace(SIZE.xxl + 20)
  doc.y -= SIZE.xxl
  doc.page.drawText(pdfText(CONTRACT_TYPE_LABELS[snapshot.contract.type]).toUpperCase(), { x: PAGE.margin, y: doc.y, size: SIZE.xxl, font: F.headingXBold, color: COLOR.black })
  doc.y -= 5
  doc.y -= SIZE.md
  doc.page.drawText(cleanContractTitle(snapshot.contract.title), { x: PAGE.margin, y: doc.y, size: SIZE.md, font: F.heading, color: COLOR.black })
  doc.y -= SPACE.sm
  doc.page.drawRectangle({ x: PAGE.margin, y: doc.y, width: 42, height: 3, color: COLOR.accent })
  doc.y -= SPACE.sm
  doc.page.drawLine({ start: { x: PAGE.margin, y: doc.y }, end: { x: PAGE.width - PAGE.margin, y: doc.y }, thickness: 1, color: COLOR.black })
  doc.y -= SPACE.md

  // ── Blocs parties ──
  const partyTitleStyle: TextStyle = { font: F.heading, size: SIZE.md, color: COLOR.black }
  function measurePartyBlock(title: string, lines: string[], w: number): number {
    const titleLines = title ? wrapText(pdfText(title), partyTitleStyle.font, partyTitleStyle.size, w - SPACE.md * 2) : ['']
    return SPACE.md * 2 + SIZE.xxs + SPACE.xs + titleLines.length * textLineHeight(partyTitleStyle) + 3 + lines.length * (SIZE.xs + 2)
  }
  function drawPartyBlock(x: number, w: number, label: string, title: string, lines: string[]): void {
    const titleLines = title ? wrapText(pdfText(title), partyTitleStyle.font, partyTitleStyle.size, w - SPACE.md * 2) : ['']
    const h = measurePartyBlock(title, lines, w)
    doc.page.drawRectangle({ x, y: doc.y - h, width: w, height: h, color: COLOR.surface })
    let cy = doc.y - SPACE.md - SIZE.xxs
    doc.page.drawText(label.toUpperCase(), { x: x + SPACE.md, y: cy, size: SIZE.xxs, font: F.headingXBold, color: COLOR.secondary })
    cy -= SPACE.xs + partyTitleStyle.size
    for (const titleLine of titleLines) {
      doc.page.drawText(titleLine, { x: x + SPACE.md, y: cy, size: partyTitleStyle.size, font: partyTitleStyle.font, color: partyTitleStyle.color })
      cy -= textLineHeight(partyTitleStyle)
    }
    cy += textLineHeight(partyTitleStyle) - partyTitleStyle.size
    cy -= 3
    for (const line of lines) {
      cy -= SIZE.xs
      doc.page.drawText(line, { x: x + SPACE.md, y: cy, size: SIZE.xs, font: F.regular, color: COLOR.body })
      cy -= 2
    }
  }

  const boxW = (CONTENT_WIDTH - SPACE.md) / 2
  const rowH1 = Math.max(
    measurePartyBlock(org?.name ?? 'Organisation', orgLines, boxW),
    measurePartyBlock(snapshot.counterparty.name, counterpartyLines, boxW),
  )
  doc.ensureSpace(rowH1)
  const row1Y = doc.y
  drawPartyBlock(PAGE.margin, boxW, getRoleLabel(snapshot.contract.role, snapshot.contract.type), org?.name ?? 'Organisation', orgLines)
  doc.y = row1Y
  drawPartyBlock(PAGE.margin + boxW + SPACE.md, boxW, getRoleLabel(counterpartRole(snapshot.contract.role), snapshot.contract.type), snapshot.counterparty.name, counterpartyLines)
  doc.y = row1Y - rowH1
  doc.moveDown(SPACE.lg)

  if (snapshot.chantier) {
    const cadreLines = [
      `Type : ${pdfText(CONTRACT_TYPE_LABELS[snapshot.contract.type])}`,
      `Référence : ${pdfText(snapshot.reference)}`,
    ]
    const rowH2 = Math.max(
      measurePartyBlock(snapshot.chantier.title, chantierLines, boxW),
      measurePartyBlock('', cadreLines, boxW),
    )
    doc.ensureSpace(rowH2)
    const row2Y = doc.y
    drawPartyBlock(PAGE.margin, boxW, 'Chantier lié', snapshot.chantier.title, chantierLines)
    doc.y = row2Y
    drawPartyBlock(PAGE.margin + boxW + SPACE.md, boxW, 'Cadre', '', cadreLines)
    doc.y = row2Y - rowH2
    doc.moveDown(SPACE.lg)
  }

  // ── Clauses ──
  drawSectionTitle(doc, 'Clauses', F)

  const clauseTextStyle: TextStyle = { font: F.regular, size: SIZE.sm, color: COLOR.body, maxWidth: CONTENT_WIDTH, lineHeight: 1.45 }
  for (const key of CLAUSE_ORDER) {
    drawClauseBlock(doc, CLAUSE_LABELS[key], pdfText(snapshot.contract.clauses[key]), F, clauseTextStyle)
  }

  for (const section of snapshot.contract.customSections ?? []) {
    drawClauseBlock(doc, pdfText(section.title), pdfText(section.content), F, clauseTextStyle)
  }

  // ── Tribunal compétent ──
  const jurisdictionText = pdfText(org?.court_competent
    ? `En cas de litige relatif au présent contrat, le tribunal compétent est : ${org.court_competent}.`
    : 'En cas de litige relatif au présent contrat, le tribunal compétent sera déterminé conformément aux règles applicables.')
  const jTextStyle: TextStyle = { font: F.regular, size: SIZE.sm, color: COLOR.body, maxWidth: CONTENT_WIDTH, lineHeight: 1.45 }
  const jLines = wrapText(jurisdictionText, jTextStyle.font, jTextStyle.size, jTextStyle.maxWidth!)
  const jBoxH = SPACE.md * 2 + SIZE.sm + 4 + jLines.length * textLineHeight(jTextStyle)
  doc.ensureSpace(jBoxH)
  doc.page.drawLine({ start: { x: PAGE.margin, y: doc.y }, end: { x: PAGE.width - PAGE.margin, y: doc.y }, thickness: 1, color: COLOR.black })
  doc.y -= SPACE.md
  doc.y -= SIZE.sm
  doc.page.drawText('Tribunal compétent', { x: PAGE.margin, y: doc.y, size: SIZE.sm, font: F.heading, color: COLOR.black })
  doc.y -= 4
  for (const line of jLines) {
    doc.y -= jTextStyle.size
    doc.page.drawText(line, { x: PAGE.margin, y: doc.y, size: jTextStyle.size, font: jTextStyle.font, color: jTextStyle.color })
    doc.y -= textLineHeight(jTextStyle) - jTextStyle.size
  }
  doc.y -= SPACE.md
  doc.page.drawLine({ start: { x: PAGE.margin, y: doc.y }, end: { x: PAGE.width - PAGE.margin, y: doc.y }, thickness: 0.5, color: COLOR.divider })

  // ── Signatures ──
  doc.moveDown(SPACE.xxl)
  const sigBoxW = (CONTENT_WIDTH - SPACE.lg) / 2
  const sigBoxH = 92
  doc.ensureSpace(sigBoxH)
  const sigY = doc.y

  function drawSignatureBox(x: number, title: string, name: string, role: string, dateLabel: string, signatureImg: import('pdf-lib').PDFImage | null): void {
    doc.page.drawRectangle({ x, y: sigY - sigBoxH, width: sigBoxW, height: sigBoxH, borderColor: COLOR.divider, borderWidth: 1, color: undefined })
    let cy = sigY - SPACE.md - SIZE.xs
    doc.page.drawText(pdfText(title).toUpperCase(), { x: x + SPACE.md, y: cy, size: SIZE.xs, font: F.headingXBold, color: COLOR.black })
    cy -= SPACE.sm + SIZE.xs
    doc.page.drawText(`Nom : ${pdfText(name)}`, { x: x + SPACE.md, y: cy, size: SIZE.xs, font: F.regular, color: COLOR.secondary })
    cy -= SIZE.xs + 3
    doc.page.drawText(`Qualité : ${pdfText(role)}`, { x: x + SPACE.md, y: cy, size: SIZE.xs, font: F.regular, color: COLOR.secondary })
    cy -= SIZE.xs + 3
    doc.page.drawText(`Date : ${pdfText(dateLabel)}`, { x: x + SPACE.md, y: cy, size: SIZE.xs, font: F.regular, color: COLOR.secondary })
    cy -= SIZE.xs + 3
    doc.page.drawText('Signature :', { x: x + SPACE.md, y: cy, size: SIZE.xs, font: F.regular, color: COLOR.secondary })
    if (signatureImg) {
      drawImageContained(doc, signatureImg, { x: x + SPACE.md, y: cy - 50, w: 140, h: 50 })
    }
  }

  drawSignatureBox(PAGE.margin, `Pour ${pdfText(org?.name ?? "l'organisation")}`, org?.signatory_name ?? '', org?.signatory_role ?? '', fmtDate(snapshot.generatedAt), orgSignatureImg)
  drawSignatureBox(PAGE.margin + sigBoxW + SPACE.lg, `Pour ${pdfText(snapshot.counterparty.name)}`, snapshot.counterparty.signatory_name ?? '', snapshot.counterparty.signatory_role ?? '', snapshot.counterparty.signed_at ? fmtDate(snapshot.counterparty.signed_at) : '', counterpartySignatureImg)

  doc.y = sigY - sigBoxH

  return doc.save()
}

function drawSectionTitle(doc: PdfDoc, label: string, F: PdfDoc['fonts']): void {
  doc.ensureSpace(SIZE.sm + SPACE.xs)
  doc.y -= SIZE.sm
  doc.page.drawText(label.toUpperCase(), { x: PAGE.margin, y: doc.y, size: SIZE.sm, font: F.headingXBold, color: COLOR.black })
  doc.y -= SPACE.xs
  doc.page.drawLine({ start: { x: PAGE.margin, y: doc.y }, end: { x: PAGE.width - PAGE.margin, y: doc.y }, thickness: 1, color: COLOR.black })
}

function drawClauseBlock(doc: PdfDoc, title: string, text: string, F: PdfDoc['fonts'], baseStyle: TextStyle): void {
  const titleStyle: TextStyle = { font: F.heading, size: SIZE.sm, color: COLOR.black }
  const lines = wrapText(text, baseStyle.font, baseStyle.size, baseStyle.maxWidth!)
  const blockH = SPACE.sm * 2 + SIZE.sm + 4 + lines.length * textLineHeight(baseStyle)
  doc.ensureSpace(blockH)
  doc.y -= SPACE.sm
  doc.y -= titleStyle.size
  doc.page.drawText(title, { x: PAGE.margin, y: doc.y, size: titleStyle.size, font: titleStyle.font, color: titleStyle.color })
  doc.y -= 4
  for (const line of lines) {
    doc.y -= baseStyle.size
    doc.page.drawText(line, { x: PAGE.margin, y: doc.y, size: baseStyle.size, font: baseStyle.font, color: baseStyle.color })
    doc.y -= textLineHeight(baseStyle) - baseStyle.size
  }
  doc.y -= SPACE.sm
  doc.page.drawLine({ start: { x: PAGE.margin, y: doc.y }, end: { x: PAGE.width - PAGE.margin, y: doc.y }, thickness: 0.5, color: COLOR.divider })
}
