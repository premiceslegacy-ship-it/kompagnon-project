import type { PdfOrganizationData } from '@/lib/pdf/document-types'
import { pdfText } from '@/lib/pdf/pdf-design-system'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { embedImage } from '../engine/image'
import {
  drawCompactHeader, drawHeader, drawKitTable, drawMeta, drawNote, drawParties, drawSignatureBoxes, drawTotals, installFooter,
  type KitCell, type KitColumn, type KitRow, type TotalLine,
} from '../engine/kit'
import { legalFooterLines } from '../engine/legal'
import { COLOR, CONTENT_WIDTH } from '../engine/theme'

type DgdPdfOrganization = Pick<
  PdfOrganizationData,
  | 'name'
  | 'postal_code'
  | 'city'
  | 'siret'
  | 'rcs'
  | 'rcs_ville'
  | 'is_vat_subject'
  | 'vat_number'
  | 'forme_juridique'
  | 'capital_social'
  | 'insurance_info'
  | 'decennale_enabled'
  | 'logo_url'
  | 'address_line1'
  | 'phone'
  | 'signatory_name'
>

// ─── Types ────────────────────────────────────────────────────────────────────

export type DgdLine = {
  label: string
  reference?: string | null
  date?: string | null
  amount_ht: number
  retention_pct?: number | null
  retention_amount?: number | null
  net_ht?: number | null
  cumulative_pct?: number | null
  type: 'marche' | 'avenant' | 'situation' | 'solde' | 'liberation_rg' | 'total'
}

export type DgdPdfData = {
  chantierTitle: string
  chantierAddress?: string | null
  clientName?: string | null
  marketReference?: string | null
  lines: DgdLine[]
  totalMarcheHt: number
  totalSituationsHt: number
  totalRetentionHt: number
  totalNetHt: number
  receptionDate?: string | null
  receptionStatus?: string | null
  organization: DgdPdfOrganization
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  pdfText(new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n))

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-'

const TYPE_LABELS: Record<DgdLine['type'], string> = {
  marche: 'Marché',
  avenant: 'Avenant',
  situation: 'Situation',
  solde: 'Solde',
  liberation_rg: 'Libération RG',
  total: 'TOTAL',
}

export async function renderDgdPdf(data: DgdPdfData, origin: string): Promise<Buffer> {
  const fontBytes = await loadFontBytes(origin)
  return renderDgdPdfWithFonts(data, fontBytes)
}

export async function renderDgdPdfWithFonts(data: DgdPdfData, fontBytes: FontBytes): Promise<Buffer> {
  const {
    chantierTitle, chantierAddress, clientName, marketReference, lines,
    totalMarcheHt, totalSituationsHt, totalRetentionHt, totalNetHt,
    receptionDate, receptionStatus, organization,
  } = data
  const doc = await PdfDoc.create(fontBytes)

  const isVatSubject = organization.is_vat_subject !== false
  const logoImg = organization.logo_url ? await embedImage(doc.doc, organization.logo_url) : null
  const brand = { logo: logoImg, name: organization.name }
  const heading = { title: 'Décompte général définitif', number: null }
  doc.onNewPage = ({ pageIndex }) => pageIndex === 0 ? drawHeader(doc, brand, heading) : drawCompactHeader(doc, brand, heading)
  installFooter(doc, legalFooterLines({ ...organization, certifications: null }, isVatSubject))
  doc.addPage()

  const receptionLabel = receptionStatus === 'sans_reserve' ? 'sans réserve' : receptionStatus === 'reserve_levee' ? 'réserves levées' : 'avec réserves'
  drawMeta(doc, [
    { label: 'Édité le', value: fmtLongDate(new Date().toISOString()) },
    ...(marketReference ? [{ label: 'Marché', value: marketReference }] : []),
    ...(receptionDate ? [{ label: 'Réception', value: `${fmtDate(receptionDate)}, ${receptionLabel}` }] : [{ label: 'Chantier', value: chantierTitle }]),
  ])
  drawParties(
    doc,
    {
      label: 'Entreprise',
      name: organization.name,
      lines: [organization.address_line1, [organization.postal_code, organization.city].filter(Boolean).join(' ') || null, organization.phone, organization.siret ? `SIRET ${organization.siret}` : null]
        .filter((l): l is string => !!l).map(pdfText),
    },
    { label: "Maître d'ouvrage", name: clientName ?? '—', lines: chantierAddress ? [pdfText(chantierAddress)] : [] },
  )
  drawNote(doc, 'Marché privé de travaux', `${chantierTitle}${chantierAddress ? `, ${chantierAddress}` : ''}. Décompte établi selon la norme NF P 03-001.`, 12)

  // ── Lignes du décompte ──
  const gap = 7.5
  const cols: KitColumn[] = [
    { width: CONTENT_WIDTH - (52 + 60 + 66 + 60) - gap * 4, header: 'Désignation' },
    { width: 52, header: 'Avct' },
    { width: 60, header: 'Montant HT' },
    { width: 66, header: 'Retenue' },
    { width: 60, header: 'Net HT' },
  ]
  const rows: KitRow[] = lines.map(line => {
    const isTotal = line.type === 'total'
    const details = [line.reference, line.date ? fmtDate(line.date) : null].filter((v): v is string => !!v).map(pdfText)
    const cells: KitCell[] = [
      { value: isTotal ? 'Total facturé HT' : pdfText(line.label).toLowerCase().startsWith(TYPE_LABELS[line.type].toLowerCase()) ? pdfText(line.label) : `${TYPE_LABELS[line.type]} · ${pdfText(line.label)}`, details: isTotal ? [] : details, bold: isTotal },
      { value: line.cumulative_pct != null ? `${line.cumulative_pct} %` : '' },
      { value: fmt(line.amount_ht), bold: isTotal },
      { value: line.retention_amount ? `−${fmt(line.retention_amount)}` : '' },
      { value: fmt(line.net_ht ?? line.amount_ht), bold: true },
    ]
    return isTotal ? { kind: 'total', cells } : { cells }
  })
  drawKitTable(doc, cols, rows, { gap })

  // ── Récapitulatif ──
  const recap: TotalLine[] = [
    { label: 'Marché initial et avenants HT', value: fmt(totalMarcheHt) },
    { label: 'Total facturé HT', value: fmt(totalSituationsHt) },
  ]
  if (totalRetentionHt > 0) recap.push({ label: 'Retenues de garantie', value: `−${fmt(totalRetentionHt)}` })
  drawTotals(doc, recap, { label: 'Solde net HT', value: fmt(totalNetHt) })
  if (totalRetentionHt > 0) drawNote(doc, null, 'La retenue de garantie est libérée un an après la réception des travaux.', 6)

  // ── Signatures ──
  drawSignatureBoxes(doc, [
    { title: `L'entrepreneur, ${pdfText(organization.name)}`, name: organization.signatory_name },
    { title: "Le maître d'ouvrage", name: clientName },
  ], 84)

  return doc.save()
}

const fmtLongDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
