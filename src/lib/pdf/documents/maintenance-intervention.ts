import { pdfText } from '@/lib/pdf/pdf-design-system'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { drawImageContained, embedImage } from '../engine/image'
import { textLineHeight, wrapText, type TextStyle } from '../engine/text'
import { COLOR, CONTENT_WIDTH, PAGE, SIZE, SPACE } from '../engine/theme'

type Organization = {
  name: string
  logo_url?: string | null
  address_line1?: string | null
  postal_code?: string | null
  city?: string | null
  phone?: string | null
  email?: string | null
}

type Client = {
  company_name?: string | null
  first_name?: string | null
  last_name?: string | null
  address_line1?: string | null
  postal_code?: string | null
  city?: string | null
}

type Intervention = {
  id: string
  date_intervention: string
  statut: string
  start_time: string | null
  end_time: string | null
  duration_hours: number | null
  rapport: string | null
  observations: string | null
  billable_notes: string | null
  cost_parts_ht: number | null
  cost_travel_ht: number | null
  cost_other_ht: number | null
  billable_amount_ht: number | null
  intervenant?: { prenom?: string | null; name?: string | null } | null
  intervenant_profile?: { full_name?: string | null; email?: string | null } | null
  invoice?: { number?: string | null; status?: string | null } | null
  contract?: {
    title: string
    frequence: string
    site_name?: string | null
    site_contact_name?: string | null
    site_contact_email?: string | null
    site_contact_phone?: string | null
    site_address_line1?: string | null
    site_postal_code?: string | null
    site_city?: string | null
    equipements: Array<{ nom: string; ref?: string; localisation?: string }>
    client?: Client | null
    chantier?: { title: string; address_line1?: string | null; postal_code?: string | null; city?: string | null } | null
  } | null
}

export type MaintenanceReportPhoto = {
  id: string
  url: string
  title: string | null
  caption: string | null
}

export type MaintenanceInterventionPdfData = {
  intervention: Intervention
  organization: Organization
  reportPhotos?: MaintenanceReportPhoto[]
}

function formatDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR')
}

function formatTimes(intervention: Intervention): string {
  const parts: string[] = []
  if (intervention.start_time) parts.push(intervention.start_time.slice(0, 5))
  if (intervention.end_time) parts.push(intervention.end_time.slice(0, 5))
  const range = parts.length ? parts.join(' - ') : '-'
  return intervention.duration_hours ? `${range} · ${intervention.duration_hours}h` : range
}

export async function renderMaintenanceInterventionPdf(data: MaintenanceInterventionPdfData, origin: string): Promise<Buffer> {
  const fontBytes = await loadFontBytes(origin)
  return renderMaintenanceInterventionPdfWithFonts(data, fontBytes)
}

export async function renderMaintenanceInterventionPdfWithFonts(data: MaintenanceInterventionPdfData, fontBytes: FontBytes): Promise<Buffer> {
  const { intervention, organization, reportPhotos = [] } = data
  const doc = await PdfDoc.create(fontBytes)
  const F = doc.fonts

  const client = intervention.contract?.client
  const contract = intervention.contract
  const chantier = contract?.chantier
  const clientName = client
    ? client.company_name || [client.first_name, client.last_name].filter(Boolean).join(' ') || 'Client'
    : 'Client'
  const intervenantName = intervention.intervenant_profile?.full_name
    || [intervention.intervenant?.prenom, intervention.intervenant?.name].filter(Boolean).join(' ')
    || 'Non renseigné'

  const logoImg = organization.logo_url ? await embedImage(doc.doc, organization.logo_url) : null

  doc.onNewPage = ({ page }) => {
    let y = PAGE.height - PAGE.headerTop
    const headerTop = y

    const logoW = 44, logoH = 44
    if (logoImg) {
      drawImageContained(doc, logoImg, { x: PAGE.margin, y: headerTop - logoH, w: logoW, h: logoH })
    } else {
      page.drawRectangle({ x: PAGE.margin, y: headerTop - logoH, width: logoW, height: logoH, color: COLOR.black })
      const initials = pdfText(organization.name.slice(0, 2).toUpperCase())
      const iw = F.headingXBold.widthOfTextAtSize(initials, SIZE.md)
      page.drawText(initials, { x: PAGE.margin + (logoW - iw) / 2, y: headerTop - logoH / 2 - SIZE.md / 2 + 2, size: SIZE.md, font: F.headingXBold, color: COLOR.white })
    }

    const infoX = PAGE.margin + logoW + SPACE.md
    let iy = headerTop - SIZE.md
    page.drawText(pdfText(organization.name), { x: infoX, y: iy, size: SIZE.md, font: F.heading, color: COLOR.black })
    iy -= 4 + SIZE.xs
    const addr = [organization.address_line1, organization.postal_code, organization.city].filter(Boolean).join(', ')
    if (addr) { page.drawText(pdfText(addr), { x: infoX, y: iy, size: SIZE.xs, font: F.regular, color: COLOR.secondary }); iy -= 2 + SIZE.xs }
    const contact = [organization.email, organization.phone].filter(Boolean).join(' · ')
    if (contact) page.drawText(pdfText(contact), { x: infoX, y: iy, size: SIZE.xs, font: F.regular, color: COLOR.secondary })

    // Badge à droite
    const badgeLabel = "Rapport d'intervention"
    const badgeStyle = { font: F.headingXBold, size: SIZE.xs }
    const bw = badgeStyle.font.widthOfTextAtSize(badgeLabel, badgeStyle.size)
    const badgeW = bw + SPACE.md * 2
    const badgeH = SIZE.xs + SPACE.sm * 2
    const badgeX = PAGE.width - PAGE.margin - badgeW
    const badgeY = headerTop - badgeH
    page.drawRectangle({ x: badgeX, y: badgeY, width: badgeW, height: badgeH, borderColor: COLOR.black, borderWidth: 1 })
    page.drawText(badgeLabel.toUpperCase(), { x: badgeX + SPACE.md, y: badgeY + SPACE.sm, size: SIZE.xs, font: F.headingXBold, color: COLOR.black })

    y = Math.min(headerTop - logoH, badgeY) - SPACE.lg
    page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.width - PAGE.margin, y }, thickness: 1, color: COLOR.divider })
    y -= SPACE.lg
    return y
  }

  doc.addPage()

  // ── Titre ──
  doc.ensureSpace(22 + SPACE.lg)
  doc.y -= 22
  doc.page.drawText(pdfText(intervention.contract?.title ?? "Intervention d'entretien"), { x: PAGE.margin, y: doc.y, size: 22, font: F.heading, color: COLOR.black })
  doc.moveDown(SPACE.lg)

  // ── Grille infos (3 colonnes) ──
  type InfoRow = { label: string; value: string }
  const infoRows: InfoRow[] = [
    { label: 'Client', value: clientName },
    { label: 'Site', value: contract?.site_name ?? chantier?.title ?? intervention.contract?.title ?? '-' },
    { label: 'Adresse', value: [contract?.site_address_line1 ?? chantier?.address_line1 ?? client?.address_line1, contract?.site_postal_code ?? chantier?.postal_code ?? client?.postal_code, contract?.site_city ?? chantier?.city ?? client?.city].filter(Boolean).join(', ') || '-' },
    { label: 'Date', value: formatDate(intervention.date_intervention) },
    { label: 'Intervenant', value: intervenantName },
    { label: 'Horaires', value: formatTimes(intervention) },
    { label: 'Contact site', value: [contract?.site_contact_name, contract?.site_contact_phone, contract?.site_contact_email].filter(Boolean).join(' · ') || '-' },
  ]

  const gap = SPACE.sm
  const gridColW = (CONTENT_WIDTH - gap * 2) / 3
  const gridBoxH = 48

  for (let i = 0; i < infoRows.length; i += 3) {
    const rowItems = infoRows.slice(i, i + 3)
    doc.ensureSpace(gridBoxH + gap)
    const rowTop = doc.y
    rowItems.forEach((item, idx) => {
      const x = PAGE.margin + idx * (gridColW + gap)
      doc.page.drawRectangle({ x, y: rowTop - gridBoxH, width: gridColW, height: gridBoxH, borderColor: COLOR.divider, borderWidth: 1, color: undefined })
      let cy = rowTop - SPACE.sm - SIZE.xxs
      doc.page.drawText(item.label.toUpperCase(), { x: x + SPACE.sm, y: cy, size: SIZE.xxs, font: F.regular, color: COLOR.secondary })
      cy -= 4 + SIZE.sm
      const valueStyle: TextStyle = { font: F.heading, size: SIZE.sm, color: COLOR.black, maxWidth: gridColW - SPACE.sm * 2, lineHeight: 1.35 }
      const valueLines = wrapText(pdfText(item.value), valueStyle.font, valueStyle.size, valueStyle.maxWidth!).slice(0, 2)
      for (const line of valueLines) {
        doc.page.drawText(line, { x: x + SPACE.sm, y: cy, size: valueStyle.size, font: valueStyle.font, color: valueStyle.color })
        cy -= textLineHeight(valueStyle)
      }
    })
    doc.y = rowTop - gridBoxH
    doc.moveDown(gap)
  }
  doc.moveDown(SPACE.sm)

  // ── Équipements ──
  if (intervention.contract?.equipements?.length) {
    drawSection(doc, 'Équipements', F, () => {
      for (const eq of intervention.contract!.equipements) {
        const text = `${eq.nom}${eq.ref ? ` · ${eq.ref}` : ''}${eq.localisation ? ` · ${eq.localisation}` : ''}`
        drawParagraph(doc, text, F)
      }
    })
  }

  drawSection(doc, 'Travaux réalisés', F, () => {
    drawParagraph(doc, intervention.rapport || '-', F)
  })

  drawSection(doc, 'Observations et recommandations', F, () => {
    drawParagraph(doc, intervention.observations || '-', F)
  })

  // ── Photos ──
  if (reportPhotos.length > 0) {
    drawSection(doc, `Photos de l'intervention (${reportPhotos.length})`, F, null)
    doc.moveDown(SPACE.sm)

    const photoGap = SPACE.md
    const cellW = (CONTENT_WIDTH - photoGap) / 2
    const imgH = 150

    for (let i = 0; i < reportPhotos.length; i += 2) {
      const rowPhotos = reportPhotos.slice(i, i + 2)
      const imgs = await Promise.all(rowPhotos.map(p => embedImage(doc.doc, p.url)))
      const captionHeights = rowPhotos.map(p => {
        if (!p.caption) return 0
        const style: TextStyle = { font: F.regular, size: SIZE.xxs, color: COLOR.secondary, maxWidth: cellW, align: 'center', lineHeight: 1.4 }
        const lines = wrapText(pdfText(p.caption), style.font, style.size, cellW)
        return 5 + lines.length * textLineHeight(style)
      })
      const rowH = SIZE.xs + 5 + imgH + Math.max(...captionHeights, 0)
      doc.ensureSpace(rowH + SPACE.sm)
      const rowTop = doc.y

      rowPhotos.forEach((photo, idx) => {
        const x = PAGE.margin + idx * (cellW + photoGap)
        let cy = rowTop
        const label = pdfText(photo.title ?? `Photo ${i + idx + 1}`)
        const lw = F.heading.widthOfTextAtSize(label, SIZE.xs)
        cy -= SIZE.xs
        doc.page.drawText(label, { x: x + (cellW - lw) / 2, y: cy, size: SIZE.xs, font: F.heading, color: COLOR.black })
        cy -= 5
        const img = imgs[idx]
        if (img) {
          drawImageContained(doc, img, { x, y: cy - imgH, w: cellW, h: imgH }, 'center')
        } else {
          doc.page.drawRectangle({ x, y: cy - imgH, width: cellW, height: imgH, color: COLOR.surface })
        }
        cy -= imgH
        if (photo.caption) {
          cy -= 5
          const style: TextStyle = { font: F.regular, size: SIZE.xxs, color: COLOR.secondary, maxWidth: cellW, align: 'center', lineHeight: 1.4 }
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

function drawSection(doc: PdfDoc, title: string, F: PdfDoc['fonts'], body: (() => void) | null): void {
  doc.ensureSpace(SIZE.md + SPACE.sm + SPACE.md)
  doc.moveDown(SPACE.md)
  doc.page.drawLine({ start: { x: PAGE.margin, y: doc.y }, end: { x: PAGE.width - PAGE.margin, y: doc.y }, thickness: 1, color: COLOR.divider })
  doc.y -= SPACE.sm
  doc.y -= SIZE.md
  doc.page.drawText(pdfText(title), { x: PAGE.margin, y: doc.y, size: SIZE.md, font: F.heading, color: COLOR.black })
  doc.y -= SPACE.xs
  if (body) body()
}

function drawParagraph(doc: PdfDoc, text: string, F: PdfDoc['fonts']): void {
  const style: TextStyle = { font: F.regular, size: SIZE.sm, color: COLOR.body, maxWidth: CONTENT_WIDTH, lineHeight: 1.5 }
  const lines = wrapText(pdfText(text), style.font, style.size, style.maxWidth!)
  for (const line of lines) {
    doc.ensureSpace(textLineHeight(style))
    doc.y -= style.size
    doc.page.drawText(line, { x: PAGE.margin, y: doc.y, size: style.size, font: style.font, color: style.color })
    doc.y -= textLineHeight(style) - style.size
  }
  doc.y -= 3
}
