import React from 'react'
import {
  Document, Page, View, Text, StyleSheet,
} from '@react-pdf/renderer'
import type { Organization } from '@/lib/data/queries/organization'
import type { ChantierDetail, Tache, Pointage, ChantierNote } from '@/lib/data/queries/chantiers'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '-'
  // Forcer UTC pour éviter les décalages de timezone
  const [y, m, d] = iso.split('T')[0].split('-')
  return `${d}/${m}/${y}`
}

const fmtMoney = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
    .format(n)
    .replace(/\u202F/g, '\u00a0')

function fmtHours(hours: number): string {
  const h = Math.floor(hours)
  const min = Math.round((hours - h) * 60)
  if (min === 0) return `${h}h`
  return `${h}h${String(min).padStart(2, '0')}`
}

const STATUS_LABELS: Record<string, string> = {
  planifie: 'Planifié',
  en_cours: 'En cours',
  suspendu: 'Suspendu',
  termine: 'Terminé',
  annule: 'Annulé',
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

// ─── Palette ──────────────────────────────────────────────────────────────────

const C = {
  ink:     '#111827',
  mid:     '#374151',
  muted:   '#6b7280',
  light:   '#9ca3af',
  border:  '#e5e7eb',
  bg:      '#f9fafb',
  bgAlt:   '#f3f4f6',
  accent:  '#1d4ed8',
  green:   '#15803d',
  greenBg: '#dcfce7',
  blue:    '#1d4ed8',
  blueBg:  '#dbeafe',
  gray:    '#374151',
  grayBg:  '#f3f4f6',
  amber:   '#b45309',
  white:   '#ffffff',
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: C.ink,
    backgroundColor: C.white,
    paddingTop: 36,
    paddingBottom: 52,
    paddingHorizontal: 44,
  },

  // ── En-tête ──
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 20,
    paddingBottom: 12,
    borderBottomWidth: 1.5,
    borderBottomColor: C.ink,
  },
  orgName:   { fontFamily: 'Helvetica-Bold', fontSize: 13, color: C.ink },
  orgDetail: { fontSize: 7.5, color: C.muted, marginTop: 2 },

  // ── Bandeau titre ──
  banner: {
    backgroundColor: C.ink,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 6,
    marginBottom: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  bannerTitle:  { fontFamily: 'Helvetica-Bold', fontSize: 12, color: C.white, letterSpacing: 0.5 },
  bannerSub:    { fontSize: 9, color: 'rgba(255,255,255,0.8)', marginTop: 3 },
  bannerPeriod: { fontSize: 7.5, color: 'rgba(255,255,255,0.6)', marginTop: 6 },
  bannerRight:  { alignItems: 'flex-end' },
  bannerStatus: { fontSize: 8, color: 'rgba(255,255,255,0.9)', fontFamily: 'Helvetica-Bold' },
  bannerClient: { fontSize: 7.5, color: 'rgba(255,255,255,0.65)', marginTop: 3 },

  // ── Grille infos ──
  infoRow:   { flexDirection: 'row', gap: 10, marginBottom: 14 },
  infoBlock: { flex: 1, backgroundColor: C.bg, borderRadius: 5, padding: 9, borderWidth: 1, borderColor: C.border },
  infoLabel: { fontFamily: 'Helvetica-Bold', fontSize: 6.5, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 },
  infoValue: { fontSize: 8.5, color: C.ink, lineHeight: 1.4 },
  infoBig:   { fontFamily: 'Helvetica-Bold', fontSize: 13, color: C.ink },
  infoBigSub:{ fontSize: 7.5, color: C.muted, marginTop: 1 },

  // ── Barre de progression ──
  progressBar:  { height: 6, backgroundColor: C.border, borderRadius: 3, marginTop: 5 },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: C.accent },

  // ── Section titre ──
  sectionTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 10,
    color: C.ink,
    marginBottom: 0,
    marginTop: 14,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  sectionCount: { fontFamily: 'Helvetica', fontSize: 9, color: C.muted },

  // ── Sous-titre de groupe ──
  groupTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 4,
    marginTop: 10,
    marginBottom: 2,
  },

  // ── Ligne de tâche ──
  taskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  taskTitle:   { fontSize: 8.5, color: C.ink, flex: 1, lineHeight: 1.4 },
  taskDate:    { fontSize: 7.5, color: C.muted, width: 65, textAlign: 'right', paddingTop: 1 },
  taskNote:    { fontSize: 7.5, color: C.mid, lineHeight: 1.5, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: C.bgAlt, borderLeftWidth: 2, borderLeftColor: C.border, marginTop: 1 },
  taskDesc:    { fontSize: 7.5, color: C.muted, lineHeight: 1.4, paddingHorizontal: 8, paddingTop: 2, paddingBottom: 4 },

  // ── Tableau pointages ──
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: C.bgAlt,
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginBottom: 1,
  },
  tableHeaderCell: { fontFamily: 'Helvetica-Bold', fontSize: 7, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.3 },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    alignItems: 'flex-start',
  },
  tableCell:    { fontSize: 8, color: C.ink, lineHeight: 1.4 },
  tableMuted:   { fontSize: 8, color: C.muted, lineHeight: 1.4 },

  // ── Journal ──
  noteBlock: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginBottom: 6,
    backgroundColor: C.bg,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: C.border,
  },
  noteMeta:    { fontSize: 7.5, color: C.muted, marginBottom: 5 },
  noteContent: { fontSize: 8.5, color: C.ink, lineHeight: 1.6 },

  // ── Footer ──
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 44,
    right: 44,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 7,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: { fontSize: 7, color: C.light },
})

// ─── Composants locaux ────────────────────────────────────────────────────────

function Footer({ orgName, title }: { orgName: string; title: string }) {
  return (
    <View style={S.footer} fixed>
      <Text style={S.footerText}>{orgName} · Rapport de chantier · {title}</Text>
      <Text style={S.footerText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={S.sectionTitle}>{children}</Text>
}

function GroupHeader({ label, color, bg, count }: { label: string; color: string; bg: string; count: number }) {
  return (
    <View style={{ ...S.groupTitle, backgroundColor: bg }} wrap={false}>
      <Text style={{ ...S.groupTitle, backgroundColor: bg, color, margin: 0, padding: 0 }}>
        {label} ({count})
      </Text>
    </View>
  )
}

function TacheRow({ t }: { t: Tache }) {
  return (
    <View wrap={false} style={{ marginBottom: 0 }}>
      <View style={S.taskRow}>
        <Text style={S.taskTitle}>{t.title}</Text>
        {t.due_date && <Text style={S.taskDate}>Échéance : {fmtDate(t.due_date)}</Text>}
      </View>
      {t.progress_note && (
        <Text style={S.taskNote}>Note : {t.progress_note}</Text>
      )}
      {t.description && (
        <Text style={S.taskDesc}>{t.description}</Text>
      )}
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

  const tachesEnCours  = taches.filter(t => t.status === 'en_cours')
  const tachesAFaire   = taches.filter(t => t.status === 'a_faire')
  const tachesTerminees = taches.filter(t => t.status === 'termine')

  const hasPeriod = !!(periodFrom || periodTo)
  const periodLabel = hasPeriod
    ? [periodFrom && `du ${fmtDate(periodFrom)}`, periodTo && `au ${fmtDate(periodTo)}`].filter(Boolean).join(' ')
    : null

  const footer = <Footer orgName={organization.name} title={chantier.title} />

  return (
    <Document>

      {/* ══════════════════════════════════════════════
          PAGE 1 : SYNTHÈSE + TÂCHES
      ══════════════════════════════════════════════ */}
      <Page size="A4" style={S.page}>

        {/* En-tête organisation */}
        <View style={S.header} fixed>
          <View>
            <Text style={S.orgName}>{organization.name}</Text>
            {organization.address_line1 && (
              <Text style={S.orgDetail}>{organization.address_line1}</Text>
            )}
            {(organization.postal_code || organization.city) && (
              <Text style={S.orgDetail}>
                {[organization.postal_code, organization.city].filter(Boolean).join(' ')}
              </Text>
            )}
            {organization.country && (
              <Text style={S.orgDetail}>{organization.country}</Text>
            )}
            {organization.siret && (
              <Text style={S.orgDetail}>SIRET {organization.siret}</Text>
            )}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 7.5, color: C.muted }}>Rapport généré le {today}</Text>
            {organization.phone && <Text style={S.orgDetail}>{organization.phone}</Text>}
            {organization.email && <Text style={S.orgDetail}>{organization.email}</Text>}
          </View>
        </View>

        {/* Bandeau titre */}
        <View style={S.banner}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={S.bannerTitle}>RAPPORT DE CHANTIER</Text>
            <Text style={S.bannerSub}>{chantier.title}</Text>
            {periodLabel && (
              <Text style={S.bannerPeriod}>Période : {periodLabel}</Text>
            )}
          </View>
          <View style={S.bannerRight}>
            <Text style={S.bannerStatus}>{STATUS_LABELS[chantier.status] ?? chantier.status}</Text>
            {chantier.client?.company_name && (
              <Text style={S.bannerClient}>{chantier.client.company_name}</Text>
            )}
          </View>
        </View>

        {/* Grille infos synthèse */}
        <View style={S.infoRow}>
          <View style={S.infoBlock}>
            <Text style={S.infoLabel}>Période des travaux</Text>
            <Text style={S.infoValue}>
              {fmtDate(chantier.start_date)} - {fmtDate(chantier.estimated_end_date)}
            </Text>
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
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
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
                {chantier.contact_email && <Text style={{ ...S.infoValue, color: C.accent }}>{chantier.contact_email}</Text>}
                {chantier.contact_phone && <Text style={S.infoValue}>{chantier.contact_phone}</Text>}
              </View>
            )}
          </View>
        )}

        {/* ── Tâches ── */}
        <SectionTitle>
          Tâches{taches.length > 0 ? ` (${taches.length})` : ''}
        </SectionTitle>

        {taches.length === 0 && (
          <Text style={{ fontSize: 8, color: C.light, fontStyle: 'italic', marginTop: 8 }}>
            Aucune tâche enregistrée pour ce chantier.
          </Text>
        )}

        {tachesEnCours.length > 0 && (
          <View>
            <View style={{ ...S.groupTitle, backgroundColor: C.blueBg, marginTop: 10 }} wrap={false}>
              <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.blue }}>
                En cours ({tachesEnCours.length})
              </Text>
            </View>
            {tachesEnCours.map(t => <TacheRow key={t.id} t={t} />)}
          </View>
        )}

        {tachesAFaire.length > 0 && (
          <View>
            <View style={{ ...S.groupTitle, backgroundColor: C.grayBg, marginTop: tachesEnCours.length > 0 ? 8 : 10 }} wrap={false}>
              <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.gray }}>
                À faire ({tachesAFaire.length})
              </Text>
            </View>
            {tachesAFaire.map(t => <TacheRow key={t.id} t={t} />)}
          </View>
        )}

        {tachesTerminees.length > 0 && (
          <View>
            <View style={{ ...S.groupTitle, backgroundColor: C.greenBg, marginTop: (tachesEnCours.length > 0 || tachesAFaire.length > 0) ? 8 : 10 }} wrap={false}>
              <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.green }}>
                Terminées ({tachesTerminees.length})
              </Text>
            </View>
            {tachesTerminees.map(t => <TacheRow key={t.id} t={t} />)}
          </View>
        )}

        {footer}
      </Page>

      {/* ══════════════════════════════════════════════
          PAGE POINTAGES
      ══════════════════════════════════════════════ */}
      {pointages.length > 0 && (
        <Page size="A4" style={S.page}>
          <SectionTitle>
            Pointages ({pointages.length} entrée{pointages.length > 1 ? 's' : ''} · {fmtHours(totalHours)} au total)
          </SectionTitle>

          <View style={{ marginTop: 8 }}>
            <View style={S.tableHeader}>
              <Text style={{ ...S.tableHeaderCell, width: 56 }}>Date</Text>
              <Text style={{ ...S.tableHeaderCell, flex: 1.2 }}>Collaborateur</Text>
              <Text style={{ ...S.tableHeaderCell, width: 44, textAlign: 'right' }}>Heures</Text>
              <Text style={{ ...S.tableHeaderCell, flex: 1 }}>Tâche</Text>
              <Text style={{ ...S.tableHeaderCell, flex: 2 }}>Description</Text>
            </View>

            {pointages.map((p, i) => (
              <View key={p.id} style={{ ...S.tableRow, backgroundColor: i % 2 === 0 ? C.white : C.bg }} wrap={false}>
                <Text style={{ ...S.tableMuted, width: 56 }}>{fmtDate(p.date)}</Text>
                <Text style={{ ...S.tableCell,  flex: 1.2 }}>{p.user_name}</Text>
                <Text style={{ ...S.tableMuted, width: 44, textAlign: 'right' }}>{fmtHours(p.hours)}</Text>
                <Text style={{ ...S.tableMuted, flex: 1 }}>{p.tache_title ?? '-'}</Text>
                <Text style={{ ...S.tableMuted, flex: 2 }}>{p.description ?? '-'}</Text>
              </View>
            ))}
          </View>

          {footer}
        </Page>
      )}

      {/* ══════════════════════════════════════════════
          PAGE JOURNAL
      ══════════════════════════════════════════════ */}
      {notes.length > 0 && (
        <Page size="A4" style={S.page}>
          <SectionTitle>
            Journal de chantier ({notes.length} entrée{notes.length > 1 ? 's' : ''})
          </SectionTitle>

          <View style={{ marginTop: 8 }}>
            {notes.map(n => (
              <View key={n.id} style={S.noteBlock} wrap={false}>
                <Text style={S.noteMeta}>
                  {n.author_name} · {new Date(n.created_at).toLocaleDateString('fr-FR', {
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
