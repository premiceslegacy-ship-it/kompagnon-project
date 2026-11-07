import type { PdfOrganizationData } from '@/lib/pdf/document-types'
import type { ChantierDetail, Tache, ChantierNote } from '@/lib/data/queries/chantiers'
import { fmtCurrency, pdfText } from '@/lib/pdf/pdf-design-system'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { embedImage } from '../engine/image'
import {
  drawClause, drawCompactHeader, drawHeader, drawKitTable, drawMeta, drawParties, drawPhotoGrid, drawProgress, drawSectionHeading, installFooter,
  type KitCell, type KitColumn, type KitPhoto, type KitRow,
} from '../engine/kit'
import { organizationPartyLines } from '../engine/legal'
import { CONTENT_WIDTH } from '../engine/theme'

type ChantierPdfOrganization = Pick<
  PdfOrganizationData,
  'name' | 'postal_code' | 'city' | 'logo_url' | 'address_line1' | 'siret' | 'phone' | 'email'
>

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '-'
  const part = iso.includes('T') ? iso.split('T')[0] : iso
  const [y, m, d] = part.split('-')
  return `${(d ?? '').padStart(2, '0')}/${(m ?? '').padStart(2, '0')}/${y ?? ''}`
}

const fmtMoney = (n: number) => fmtCurrency(n, 'EUR', 2)

const STATUS_LABELS: Record<string, string> = {
  planifie: 'Planifié',
  en_cours: 'En cours',
  suspendu: 'Suspendu',
  termine: 'Terminé',
  annule: 'Annulé',
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
  organization: ChantierPdfOrganization
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

  const donePct = chantier.taches_count > 0 ? Math.round((chantier.taches_done / chantier.taches_count) * 100) : 0
  const periodLabel = (periodFrom || periodTo)
    ? [periodFrom && `du ${fmtDate(periodFrom)}`, periodTo && `au ${fmtDate(periodTo)}`].filter(Boolean).join(' ')
    : null

  const logoImg = organization.logo_url ? await embedImage(doc.doc, organization.logo_url) : null
  const brand = { logo: logoImg, name: organization.name }
  const heading = { title: 'Rapport de chantier', number: pdfText(chantier.title) }
  doc.onNewPage = ({ pageIndex }) => pageIndex === 0 ? drawHeader(doc, brand, heading) : drawCompactHeader(doc, brand, { title: 'Rapport de chantier', number: pdfText(chantier.title) })
  installFooter(doc, [
    [organization.name, organization.siret ? `SIRET ${organization.siret}` : null].filter(Boolean).join(' · '),
    [organization.phone, organization.email].filter(Boolean).join(' · '),
  ].filter(l => l.length > 0).map(pdfText))
  doc.addPage()

  drawMeta(doc, [
    { label: periodLabel ? 'Période du rapport' : 'Période des travaux', value: periodLabel ?? `${fmtDate(chantier.start_date)} au ${fmtDate(chantier.estimated_end_date)}` },
    { label: 'Budget HT', value: fmtMoney(chantier.budget_ht) },
    { label: 'Avancement', value: `${chantier.taches_done} tâche${chantier.taches_done > 1 ? 's' : ''} sur ${chantier.taches_count}` },
  ])

  const address = [chantier.address_line1, [chantier.postal_code, chantier.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  const contactLines = [chantier.contact_email, chantier.contact_phone].filter((l): l is string => !!l)
  drawParties(
    doc,
    { label: 'Adresse du chantier', name: pdfText(chantier.title), lines: [address, STATUS_LABELS[chantier.status] ?? chantier.status, chantier.client?.company_name ?? null].filter((l): l is string => !!l).map(pdfText) },
    { label: 'Contact référent', name: pdfText(chantier.contact_name ?? chantier.client?.company_name ?? '—'), lines: contactLines.map(pdfText) },
  )
  drawProgress(doc, 'Avancement', donePct)

  // ── Tâches ──
  drawSectionHeading(doc, taches.length > 0 ? `Tâches (${taches.length})` : 'Tâches', 15)
  if (taches.length === 0) {
    drawClause(doc, 'Aucune tâche', 'Aucune tâche enregistrée sur ce chantier.')
  } else {
    const gap = 7.5
    const cols: KitColumn[] = [
      { width: CONTENT_WIDTH - 72 - 60 - gap * 2, header: 'Tâche' },
      { width: 72, header: 'État', align: 'left' },
      { width: 60, header: 'Date' },
    ]
    const rows: KitRow[] = taches.map(t => {
      const details = [
        t.description ? pdfText(t.description) : null,
        t.progress_note ? `Note : ${pdfText(t.progress_note)}` : null,
      ].filter((d): d is string => !!d)
      const done = t.status === 'termine'
      const cells: KitCell[] = [
        { value: pdfText(t.title), details },
        { value: TACHE_LABELS[t.status], pill: done ? 'green' : t.status === 'en_cours' ? 'amber' : 'neutral' },
        { value: fmtDate(done ? t.completed_at : t.due_date) === '-' ? '' : fmtDate(done ? t.completed_at : t.due_date) },
      ]
      return { cells }
    })
    drawKitTable(doc, cols, rows, { gap, gapTop: 4 })
  }

  // ── Journal ──
  if (notes.length > 0) {
    drawSectionHeading(doc, `Journal de chantier (${notes.length} entrée${notes.length > 1 ? 's' : ''})`, 18)
    for (const n of notes) {
      const date = new Date(n.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
      drawClause(doc, `${pdfText(n.author_name)} · ${date}`, n.content)
    }
  }

  // ── Photos ──
  if (reportPhotos && reportPhotos.length > 0) {
    drawSectionHeading(doc, `Photos du chantier (${reportPhotos.length})`, 18)
    const photos: KitPhoto[] = []
    for (const [i, p] of reportPhotos.entries()) {
      photos.push({ image: await embedImage(doc.doc, p.url), title: p.title ?? `Photo ${i + 1}`, caption: p.caption })
    }
    drawPhotoGrid(doc, photos)
  }

  return doc.save()
}

const TACHE_LABELS: Record<Tache['status'], string> = { a_faire: 'À venir', en_cours: 'En cours', termine: 'Terminée' }
