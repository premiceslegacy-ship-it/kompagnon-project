import type { PdfOrganizationData } from '@/lib/pdf/document-types'
import type { ChantierDetail, Tache, ChantierNote } from '@/lib/data/queries/chantiers'
import { fmtCurrency, pdfText } from '@/lib/pdf/pdf-design-system'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { embedImage } from '../engine/image'
import {
  drawAside, drawEntries, drawLineTable, drawMeta, drawParties, drawPhotoGrid, drawProgress,
  drawSectionTitle, flexWidth, setupChrome, type LineRow, type Tone,
} from '../engine/layout'

type ChantierPdfOrganization = Pick<
  PdfOrganizationData,
  'name' | 'postal_code' | 'city' | 'logo_url' | 'address_line1' | 'siret' | 'phone' | 'email'
>

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDay(iso: string): Date {
  const part = iso.includes('T') ? iso.split('T')[0] : iso
  const [y, m, d] = part.split('-').map(Number)
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1))
}

const fmtDate = (iso: string | null | undefined): string =>
  iso ? parseDay(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '-'

const fmtShort = (iso: string | null | undefined): string =>
  iso ? parseDay(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '-'

const fmtMoney = (n: number) => fmtCurrency(n, 'EUR', 0)

const STATUS_LABELS: Record<string, string> = {
  planifie: 'Planifié',
  en_cours: 'En cours',
  suspendu: 'Suspendu',
  termine: 'Terminé',
  annule: 'Annulé',
}

const TASK_STATE: Record<string, { label: string; tone: Tone }> = {
  termine: { label: 'Terminée', tone: 'ok' },
  en_cours: { label: 'En cours', tone: 'warn' },
  a_faire: { label: 'À faire', tone: 'neutral' },
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
  /** Date d'édition (défaut : maintenant). */
  editedAt?: string | null
}

export async function renderChantierPdf(data: ChantierPdfData, origin: string): Promise<Buffer> {
  const fontBytes = await loadFontBytes(origin)
  return renderChantierPdfWithFonts(data, fontBytes)
}

export async function renderChantierPdfWithFonts(data: ChantierPdfData, fontBytes: FontBytes): Promise<Buffer> {
  const { chantier, taches, notes, organization, periodFrom, periodTo, reportPhotos } = data
  const doc = await PdfDoc.create(fontBytes)

  const donePct = chantier.taches_count > 0 ? Math.round((chantier.taches_done / chantier.taches_count) * 100) : 0
  const editedAt = data.editedAt ?? new Date().toISOString()

  const periodLabel = (periodFrom || periodTo)
    ? ['Période', periodFrom && `du ${fmtShort(periodFrom)}`, periodTo && `au ${fmtShort(periodTo)}`].filter(Boolean).join(' ')
    : null

  const logoImg = organization.logo_url ? await embedImage(doc.doc, organization.logo_url) : null
  const orgPostalCity = [organization.postal_code, organization.city].filter(Boolean).join(' ')

  // L'en-tête se réduit au logo : coordonnées de l'entreprise dans le pied de page.
  setupChrome(doc, {
    title: 'Rapport de chantier',
    reference: periodLabel ?? `Édité le ${fmtDate(editedAt)}`,
    logo: logoImg,
    orgName: organization.name,
    footerLines: [
      [organization.name, [organization.address_line1, orgPostalCity].filter(Boolean).join(', '), organization.siret ? `SIRET ${organization.siret}` : null].filter(Boolean).join(' · '),
      [organization.phone, organization.email, periodLabel ? `Rapport édité le ${fmtDate(editedAt)}` : null].filter(Boolean).join(' · '),
    ].map(l => pdfText(l)).filter(Boolean),
  })
  doc.addPage()

  // ── Métadonnées ──
  drawMeta(doc, [
    { label: 'Période des travaux', value: `${fmtShort(chantier.start_date)} au ${fmtShort(chantier.estimated_end_date)}` },
    { label: 'Budget HT', value: fmtMoney(chantier.budget_ht) },
    { label: 'Avancement', value: `${chantier.taches_done} tâche${chantier.taches_done > 1 ? 's' : ''} sur ${chantier.taches_count}` },
    { label: 'Statut', value: STATUS_LABELS[chantier.status] ?? pdfText(chantier.status) },
  ])

  // ── Adresse du chantier / Contact référent ──
  const address = [chantier.address_line1, [chantier.postal_code, chantier.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  const hasContact = chantier.contact_name || chantier.contact_email || chantier.contact_phone
  drawParties(doc,
    {
      label: 'Adresse du chantier',
      name: chantier.title,
      lines: [address, chantier.client?.company_name ? `Client : ${chantier.client.company_name}` : ''],
    },
    {
      label: 'Contact référent',
      name: hasContact ? (chantier.contact_name || '-') : '-',
      lines: [chantier.contact_phone ?? '', chantier.contact_email ?? ''],
    },
  )

  // ── Avancement ──
  drawProgress(doc, 'Avancement', donePct)

  // ── Tâches (en cours, à faire, terminées) ──
  const ordered = [
    ...taches.filter(t => t.status === 'en_cours'),
    ...taches.filter(t => t.status === 'a_faire'),
    ...taches.filter(t => t.status === 'termine'),
    ...taches.filter(t => !['en_cours', 'a_faire', 'termine'].includes(t.status)),
  ]
  drawSectionTitle(doc, taches.length > 0 ? `Tâches (${taches.length})` : 'Tâches')
  if (ordered.length === 0) {
    drawAside(doc, 'Aucune tâche enregistrée.', { align: 'left' })
  } else {
    const fixed = [75, 67.5]
    const rows: LineRow[] = ordered.map(t => {
      const state = TASK_STATE[t.status] ?? { label: pdfText(t.status), tone: 'neutral' as const }
      return {
        cells: [
          { text: pdfText(t.title), detail: [t.description ?? '', t.progress_note ?? ''] },
          { text: state.label, pill: state.tone },
          t.due_date ? fmtShort(t.due_date) : '',
        ],
      }
    })
    drawLineTable(doc, [
      { header: 'Tâche', width: flexWidth(fixed) },
      { header: 'État', width: 75, align: 'left' },
      { header: 'Échéance', width: 67.5 },
    ], rows, { marginTop: 4.5 })
  }

  // ── Journal ──
  if (notes.length > 0) {
    drawSectionTitle(doc, `Journal de chantier (${notes.length} entrée${notes.length > 1 ? 's' : ''})`)
    drawEntries(doc, notes.map(n => ({
      meta: `${n.author_name} · ${new Date(n.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`,
      text: n.content,
    })))
  }

  // ── Photos ──
  if (reportPhotos && reportPhotos.length > 0) {
    drawSectionTitle(doc, `Photos du chantier (${reportPhotos.length} photo${reportPhotos.length > 1 ? 's' : ''})`)
    const images = await Promise.all(reportPhotos.map(p => embedImage(doc.doc, p.url)))
    drawPhotoGrid(doc, reportPhotos.map((p, i) => ({
      image: images[i],
      title: p.title ?? `Photo ${i + 1}`,
      caption: p.caption,
    })))
  }

  return doc.save()
}
