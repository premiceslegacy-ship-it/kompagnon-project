import type { PdfOrganizationData } from '@/lib/pdf/document-types'
import { fmtCapitalSocial, pdfText } from '@/lib/pdf/pdf-design-system'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { embedImage } from '../engine/image'
import {
  drawCardRow, drawCentered, drawLineTable, drawMeta, drawParties, drawTotals, flexWidth,
  legalFooterLines, setupChrome, signatureCard, type LineRow,
} from '../engine/layout'
import { COLOR } from '../engine/theme'

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
  /** Date d'édition (défaut : maintenant). */
  editedAt?: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  pdfText(new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n))

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '-'

const TYPE_LABELS: Record<DgdLine['type'], string> = {
  marche: 'Marché',
  avenant: 'Avenant',
  situation: 'Situation',
  solde: 'Solde',
  liberation_rg: 'Libération de la retenue',
  total: 'Total',
}

const RECEPTION_LABELS: Record<string, string> = {
  sans_reserve: 'sans réserve',
  reserve_levee: 'réserves levées',
}

/** Libellés posés par le serveur sans accents (« TOTAL GENERAL », « Marche initial »). */
function displayLabel(line: DgdLine): string {
  const label = pdfText(line.label)
  if (line.type === 'total' && /^total general$/i.test(label)) return 'Total général'
  if (/^marche initial$/i.test(label)) return 'Marché initial'
  return label
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

  setupChrome(doc, {
    title: 'Décompte général définitif',
    reference: 'NF P 03-001, marché privé de travaux',
    logo: logoImg,
    orgName: organization.name,
    footerLines: legalFooterLines(organization, { isVatSubject, capital: fmtCapitalSocial(organization.capital_social) }),
  })
  doc.addPage()

  // ── Métadonnées ──
  const receptionLabel = receptionDate
    ? `${fmtDate(receptionDate)}, ${RECEPTION_LABELS[receptionStatus ?? ''] ?? 'avec réserves'}`
    : ''
  drawMeta(doc, [
    { label: 'Date', value: fmtDate(data.editedAt ?? new Date().toISOString()) },
    { label: 'Marché', value: pdfText(marketReference) },
    { label: 'Réception', value: receptionLabel },
  ])

  // ── Entreprise / Maître d'ouvrage ──
  drawParties(doc,
    {
      label: 'Entreprise',
      name: organization.name,
      lines: [
        [organization.address_line1, [organization.postal_code, organization.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
        [organization.phone, organization.siret ? `SIRET ${organization.siret}` : null].filter(Boolean).join(' · '),
      ],
    },
    { label: "Maître d'ouvrage", name: clientName || '-', lines: [] },
  )

  // ── Marché ──
  drawCentered(doc, 'Marché privé de travaux', [
    [chantierTitle, chantierAddress].filter(Boolean).join(', ') + '.',
    `Décompte établi selon la norme NF P 03-001${receptionDate ? `, après réception des travaux le ${fmtDate(receptionDate)}` : ''}.`,
  ].join(' '), { marginTop: 13.5 })

  // ── Tableau des lignes ──
  const fixed = [40, 69, 61.5, 69]
  const rows: LineRow[] = lines.map((line): LineRow => {
    const cells = [
      line.type === 'total'
        ? { text: displayLabel(line) }
        : {
            text: displayLabel(line),
            detail: [[TYPE_LABELS[line.type], line.reference, line.date ? fmtDate(line.date) : null].filter(Boolean).join(' · ')],
          },
      line.cumulative_pct != null ? `${line.cumulative_pct} %` : '',
      { text: fmt(line.amount_ht) },
      line.retention_amount ? { text: `−${fmt(line.retention_amount)}`, color: COLOR.warnInk } : '',
      { text: fmt(line.net_ht ?? line.amount_ht), bold: true },
    ]
    return line.type === 'total' ? { kind: 'total', cells } : { cells }
  })
  drawLineTable(doc, [
    { header: 'Désignation', width: flexWidth(fixed) },
    { header: 'Avct.', width: 40 },
    { header: 'Montant HT', width: 69 },
    { header: 'Retenue', width: 61.5 },
    { header: 'Net HT', width: 69 },
  ], rows)

  // ── Récapitulatif ──
  drawTotals(doc, {
    width: 250,
    lines: [
      { label: 'Marché initial et avenants HT', value: fmt(totalMarcheHt) },
      { label: 'Total facturé HT', value: fmt(totalSituationsHt) },
      ...(totalRetentionHt > 0 ? [{ label: 'Retenues de garantie prélevées', value: `−${fmt(totalRetentionHt)}`, color: COLOR.warnInk }] : []),
    ],
    grands: [{ label: 'Solde net HT', value: fmt(totalNetHt) }],
  })

  // ── Signatures, en bas de la dernière page ──
  drawCardRow(doc, [
    signatureCard(doc, "Le maître d'ouvrage", 'Date et signature', { lines: [clientName ?? ''] }),
    signatureCard(doc, "L'entreprise", 'Date et signature', { lines: [[organization.name, organization.signatory_name].filter(Boolean).join(', ')] }),
  ], { pin: true, marginTop: 13.5 })

  return doc.save()
}
