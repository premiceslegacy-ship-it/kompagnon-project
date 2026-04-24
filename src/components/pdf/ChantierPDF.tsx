import React from 'react'
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import type { Organization } from '@/lib/data/queries/organization'
import type { ChantierDetail, Tache, Pointage, ChantierNote } from '@/lib/data/queries/chantiers'
import { registerFonts, DS } from '@/lib/pdf/pdf-design-system'

registerFonts()

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '-'
  const [y, m, d] = iso.split('T')[0].split('-')
  return `${d}/${m}/${y}`
}

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
    .format(n)
    .replace(/ /g, ' ')

function fmtHours(hours: number): string {
  const h = Math.floor(hours)
  const min = Math.round((hours - h) * 60)
  return min === 0 ? `${h}h` : `${h}h${String(min).padStart(2, '0')}`
}

const STATUS_LABELS: Record<string, string> = {
  planifie:  'Planifié',
  en_cours:  'En cours',
  suspendu:  'Suspendu',
  termine:   'Terminé',
  annule:    'Annulé',
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChantierPDFProps = {
  chantier: ChantierDetail
  taches: Tache[]
  pointages: Pointage[]
  notes: ChantierNote[]
  organization: Organization
  periodFrom?: string | null
  periodTo?: string | null
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  page: {
    fontFamily: DS.font.body,
    fontSize: DS.size.base,
    color: DS.color.body,
    backgroundColor: DS.color.white,
    paddingTop: DS.space.xxl,
    paddingBottom: 52,
    paddingHorizontal: DS.space.page,
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: DS.space.xl,
    paddingBottom: DS.space.lg,
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
    marginBottom: DS.space.xl,
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

  infoRow:   { flexDirection: 'row', gap: DS.space.sm, marginBottom: DS.space.lg },
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
    paddingBottom: DS.space.sm,
    borderBottomWidth: 1,
    borderBottomColor: DS.color.black,
    marginBottom: 0,
  },

  groupTitle: {
    fontFamily: DS.font.heading,
    fontWeight: 700,
    fontSize: DS.size.xs,
    paddingVertical: DS.space.xs,
    marginTop: DS.space.sm,
    marginBottom: 2,
    color: DS.color.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  taskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: DS.space.md,
    borderBottomWidth: 0.5,
    borderBottomColor: DS.color.divider,
  },
  taskTitle:   { fontFamily: DS.font.body, fontSize: DS.size.sm, color: DS.color.body, flex: 1, lineHeight: 1.5 },
  taskDate:    { fontFamily: DS.font.body, fontSize: DS.size.xs, color: DS.color.secondary, width: 70, textAlign: 'right', paddingTop: 1 },
  taskNote:    { fontFamily: DS.font.body, fontSize: DS.size.xs, color: DS.color.body, lineHeight: 1.5, paddingHorizontal: DS.space.sm, paddingVertical: DS.space.xs, borderLeftWidth: 2, borderLeftColor: DS.color.accent, marginTop: 2 },
  taskDesc:    { fontFamily: DS.font.body, fontSize: DS.size.xs, color: DS.color.secondary, lineHeight: 1.5, paddingHorizontal: DS.space.sm, paddingTop: 2, paddingBottom: DS.space.xs },

  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: DS.color.black,
    paddingBottom: DS.space.sm,
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
    paddingVertical: DS.space.md,
    borderBottomWidth: 0.5,
    borderBottomColor: DS.color.divider,
    alignItems: 'flex-start',
  },
  tableCell:  { fontFamily: DS.font.body, fontSize: DS.size.sm, color: DS.color.body, lineHeight: 1.4 },
  tableMuted: { fontFamily: DS.font.body, fontSize: DS.size.sm, color: DS.color.secondary, lineHeight: 1.4 },

  noteBlock: {
    paddingVertical: DS.space.md,
    paddingHorizontal: DS.space.md,
    marginBottom: DS.space.sm,
    backgroundColor: DS.color.surface,
    borderLeftWidth: 2,
    borderLeftColor: DS.color.accent,
  },
  noteMeta:    { fontFamily: DS.font.body, fontSize: DS.size.xs, color: DS.color.secondary, marginBottom: DS.space.xs },
  noteContent: { fontFamily: DS.font.body, fontSize: DS.size.sm, color: DS.color.body, lineHeight: 1.6 },

  footer: {
    position: 'absolute',
    bottom: 20,
    left: DS.space.page,
    right: DS.space.page,
    borderTopWidth: 0.5,
    borderTopColor: DS.color.divider,
    paddingTop: DS.space.xs,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: { fontFamily: DS.font.body, fontSize: DS.size.xxs, color: DS.color.muted },
})

// ─── Composants locaux ────────────────────────────────────────────────────────

function Footer({ orgName, title }: { orgName: string; title: string }) {
  return (
    <View style={S.footer} fixed>
      <Text style={S.footerText}>{orgName}  ·  Rapport de chantier  ·  {title}</Text>
      <Text style={S.footerText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  )
}

function TacheRow({ t }: { t: Tache }) {
  return (
    <View wrap={false}>
      <View style={S.taskRow}>
        <Text style={S.taskTitle}>{t.title}</Text>
        {t.due_date && <Text style={S.taskDate}>Échéance : {fmtDate(t.due_date)}</Text>}
      </View>
      {t.progress_note && <Text style={S.taskNote}>{t.progress_note}</Text>}
      {t.description && <Text style={S.taskDesc}>{t.description}</Text>}
    </View>
  )
}

// ─── Composant principal ──────────────────────────────────────────────────────

export default function ChantierPDF({
  chantier, taches, pointages, notes, organization, periodFrom, periodTo,
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

      {/* ── Page 1 : Synthèse + Tâches ── */}
      <Page size="A4" style={S.page}>

        <View style={S.header} fixed>
          <View>
            <Text style={S.orgName}>{organization.name}</Text>
            {organization.address_line1 && <Text style={S.orgDetail}>{organization.address_line1}</Text>}
            {(organization.postal_code || organization.city) && (
              <Text style={S.orgDetail}>{[organization.postal_code, organization.city].filter(Boolean).join(' ')}</Text>
            )}
            {organization.siret && <Text style={S.orgDetail}>SIRET {organization.siret}</Text>}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={S.orgDetail}>Rapport généré le {today}</Text>
            {organization.phone && <Text style={S.orgDetail}>{organization.phone}</Text>}
            {organization.email && <Text style={S.orgDetail}>{organization.email}</Text>}
          </View>
        </View>

        <View style={S.titleBlock}>
          <Text style={S.titleLabel}>Rapport de chantier</Text>
          <Text style={S.titleSub}>{chantier.title}</Text>
          <View style={{ flexDirection: 'row', gap: DS.space.xl, marginTop: 4 }}>
            <Text style={S.titleMeta}>{STATUS_LABELS[chantier.status] ?? chantier.status}</Text>
            {chantier.client?.company_name && (
              <Text style={S.titleMeta}>Client : {chantier.client.company_name}</Text>
            )}
            {periodLabel && <Text style={S.titleMeta}>Période : {periodLabel}</Text>}
          </View>
          <View style={S.titleAccentLine} />
        </View>

        {/* Grille synthèse */}
        <View style={S.infoRow}>
          <View style={S.infoBlock}>
            <Text style={S.infoLabel}>Période des travaux</Text>
            <Text style={S.infoValue}>{fmtDate(chantier.start_date)} – {fmtDate(chantier.estimated_end_date)}</Text>
          </View>
          <View style={S.infoBlock}>
            <Text style={S.infoLabel}>Budget HT</Text>
            <Text style={S.infoBig}>{fmtMoney(chantier.budget_ht)}</Text>
          </View>
          <View style={S.infoBlock}>
            <Text style={S.infoLabel}>Heures pointées</Text>
            <Text style={S.infoBig}>{fmtHours(totalHours)}</Text>
          </View>
          <View style={S.infoBlock}>
            <Text style={S.infoLabel}>Avancement</Text>
            <Text style={S.infoBig}>{donePct}%</Text>
            <Text style={S.infoBigSub}>{chantier.taches_done}/{chantier.taches_count} tâches</Text>
            <View style={S.progressBar}>
              <View style={{ ...S.progressFill, width: `${donePct}%` }} />
            </View>
          </View>
        </View>

        {/* Adresse + contact */}
        {(chantier.address_line1 || chantier.city || chantier.contact_name || chantier.contact_email || chantier.contact_phone) && (
          <View style={{ flexDirection: 'row', gap: DS.space.sm, marginBottom: DS.space.lg }}>
            {(chantier.address_line1 || chantier.city) && (
              <View style={{ ...S.infoBlock, flex: 1 }}>
                <Text style={S.infoLabel}>Adresse du chantier</Text>
                <Text style={S.infoValue}>
                  {[chantier.address_line1, chantier.postal_code, chantier.city].filter(Boolean).join(', ')}
                </Text>
              </View>
            )}
            {(chantier.contact_name || chantier.contact_email || chantier.contact_phone) && (
              <View style={{ ...S.infoBlock, flex: 1 }}>
                <Text style={S.infoLabel}>Contact référent</Text>
                {chantier.contact_name  && <Text style={S.infoValue}>{chantier.contact_name}</Text>}
                {chantier.contact_email && <Text style={{ ...S.infoValue, color: DS.color.black }}>{chantier.contact_email}</Text>}
                {chantier.contact_phone && <Text style={S.infoValue}>{chantier.contact_phone}</Text>}
              </View>
            )}
          </View>
        )}

        {/* Tâches */}
        <Text style={S.sectionTitle}>Tâches{taches.length > 0 ? ` (${taches.length})` : ''}</Text>

        {taches.length === 0 && (
          <Text style={{ fontFamily: DS.font.body, fontSize: DS.size.xs, color: DS.color.muted, fontStyle: 'italic', marginTop: DS.space.sm }}>
            Aucune tâche enregistrée.
          </Text>
        )}

        {tachesEnCours.length > 0 && (
          <View>
            <Text style={S.groupTitle}>En cours ({tachesEnCours.length})</Text>
            {tachesEnCours.map(t => <TacheRow key={t.id} t={t} />)}
          </View>
        )}

        {tachesAFaire.length > 0 && (
          <View>
            <Text style={S.groupTitle}>À faire ({tachesAFaire.length})</Text>
            {tachesAFaire.map(t => <TacheRow key={t.id} t={t} />)}
          </View>
        )}

        {tachesTerminees.length > 0 && (
          <View>
            <Text style={S.groupTitle}>Terminées ({tachesTerminees.length})</Text>
            {tachesTerminees.map(t => <TacheRow key={t.id} t={t} />)}
          </View>
        )}

        {footer}
      </Page>

      {/* ── Page pointages ── */}
      {pointages.length > 0 && (
        <Page size="A4" style={S.page}>
          <Text style={S.sectionTitle}>
            Pointages ({pointages.length} entrée{pointages.length > 1 ? 's' : ''}  ·  {fmtHours(totalHours)} au total)
          </Text>

          <View style={{ marginTop: DS.space.sm }}>
            <View style={S.tableHeader}>
              <Text style={{ ...S.tableHeaderCell, width: 56 }}>Date</Text>
              <Text style={{ ...S.tableHeaderCell, flex: 1.2 }}>Collaborateur</Text>
              <Text style={{ ...S.tableHeaderCell, width: 44, textAlign: 'right' }}>Heures</Text>
              <Text style={{ ...S.tableHeaderCell, flex: 1 }}>Tâche</Text>
              <Text style={{ ...S.tableHeaderCell, flex: 2 }}>Description</Text>
            </View>

            {pointages.map(p => (
              <View key={p.id} style={S.tableRow} wrap={false}>
                <Text style={{ ...S.tableMuted, width: 56 }}>{fmtDate(p.date)}</Text>
                <Text style={{ ...S.tableCell,  flex: 1.2 }}>{p.user_name}</Text>
                <Text style={{ ...S.tableMuted, width: 44, textAlign: 'right' }}>{fmtHours(p.hours)}</Text>
                <Text style={{ ...S.tableMuted, flex: 1 }}>{p.tache_title ?? '—'}</Text>
                <Text style={{ ...S.tableMuted, flex: 2 }}>{p.description ?? '—'}</Text>
              </View>
            ))}
          </View>

          {footer}
        </Page>
      )}

      {/* ── Page journal ── */}
      {notes.length > 0 && (
        <Page size="A4" style={S.page}>
          <Text style={S.sectionTitle}>
            Journal de chantier ({notes.length} entrée{notes.length > 1 ? 's' : ''})
          </Text>

          <View style={{ marginTop: DS.space.sm }}>
            {notes.map(n => (
              <View key={n.id} style={S.noteBlock} wrap={false}>
                <Text style={S.noteMeta}>
                  {n.author_name}  ·  {new Date(n.created_at).toLocaleDateString('fr-FR', {
                    day: '2-digit', month: 'long', year: 'numeric',
                  })}
                </Text>
                <Text style={S.noteContent}>{n.content}</Text>
              </View>
            ))}
          </View>

          {footer}
        </Page>
      )}

    </Document>
  )
}
