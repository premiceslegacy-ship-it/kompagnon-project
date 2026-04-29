import React from 'react'
import { Document, Page, View, Text, StyleSheet, Image } from '@react-pdf/renderer'
import type { Organization } from '@/lib/data/queries/organization'
import type { ChantierDetail, Tache, Pointage, ChantierNote } from '@/lib/data/queries/chantiers'
import { registerFonts, DS } from '@/lib/pdf/pdf-design-system'

registerFonts()

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '-'
  const part = iso.includes('T') ? iso.split('T')[0] : iso
  const [y, m, d] = part.split('-')
  return `${(d ?? '').padStart(2, '0')}/${(m ?? '').padStart(2, '0')}/${y ?? ''}`
}

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
    .format(n)
    .replace(/\s/g, ' ')

function fmtHours(hours: number): string {
  const h = Math.floor(hours)
  const min = Math.round((hours - h) * 60)
  return min === 0 ? `${h}h` : `${h}h${String(min).padStart(2, '0')}`
}

const STATUS_LABELS: Record<string, string> = {
  planifie: 'Planifie',
  en_cours: 'En cours',
  suspendu: 'Suspendu',
  termine:  'Termine',
  annule:   'Annule',
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChantierPDFPhoto = {
  id: string
  url: string
  title: string | null
  caption: string | null
}

export type ChantierPDFProps = {
  chantier: ChantierDetail
  taches: Tache[]
  pointages: Pointage[]
  notes: ChantierNote[]
  organization: Organization
  periodFrom?: string | null
  periodTo?: string | null
  reportPhotos?: ChantierPDFPhoto[]
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  page: {
    fontFamily: DS.font.body,
    fontSize: DS.size.base,
    color: DS.color.body,
    backgroundColor: DS.color.white,
    paddingTop: DS.space.xl,
    paddingBottom: 50,
    paddingHorizontal: DS.space.page,
  },

  // Header — dans le flow normal, affiché une seule fois, pas fixed
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: DS.space.lg,
    paddingBottom: DS.space.md,
    borderBottomWidth: 1,
    borderBottomColor: DS.color.divider,
  },
  orgName: {
    fontFamily: DS.font.heading,
    fontWeight: 800,
    fontSize: DS.size.md,
    color: DS.color.black,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  orgDetail: {
    fontFamily: DS.font.body,
    fontSize: DS.size.xs,
    color: DS.color.secondary,
    marginTop: 2,
  },

  titleBlock: {
    marginBottom: DS.space.lg,
    borderBottomWidth: 1,
    borderBottomColor: DS.color.black,
    paddingBottom: DS.space.md,
  },
  titleLabel: {
    fontFamily: DS.font.heading,
    fontWeight: 800,
    fontSize: DS.size.xxl,
    color: DS.color.black,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  titleSub: {
    fontFamily: DS.font.heading,
    fontWeight: 700,
    fontSize: DS.size.lg,
    color: DS.color.black,
    marginTop: 4,
  },
  titleMeta: {
    fontFamily: DS.font.body,
    fontSize: DS.size.xs,
    color: DS.color.secondary,
    marginTop: 4,
  },
  titleAccentLine: {
    height: 3,
    backgroundColor: DS.color.accent,
    marginTop: DS.space.sm,
    width: 40,
  },

  infoRow:   { flexDirection: 'row', gap: DS.space.sm, marginBottom: DS.space.md },
  infoBlock: {
    flex: 1,
    backgroundColor: DS.color.surface,
    padding: DS.space.md,
  },
  infoLabel: {
    fontFamily: DS.font.heading,
    fontWeight: 800,
    fontSize: DS.size.xxs,
    color: DS.color.secondary,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: DS.space.xs,
  },
  infoValue: {
    fontFamily: DS.font.body,
    fontSize: DS.size.sm,
    color: DS.color.body,
    lineHeight: 1.5,
  },
  infoBig: {
    fontFamily: DS.font.heading,
    fontWeight: 800,
    fontSize: DS.size.lg,
    color: DS.color.black,
  },
  infoBigSub: {
    fontFamily: DS.font.body,
    fontSize: DS.size.xs,
    color: DS.color.secondary,
    marginTop: 2,
  },
  progressBar:  { height: 4, backgroundColor: DS.color.divider, marginTop: DS.space.sm },
  progressFill: { height: 4, backgroundColor: DS.color.accent },

  sectionTitle: {
    fontFamily: DS.font.heading,
    fontWeight: 800,
    fontSize: DS.size.sm,
    color: DS.color.black,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: DS.space.lg,
    paddingBottom: DS.space.xs,
    borderBottomWidth: 1,
    borderBottomColor: DS.color.black,
    marginBottom: 0,
  },

  groupTitle: {
    fontFamily: DS.font.heading,
    fontWeight: 700,
    fontSize: DS.size.xs,
    paddingTop: DS.space.sm,
    paddingBottom: DS.space.xs,
    color: DS.color.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  taskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: DS.space.sm,
    paddingBottom: 2,
  },
  taskTitle: {
    fontFamily: DS.font.heading,
    fontWeight: 700,
    fontSize: DS.size.sm,
    color: DS.color.black,
    flex: 1,
    lineHeight: 1.4,
  },
  taskDate: {
    fontFamily: DS.font.body,
    fontSize: DS.size.xs,
    color: DS.color.secondary,
    width: 90,
    flexShrink: 0,
    textAlign: 'right',
  },
  taskNote: {
    fontFamily: DS.font.body,
    fontSize: DS.size.xs,
    color: DS.color.body,
    lineHeight: 1.5,
    paddingHorizontal: DS.space.sm,
    paddingVertical: DS.space.xs,
    borderLeftWidth: 2,
    borderLeftColor: DS.color.accent,
    marginTop: DS.space.xs,
    marginBottom: DS.space.xs,
  },
  taskDesc: {
    fontFamily: DS.font.body,
    fontSize: DS.size.xs,
    color: DS.color.secondary,
    lineHeight: 1.5,
    paddingLeft: DS.space.sm,
    paddingTop: 2,
    paddingBottom: DS.space.xs,
  },
  taskDivider: { height: 0.5, backgroundColor: DS.color.divider },

  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: DS.color.black,
    paddingBottom: DS.space.xs,
    marginTop: DS.space.sm,
    marginBottom: 0,
  },
  tableHeaderCell: {
    fontFamily: DS.font.heading,
    fontWeight: 800,
    fontSize: DS.size.xxs,
    color: DS.color.black,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: DS.space.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: DS.color.divider,
    alignItems: 'flex-start',
  },
  tableCell:  { fontFamily: DS.font.body, fontSize: DS.size.sm, color: DS.color.body, lineHeight: 1.4 },
  tableMuted: { fontFamily: DS.font.body, fontSize: DS.size.sm, color: DS.color.secondary, lineHeight: 1.4 },

  // Colonnes pointages : largeurs fixes + marginRight pour garantir l'espace
  ptDate:  { width: 58, flexShrink: 0, marginRight: 8 },
  ptUser:  { width: 95, flexShrink: 0, marginRight: 8 },
  ptHours: { width: 36, flexShrink: 0, marginRight: 8, textAlign: 'right' },
  ptTache: { flex: 1,   marginRight: 8 },
  ptDesc:  { flex: 2 },

  noteBlock: {
    paddingVertical: DS.space.sm,
    paddingHorizontal: DS.space.md,
    marginBottom: DS.space.sm,
    backgroundColor: DS.color.surface,
    borderLeftWidth: 2,
    borderLeftColor: DS.color.accent,
  },
  noteMeta:    { fontFamily: DS.font.body, fontSize: DS.size.xs, color: DS.color.secondary, marginBottom: 4 },
  noteContent: { fontFamily: DS.font.body, fontSize: DS.size.sm, color: DS.color.body, lineHeight: 1.5 },

  footer: {
    position: 'absolute',
    bottom: 18,
    left: DS.space.page,
    right: DS.space.page,
    borderTopWidth: 0.5,
    borderTopColor: DS.color.divider,
    paddingTop: DS.space.xs,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: { fontFamily: DS.font.body, fontSize: DS.size.xxs, color: DS.color.muted },

  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: DS.space.md,
    gap: DS.space.md,
  },
  photoCell: {
    width: '47%',
    marginBottom: DS.space.sm,
  },
  photoLabel: {
    fontFamily: DS.font.heading,
    fontWeight: 700,
    fontSize: DS.size.xs,
    color: DS.color.black,
    textAlign: 'center',
    marginBottom: DS.space.xs,
  },
  photoImg: {
    width: '100%',
    objectFit: 'cover',
    borderRadius: 4,
    height: 160,
  },
  photoCaption: {
    fontFamily: DS.font.body,
    fontSize: DS.size.xs,
    color: DS.color.secondary,
    marginTop: DS.space.xs,
    lineHeight: 1.4,
    textAlign: 'center',
  },
})

// ─── Composants locaux ────────────────────────────────────────────────────────

function Footer({ orgName, title }: { orgName: string; title: string }) {
  return (
    <View style={S.footer} fixed>
      <Text style={S.footerText}>{orgName + ' - Rapport de chantier - ' + title}</Text>
      <Text style={S.footerText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  )
}

function TacheRow({ t }: { t: Tache }) {
  return (
    <View>
      <View style={S.taskRow}>
        <Text style={S.taskTitle}>{t.title}</Text>
        {t.due_date ? <Text style={S.taskDate}>{'Echeance : ' + fmtDate(t.due_date)}</Text> : null}
      </View>
      {t.description ? <Text style={S.taskDesc}>{t.description}</Text> : null}
      {t.progress_note ? <Text style={S.taskNote}>{t.progress_note}</Text> : null}
      <View style={S.taskDivider} />
    </View>
  )
}

function TacheGroup({ label, taches }: { label: string; taches: Tache[] }) {
  if (taches.length === 0) return null
  return (
    <View>
      {taches.map((t, i) => (
        <View key={t.id} wrap={false}>
          {i === 0 ? <Text style={S.groupTitle}>{label}</Text> : null}
          <TacheRow t={t} />
        </View>
      ))}
    </View>
  )
}

// ─── Composant principal ──────────────────────────────────────────────────────

export default function ChantierPDF({
  chantier, taches, pointages, notes, organization, periodFrom, periodTo, reportPhotos,
}: ChantierPDFProps) {
  const donePct = chantier.taches_count > 0
    ? Math.round((chantier.taches_done / chantier.taches_count) * 100)
    : 0

  const totalHours = pointages.reduce((s, p) => s + p.hours, 0)
  const today = fmtDate(new Date().toISOString())

  const tachesEnCours   = taches.filter(t => t.status === 'en_cours')
  const tachesAFaire    = taches.filter(t => t.status === 'a_faire')
  const tachesTerminees = taches.filter(t => t.status === 'termine')

  const periodLabel = (periodFrom || periodTo)
    ? [periodFrom && `du ${fmtDate(periodFrom)}`, periodTo && `au ${fmtDate(periodTo)}`].filter(Boolean).join(' ')
    : null

  const footer = <Footer orgName={organization.name} title={chantier.title} />

  return (
    <Document>
      {/*
        Un seul <Page> pour tout le document.
        Les sections s'enchainent dans le flow naturel de react-pdf.
        Les sauts de page se font automatiquement quand le contenu depasse.
      */}
      <Page size="A4" style={S.page}>

        {/* ── Header : une seule fois, pas fixed ── */}
        <View style={S.header}>
          <View>
            <Text style={S.orgName}>{organization.name}</Text>
            {organization.address_line1 ? <Text style={S.orgDetail}>{organization.address_line1}</Text> : null}
            {(organization.postal_code || organization.city) ? (
              <Text style={S.orgDetail}>{[organization.postal_code, organization.city].filter(Boolean).join(' ')}</Text>
            ) : null}
            {organization.siret ? <Text style={S.orgDetail}>{'SIRET ' + organization.siret}</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={S.orgDetail}>{'Rapport genere le ' + today}</Text>
            {organization.phone ? <Text style={S.orgDetail}>{organization.phone}</Text> : null}
            {organization.email ? <Text style={S.orgDetail}>{organization.email}</Text> : null}
          </View>
        </View>

        {/* ── Titre ── */}
        <View style={S.titleBlock}>
          <Text style={S.titleLabel}>Rapport de chantier</Text>
          <Text style={S.titleSub}>{chantier.title}</Text>
          <View style={{ flexDirection: 'row', gap: DS.space.xl, marginTop: 4 }}>
            <Text style={S.titleMeta}>{STATUS_LABELS[chantier.status] ?? chantier.status}</Text>
            {chantier.client?.company_name ? (
              <Text style={S.titleMeta}>{'Client : ' + chantier.client.company_name}</Text>
            ) : null}
            {periodLabel ? <Text style={S.titleMeta}>{'Periode : ' + periodLabel}</Text> : null}
          </View>
          <View style={S.titleAccentLine} />
        </View>

        {/* ── Grille synthese ── */}
        <View style={S.infoRow}>
          <View style={S.infoBlock}>
            <Text style={S.infoLabel}>Periode des travaux</Text>
            <Text style={S.infoValue}>{fmtDate(chantier.start_date) + ' - ' + fmtDate(chantier.estimated_end_date)}</Text>
          </View>
          <View style={S.infoBlock}>
            <Text style={S.infoLabel}>Budget HT</Text>
            <Text style={S.infoBig}>{fmtMoney(chantier.budget_ht)}</Text>
          </View>
          <View style={S.infoBlock}>
            <Text style={S.infoLabel}>Heures pointees</Text>
            <Text style={S.infoBig}>{fmtHours(totalHours)}</Text>
          </View>
          <View style={S.infoBlock}>
            <Text style={S.infoLabel}>Avancement</Text>
            <Text style={S.infoBig}>{donePct + '%'}</Text>
            <Text style={S.infoBigSub}>{chantier.taches_done + '/' + chantier.taches_count + ' taches'}</Text>
            <View style={S.progressBar}>
              <View style={{ ...S.progressFill, width: `${donePct}%` }} />
            </View>
          </View>
        </View>

        {/* ── Adresse + contact ── */}
        {(chantier.address_line1 || chantier.city || chantier.contact_name || chantier.contact_email || chantier.contact_phone) ? (
          <View style={{ flexDirection: 'row', gap: DS.space.sm, marginBottom: DS.space.md }}>
            {(chantier.address_line1 || chantier.city) ? (
              <View style={{ ...S.infoBlock, flex: 1 }}>
                <Text style={S.infoLabel}>Adresse du chantier</Text>
                <Text style={S.infoValue}>
                  {[chantier.address_line1, chantier.postal_code, chantier.city].filter(Boolean).join(', ')}
                </Text>
              </View>
            ) : null}
            {(chantier.contact_name || chantier.contact_email || chantier.contact_phone) ? (
              <View style={{ ...S.infoBlock, flex: 1 }}>
                <Text style={S.infoLabel}>Contact referent</Text>
                {chantier.contact_name  ? <Text style={S.infoValue}>{chantier.contact_name}</Text> : null}
                {chantier.contact_email ? <Text style={{ ...S.infoValue, color: DS.color.black }}>{chantier.contact_email}</Text> : null}
                {chantier.contact_phone ? <Text style={S.infoValue}>{chantier.contact_phone}</Text> : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* ── Section Taches ── */}
        <Text style={S.sectionTitle}>{taches.length > 0 ? 'Taches (' + taches.length + ')' : 'Taches'}</Text>

        {taches.length === 0 ? (
          <Text style={{ fontFamily: DS.font.body, fontSize: DS.size.xs, color: DS.color.muted, marginTop: DS.space.sm }}>
            Aucune tache enregistree.
          </Text>
        ) : null}

        <TacheGroup label={'En cours (' + tachesEnCours.length + ')'} taches={tachesEnCours} />
        <TacheGroup label={'A faire (' + tachesAFaire.length + ')'} taches={tachesAFaire} />
        <TacheGroup label={'Terminees (' + tachesTerminees.length + ')'} taches={tachesTerminees} />

        {/* ── Section Pointages : s'enchaine apres les taches ── */}
        {pointages.length > 0 ? (
          <View>
            <Text style={S.sectionTitle}>
              {'Pointages (' + pointages.length + ' entree' + (pointages.length > 1 ? 's' : '') + ' - ' + fmtHours(totalHours) + ' au total)'}
            </Text>

            <View style={S.tableHeader}>
              <Text style={{ ...S.tableHeaderCell, ...S.ptDate }}>Date</Text>
              <Text style={{ ...S.tableHeaderCell, ...S.ptUser }}>Collaborateur</Text>
              <Text style={{ ...S.tableHeaderCell, ...S.ptHours }}>Heures</Text>
              <Text style={{ ...S.tableHeaderCell, ...S.ptTache }}>Tache</Text>
              <Text style={{ ...S.tableHeaderCell, ...S.ptDesc }}>Description</Text>
            </View>

            {pointages.map(p => (
              <View key={p.id} style={S.tableRow} wrap={false}>
                <Text style={{ ...S.tableMuted, ...S.ptDate }}>{fmtDate(p.date)}</Text>
                <Text style={{ ...S.tableCell,  ...S.ptUser }}>{p.user_name}</Text>
                <Text style={{ ...S.tableMuted, ...S.ptHours }}>{fmtHours(p.hours)}</Text>
                <Text style={{ ...S.tableMuted, ...S.ptTache }}>{p.tache_title ?? '-'}</Text>
                <Text style={{ ...S.tableMuted, ...S.ptDesc }}>{p.description ?? '-'}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* ── Section Journal : s'enchaine apres les pointages ── */}
        {notes.length > 0 ? (
          <View>
            <Text style={S.sectionTitle}>
              {'Journal de chantier (' + notes.length + ' entree' + (notes.length > 1 ? 's' : '') + ')'}
            </Text>

            <View style={{ marginTop: DS.space.sm }}>
              {notes.map(n => (
                <View key={n.id} style={S.noteBlock} wrap={false}>
                  <Text style={S.noteMeta}>
                    {n.author_name + '  -  ' + new Date(n.created_at).toLocaleDateString('fr-FR', {
                      day: '2-digit', month: 'long', year: 'numeric',
                    })}
                  </Text>
                  <Text style={S.noteContent}>{n.content}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* ── Section Photos : grille 2 colonnes, titre + description centrés ── */}
        {reportPhotos && reportPhotos.length > 0 ? (
          <View wrap={false}>
            <Text style={S.sectionTitle}>
              {'Photos du chantier (' + reportPhotos.length + ' photo' + (reportPhotos.length > 1 ? 's' : '') + ')'}
            </Text>

            <View style={S.photoGrid}>
              {reportPhotos.map((photo, i) => (
                <View key={photo.id} style={S.photoCell} wrap={false}>
                  <Text style={S.photoLabel}>{photo.title ?? ('Photo ' + (i + 1))}</Text>
                  <Image src={photo.url} style={S.photoImg} />
                  {photo.caption ? <Text style={S.photoCaption}>{photo.caption}</Text> : null}
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {footer}
      </Page>
    </Document>
  )
}
