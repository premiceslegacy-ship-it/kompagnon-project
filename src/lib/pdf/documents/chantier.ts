import type { Organization } from '@/lib/data/queries/organization'
import type { ChantierDetail, Tache, ChantierNote } from '@/lib/data/queries/chantiers'
import { pdfText } from '@/lib/pdf/pdf-design-system'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { drawImageContained, embedImage } from '../engine/image'
import { textLineHeight, wrapText, type TextStyle } from '../engine/text'
import { COLOR, CONTENT_WIDTH, PAGE, SIZE, SPACE } from '../engine/theme'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '-'
  const part = iso.includes('T') ? iso.split('T')[0] : iso
  const [y, m, d] = part.split('-')
  return `${(d ?? '').padStart(2, '0')}/${(m ?? '').padStart(2, '0')}/${y ?? ''}`
}

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)

const STATUS_LABELS: Record<string, string> = {
  planifie: 'Planifie',
  en_cours: 'En cours',
  suspendu: 'Suspendu',
  termine: 'Termine',
  annule: 'Annule',
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChantierPDFPhoto = {
  id: string
  url: string
  title: string | null
  caption: string | null
}

export type ChantierPdfData = {
  chantier: ChantierDetail
  taches: Tache[]
  notes: ChantierNote[]
  organization: Organization
  periodFrom?: string | null
  periodTo?: string | null
  reportPhotos?: ChantierPDFPhoto[]
}

export async function renderChantierPdf(data: ChantierPdfData, origin: string): Promise<Buffer> {
  const fontBytes = await loadFontBytes(origin)
  return renderChantierPdfWithFonts(data, fontBytes)
}

export async function renderChantierPdfWithFonts(data: ChantierPdfData, fontBytes: FontBytes): Promise<Buffer> {
  const { chantier, taches, notes, organization, periodFrom, periodTo, reportPhotos } = data
  const doc = await PdfDoc.create(fontBytes)
  const F = doc.fonts

  const donePct = chantier.taches_count > 0 ? Math.round((chantier.taches_done / chantier.taches_count) * 100) : 0
  const today = fmtDate(new Date().toISOString())

  const tachesEnCours = taches.filter(t => t.status === 'en_cours')
  const tachesAFaire = taches.filter(t => t.status === 'a_faire')
  const tachesTerminees = taches.filter(t => t.status === 'termine')

  const periodLabel = (periodFrom || periodTo)
    ? [periodFrom && `du ${fmtDate(periodFrom)}`, periodTo && `au ${fmtDate(periodTo)}`].filter(Boolean).join(' ')
    : null

  const orgPostalCity = [organization.postal_code, organization.city].filter(Boolean).join(' ') || null
  const footerLabel = `${organization.name} - Rapport de chantier - ${chantier.title}`

  const logoImg = organization.logo_url ? await embedImage(doc.doc, organization.logo_url) : null

  // ── Header répété sur chaque page ──
  doc.onNewPage = ({ page }) => {
    let y = PAGE.height - PAGE.headerTop
    const headerTop = y

    let ly = headerTop
    const drawLeft = (text: string, style: TextStyle) => {
      ly -= style.size
      page.drawText(text, { x: PAGE.margin, y: ly, size: style.size, font: style.font, color: style.color })
      ly -= textLineHeight(style) - style.size
    }
    drawLeft(pdfText(organization.name), { font: F.headingXBold, size: SIZE.md, color: COLOR.black })
    if (organization.address_line1) drawLeft(pdfText(organization.address_line1), { font: F.regular, size: SIZE.xs, color: COLOR.secondary })
    if (orgPostalCity) drawLeft(pdfText(orgPostalCity), { font: F.regular, size: SIZE.xs, color: COLOR.secondary })
    if (organization.siret) drawLeft(`SIRET ${pdfText(organization.siret)}`, { font: F.regular, size: SIZE.xs, color: COLOR.secondary })

    const rightX = PAGE.width - PAGE.margin - 210
    let ry = headerTop
    const drawRight = (text: string, style: TextStyle) => {
      const w = style.font.widthOfTextAtSize(text, style.size)
      ry -= style.size
      page.drawText(text, { x: rightX + 210 - w, y: ry, size: style.size, font: style.font, color: style.color })
      ry -= textLineHeight(style) - style.size
    }
    drawRight(`Rapport genere le ${today}`, { font: F.regular, size: SIZE.xs, color: COLOR.secondary })
    if (organization.phone) drawRight(pdfText(organization.phone), { font: F.regular, size: SIZE.xs, color: COLOR.secondary })
    if (organization.email) drawRight(pdfText(organization.email), { font: F.regular, size: SIZE.xs, color: COLOR.secondary })

    y = Math.min(ly, ry) - SPACE.md
    page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.width - PAGE.margin, y }, thickness: 1, color: COLOR.divider })
    y -= SPACE.md
    return y
  }

  doc.addPage()

  doc.onFinishPage = ({ page, pageIndex, pageCount }) => {
    const footerY = 14
    page.drawLine({ start: { x: PAGE.margin, y: footerY + 8 }, end: { x: PAGE.width - PAGE.margin, y: footerY + 8 }, thickness: 0.5, color: COLOR.divider })
    page.drawText(footerLabel, { x: PAGE.margin, y: footerY, size: SIZE.xxs, font: F.regular, color: COLOR.muted })
    const label = `${pageIndex + 1} / ${pageCount}`
    const w = F.regular.widthOfTextAtSize(label, SIZE.xxs)
    page.drawText(label, { x: PAGE.width - PAGE.margin - w, y: footerY, size: SIZE.xxs, font: F.regular, color: COLOR.muted })
  }

  // ── Titre ──
  doc.ensureSpace(SIZE.xxl + 20)
  doc.y -= SIZE.xxl
  doc.page.drawText('RAPPORT DE CHANTIER', { x: PAGE.margin, y: doc.y, size: SIZE.xxl, font: F.headingXBold, color: COLOR.black })
  doc.y -= 4
  doc.y -= SIZE.lg
  doc.page.drawText(pdfText(chantier.title), { x: PAGE.margin, y: doc.y, size: SIZE.lg, font: F.headingXBold, color: COLOR.black })
  doc.y -= 4
  doc.y -= SIZE.xs
  const metaParts = [
    STATUS_LABELS[chantier.status] ?? chantier.status,
    chantier.client?.company_name ?? null,
    periodLabel ? `Periode : ${periodLabel}` : null,
  ].filter((p): p is string => !!p)
  doc.page.drawText(pdfText(metaParts.join('    ')), { x: PAGE.margin, y: doc.y, size: SIZE.xs, font: F.regular, color: COLOR.secondary })
  doc.y -= SPACE.sm
  doc.page.drawRectangle({ x: PAGE.margin, y: doc.y, width: 40, height: 3, color: COLOR.accent })
  doc.y -= SPACE.sm
  doc.page.drawLine({ start: { x: PAGE.margin, y: doc.y }, end: { x: PAGE.width - PAGE.margin, y: doc.y }, thickness: 1, color: COLOR.black })
  doc.y -= SPACE.md

  // ── Grille synthèse (3 blocs) ──
  const infoBoxW = (CONTENT_WIDTH - SPACE.sm * 2) / 3
  const infoBoxH = 68
  doc.ensureSpace(infoBoxH)
  const infoY = doc.y

  function drawInfoBox(x: number, label: string, draw: (cy: number) => void): void {
    doc.page.drawRectangle({ x, y: infoY - infoBoxH, width: infoBoxW, height: infoBoxH, color: COLOR.surface })
    let cy = infoY - SPACE.md - SIZE.xxs
    doc.page.drawText(label.toUpperCase(), { x: x + SPACE.md, y: cy, size: SIZE.xxs, font: F.headingXBold, color: COLOR.secondary })
    cy -= SPACE.sm + SIZE.sm
    draw(cy)
  }

  drawInfoBox(PAGE.margin, 'Periode des travaux', (cy) => {
    const label = `${fmtDate(chantier.start_date)} - ${fmtDate(chantier.estimated_end_date)}`
    doc.page.drawText(pdfText(label), { x: PAGE.margin + SPACE.md, y: cy, size: SIZE.sm, font: F.regular, color: COLOR.body })
  })
  drawInfoBox(PAGE.margin + infoBoxW + SPACE.sm, 'Budget HT', (cy) => {
    doc.page.drawText(fmtMoney(chantier.budget_ht), { x: PAGE.margin + infoBoxW + SPACE.sm + SPACE.md, y: cy, size: SIZE.lg, font: F.headingXBold, color: COLOR.black })
  })
  drawInfoBox(PAGE.margin + (infoBoxW + SPACE.sm) * 2, 'Avancement', (cy) => {
    const x = PAGE.margin + (infoBoxW + SPACE.sm) * 2 + SPACE.md
    doc.page.drawText(`${donePct}%`, { x, y: cy, size: SIZE.lg, font: F.headingXBold, color: COLOR.black })
    cy -= SIZE.xs + 4
    doc.page.drawText(`${chantier.taches_done}/${chantier.taches_count} taches`, { x, y: cy, size: SIZE.xs, font: F.regular, color: COLOR.secondary })
    cy -= SPACE.sm
    const barW = infoBoxW - SPACE.md * 2
    doc.page.drawRectangle({ x, y: cy - 4, width: barW, height: 4, color: COLOR.divider })
    doc.page.drawRectangle({ x, y: cy - 4, width: barW * (donePct / 100), height: 4, color: COLOR.accent })
  })

  doc.y = infoY - infoBoxH
  doc.moveDown(SPACE.md)

  // ── Adresse + contact ──
  const hasAddress = chantier.address_line1 || chantier.city
  const hasContact = chantier.contact_name || chantier.contact_email || chantier.contact_phone
  if (hasAddress || hasContact) {
    const twoBoxW = (CONTENT_WIDTH - SPACE.sm) / 2
    const addrLines: string[] = hasAddress ? [[chantier.address_line1, chantier.postal_code, chantier.city].filter(Boolean).join(', ')] : []
    const contactLines: string[] = [
      chantier.contact_name ?? null,
      chantier.contact_email ?? null,
      chantier.contact_phone ?? null,
    ].filter((l): l is string => !!l)

    const boxH = SPACE.md * 2 + SIZE.xxs + SPACE.sm + Math.max(addrLines.length, contactLines.length, 1) * (SIZE.sm + 3)
    doc.ensureSpace(boxH)
    const rowY = doc.y

    if (hasAddress) {
      doc.page.drawRectangle({ x: PAGE.margin, y: rowY - boxH, width: twoBoxW, height: boxH, color: COLOR.surface })
      let cy = rowY - SPACE.md - SIZE.xxs
      doc.page.drawText('ADRESSE DU CHANTIER', { x: PAGE.margin + SPACE.md, y: cy, size: SIZE.xxs, font: F.headingXBold, color: COLOR.secondary })
      cy -= SPACE.sm + SIZE.sm
      for (const line of addrLines) {
        doc.page.drawText(pdfText(line), { x: PAGE.margin + SPACE.md, y: cy, size: SIZE.sm, font: F.regular, color: COLOR.body })
        cy -= SIZE.sm + 3
      }
    }
    if (hasContact) {
      const cx = PAGE.margin + twoBoxW + SPACE.sm
      doc.page.drawRectangle({ x: cx, y: rowY - boxH, width: twoBoxW, height: boxH, color: COLOR.surface })
      let cy = rowY - SPACE.md - SIZE.xxs
      doc.page.drawText('CONTACT REFERENT', { x: cx + SPACE.md, y: cy, size: SIZE.xxs, font: F.headingXBold, color: COLOR.secondary })
      cy -= SPACE.sm + SIZE.sm
      for (const line of contactLines) {
        doc.page.drawText(pdfText(line), { x: cx + SPACE.md, y: cy, size: SIZE.sm, font: F.regular, color: COLOR.body })
        cy -= SIZE.sm + 3
      }
    }
    doc.y = rowY - boxH
    doc.moveDown(SPACE.md)
  }

  // ── Section Taches ──
  drawSectionTitle(doc, taches.length > 0 ? `Taches (${taches.length})` : 'Taches', F)

  if (taches.length === 0) {
    doc.ensureSpace(SIZE.xs + SPACE.sm)
    doc.y -= SPACE.sm
    doc.y -= SIZE.xs
    doc.page.drawText('Aucune tache enregistree.', { x: PAGE.margin, y: doc.y, size: SIZE.xs, font: F.regular, color: COLOR.muted })
  }

  drawTacheGroup(doc, `En cours (${tachesEnCours.length})`, tachesEnCours, F)
  drawTacheGroup(doc, `A faire (${tachesAFaire.length})`, tachesAFaire, F)
  drawTacheGroup(doc, `Terminees (${tachesTerminees.length})`, tachesTerminees, F)

  // ── Section Journal ──
  if (notes.length > 0) {
    drawSectionTitle(doc, `Journal de chantier (${notes.length} entree${notes.length > 1 ? 's' : ''})`, F)
    doc.moveDown(SPACE.sm)

    for (const n of notes) {
      const metaText = `${n.author_name}  -  ${new Date(n.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}`
      const contentStyle: TextStyle = { font: F.regular, size: SIZE.sm, color: COLOR.body, maxWidth: CONTENT_WIDTH - SPACE.md * 2, lineHeight: 1.5 }
      const contentLines = wrapText(pdfText(n.content), contentStyle.font, contentStyle.size, contentStyle.maxWidth!)
      const boxH = SPACE.sm * 2 + SIZE.xs + 4 + contentLines.length * textLineHeight(contentStyle)
      doc.ensureSpace(boxH + SPACE.sm)
      doc.page.drawRectangle({ x: PAGE.margin, y: doc.y - boxH, width: CONTENT_WIDTH, height: boxH, color: COLOR.surface })
      doc.page.drawRectangle({ x: PAGE.margin, y: doc.y - boxH, width: 2, height: boxH, color: COLOR.accent })
      let cy = doc.y - SPACE.sm - SIZE.xs
      doc.page.drawText(pdfText(metaText), { x: PAGE.margin + SPACE.md, y: cy, size: SIZE.xs, font: F.regular, color: COLOR.secondary })
      cy -= 4 + contentStyle.size
      for (const line of contentLines) {
        doc.page.drawText(line, { x: PAGE.margin + SPACE.md, y: cy, size: contentStyle.size, font: contentStyle.font, color: contentStyle.color })
        cy -= textLineHeight(contentStyle)
      }
      doc.y -= boxH
      doc.moveDown(SPACE.sm)
    }
  }

  // ── Section Photos ──
  if (reportPhotos && reportPhotos.length > 0) {
    drawSectionTitle(doc, `Photos du chantier (${reportPhotos.length} photo${reportPhotos.length > 1 ? 's' : ''})`, F)
    doc.moveDown(SPACE.md)

    const gap = SPACE.md
    const cellW = (CONTENT_WIDTH - gap) / 2
    const imgH = 160

    for (let i = 0; i < reportPhotos.length; i += 2) {
      const rowPhotos = reportPhotos.slice(i, i + 2)
      const imgs = await Promise.all(rowPhotos.map(p => embedImage(doc.doc, p.url)))
      const captionHeights = rowPhotos.map((p, idx) => {
        if (!p.caption) return 0
        const style: TextStyle = { font: F.regular, size: SIZE.xs, color: COLOR.secondary, maxWidth: cellW, align: 'center', lineHeight: 1.4 }
        const lines = wrapText(pdfText(p.caption), style.font, style.size, cellW)
        return 4 + lines.length * textLineHeight(style)
      })
      const rowH = SIZE.xs + 4 + imgH + Math.max(...captionHeights, 0)
      doc.ensureSpace(rowH + SPACE.sm)
      const rowTop = doc.y

      rowPhotos.forEach((photo, idx) => {
        const x = PAGE.margin + idx * (cellW + gap)
        let cy = rowTop
        const label = pdfText(photo.title ?? `Photo ${i + idx + 1}`)
        const labelStyle: TextStyle = { font: F.heading, size: SIZE.xs, color: COLOR.black, align: 'center', maxWidth: cellW }
        const lw = labelStyle.font.widthOfTextAtSize(label, labelStyle.size)
        cy -= SIZE.xs
        doc.page.drawText(label, { x: x + (cellW - lw) / 2, y: cy, size: SIZE.xs, font: F.heading, color: COLOR.black })
        cy -= 4
        const img = imgs[idx]
        if (img) {
          drawImageContained(doc, img, { x, y: cy - imgH, w: cellW, h: imgH }, 'center')
        } else {
          doc.page.drawRectangle({ x, y: cy - imgH, width: cellW, height: imgH, color: COLOR.surface })
        }
        cy -= imgH
        if (photo.caption) {
          cy -= 4
          const style: TextStyle = { font: F.regular, size: SIZE.xs, color: COLOR.secondary, maxWidth: cellW, align: 'center', lineHeight: 1.4 }
          const lines = wrapText(pdfText(photo.caption), style.font, style.size, cellW)
          for (const line of lines) {
            const lw2 = style.font.widthOfTextAtSize(line, style.size)
            cy -= style.size
            doc.page.drawText(line, { x: x + (cellW - lw2) / 2, y: cy, size: style.size, font: style.font, color: style.color })
            cy -= textLineHeight(style) - style.size
          }
        }
      })

      doc.y = rowTop - rowH
      doc.moveDown(SPACE.sm)
    }
  }

  return doc.save()
}

// ─── Helpers de blocs ────────────────────────────────────────────────────────

function drawSectionTitle(doc: PdfDoc, label: string, F: PdfDoc['fonts']): void {
  doc.ensureSpace(SIZE.sm + SPACE.xs + SPACE.lg)
  doc.moveDown(SPACE.lg)
  doc.y -= SIZE.sm
  doc.page.drawText(pdfText(label).toUpperCase(), { x: PAGE.margin, y: doc.y, size: SIZE.sm, font: F.headingXBold, color: COLOR.black })
  doc.y -= SPACE.xs
  doc.page.drawLine({ start: { x: PAGE.margin, y: doc.y }, end: { x: PAGE.width - PAGE.margin, y: doc.y }, thickness: 1, color: COLOR.black })
}

function drawTacheGroup(doc: PdfDoc, label: string, taches: Tache[], F: PdfDoc['fonts']): void {
  if (taches.length === 0) return
  doc.ensureSpace(SIZE.xs + SPACE.sm)
  doc.moveDown(SPACE.sm)
  doc.y -= SIZE.xs
  doc.page.drawText(pdfText(label).toUpperCase(), { x: PAGE.margin, y: doc.y, size: SIZE.xs, font: F.heading, color: COLOR.secondary })

  for (const t of taches) {
    const titleStyle: TextStyle = { font: F.heading, size: SIZE.sm, color: COLOR.black, maxWidth: CONTENT_WIDTH - 90, lineHeight: 1.4 }
    const titleLines = wrapText(pdfText(t.title), titleStyle.font, titleStyle.size, titleStyle.maxWidth!)
    const descStyle: TextStyle = { font: F.regular, size: SIZE.xs, color: COLOR.secondary, maxWidth: CONTENT_WIDTH - SPACE.sm, lineHeight: 1.5 }
    const descLines = t.description ? wrapText(pdfText(t.description), descStyle.font, descStyle.size, descStyle.maxWidth!) : []
    const noteStyle: TextStyle = { font: F.regular, size: SIZE.xs, color: COLOR.body, maxWidth: CONTENT_WIDTH - SPACE.sm * 2, lineHeight: 1.5 }
    const noteLines = t.progress_note ? wrapText(pdfText(t.progress_note), noteStyle.font, noteStyle.size, noteStyle.maxWidth!) : []

    const rowH = SPACE.sm
      + titleLines.length * textLineHeight(titleStyle)
      + (descLines.length ? 2 + descLines.length * textLineHeight(descStyle) : 0)
      + (noteLines.length ? SPACE.xs * 2 + noteLines.length * textLineHeight(noteStyle) : 0)
      + 2

    doc.ensureSpace(rowH)
    doc.y -= SPACE.sm
    let cy = doc.y
    for (const line of titleLines) {
      cy -= titleStyle.size
      doc.page.drawText(line, { x: PAGE.margin, y: cy, size: titleStyle.size, font: titleStyle.font, color: titleStyle.color })
      cy -= textLineHeight(titleStyle) - titleStyle.size
    }
    if (t.due_date) {
      const label2 = `Echeance : ${fmtDate(t.due_date)}`
      const w = F.regular.widthOfTextAtSize(label2, SIZE.xs)
      doc.page.drawText(label2, { x: PAGE.width - PAGE.margin - w, y: doc.y - titleStyle.size, size: SIZE.xs, font: F.regular, color: COLOR.secondary })
    }
    if (descLines.length) {
      cy -= 2
      for (const line of descLines) {
        cy -= descStyle.size
        doc.page.drawText(line, { x: PAGE.margin + SPACE.sm, y: cy, size: descStyle.size, font: descStyle.font, color: descStyle.color })
        cy -= textLineHeight(descStyle) - descStyle.size
      }
    }
    if (noteLines.length) {
      cy -= SPACE.xs
      const noteBoxH = SPACE.xs * 2 + noteLines.length * textLineHeight(noteStyle)
      doc.page.drawRectangle({ x: PAGE.margin, y: cy - noteBoxH + textLineHeight(noteStyle) - noteStyle.size, width: 2, height: noteBoxH, color: COLOR.accent })
      cy -= SPACE.xs
      for (const line of noteLines) {
        cy -= noteStyle.size
        doc.page.drawText(line, { x: PAGE.margin + SPACE.sm, y: cy, size: noteStyle.size, font: noteStyle.font, color: noteStyle.color })
        cy -= textLineHeight(noteStyle) - noteStyle.size
      }
      cy -= SPACE.xs
    }
    doc.y = cy - 2
    doc.page.drawLine({ start: { x: PAGE.margin, y: doc.y }, end: { x: PAGE.width - PAGE.margin, y: doc.y }, thickness: 0.5, color: COLOR.divider })
  }
}
