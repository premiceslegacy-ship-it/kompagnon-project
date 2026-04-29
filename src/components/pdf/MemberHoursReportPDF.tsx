import React from 'react'
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import { registerFonts, DS, fmtCurrency } from '@/lib/pdf/pdf-design-system'
import type { IndividualMember, MemberPointage } from '@/lib/data/queries/members'

registerFonts()

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '-'
  const part = iso.includes('T') ? iso.split('T')[0] : iso
  const [y, m, d] = part.split('-')
  return `${(d ?? '').padStart(2, '0')}/${(m ?? '').padStart(2, '0')}/${y ?? ''}`
}

const fmtHours = (hours: number): string => {
  const h = Math.floor(hours)
  const min = Math.round((hours - h) * 60)
  return min === 0 ? `${h}h` : `${h}h${String(min).padStart(2, '0')}`
}


export type MemberHoursReportPDFProps = {
  member: IndividualMember
  organization: {
    name: string
    logo_url?: string | null
    address_line1?: string | null
    postal_code?: string | null
    city?: string | null
  }
  pointages: MemberPointage[]
  periodFrom: string
  periodTo: string
  totalHours: number
}

const S = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 48,
    paddingHorizontal: 36,
    fontFamily: DS.font.body,
    fontSize: 10,
    color: DS.color.black,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: DS.color.divider,
  },
  orgBlock: { flexDirection: 'column' },
  orgName: { fontFamily: DS.font.body, fontSize: 14, fontWeight: 700, color: DS.color.black },
  orgAddress: { fontFamily: DS.font.body, fontSize: 9, color: DS.color.secondary, marginTop: 2 },
  reportLabel: { fontFamily: DS.font.body, fontSize: 9, color: DS.color.secondary, textTransform: 'uppercase', letterSpacing: 1 },
  reportTitle: { fontFamily: DS.font.body, fontSize: 18, fontWeight: 700, marginTop: 4, color: DS.color.black },
  reportPeriod: { fontFamily: DS.font.body, fontSize: 10, color: DS.color.secondary, marginTop: 2 },
  section: { marginBottom: 18 },
  sectionTitle: {
    fontFamily: DS.font.body,
    fontSize: 11,
    fontWeight: 700,
    color: DS.color.black,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  memberRow: { flexDirection: 'row', marginBottom: 4 },
  memberLabel: { fontFamily: DS.font.body, width: 80, fontSize: 10, color: DS.color.secondary },
  memberValue: { fontFamily: DS.font.body, fontSize: 10, color: DS.color.black },
  table: { borderWidth: 1, borderColor: DS.color.divider, borderRadius: 4 },
  tr: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: DS.color.divider,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  trLast: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  th: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: DS.color.divider,
  },
  thCell: { fontFamily: DS.font.body, fontSize: 9, fontWeight: 700, color: DS.color.secondary, textTransform: 'uppercase' },
  cellDate:    { fontFamily: DS.font.body, width: 70 },
  cellChantier:{ fontFamily: DS.font.body, flex: 1 },
  cellTache:   { fontFamily: DS.font.body, flex: 1 },
  cellStart:   { fontFamily: DS.font.body, width: 60, textAlign: 'right' },
  cellHours:   { fontFamily: DS.font.body, width: 60, textAlign: 'right' },
  totalsBox: {
    marginTop: 18,
    backgroundColor: '#f9fafb',
    padding: 12,
    borderRadius: 4,
    borderLeftWidth: 3,
    borderLeftColor: DS.color.accent,
  },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  totalsLabel: { fontFamily: DS.font.body, fontSize: 10, color: DS.color.secondary },
  totalsValue: { fontFamily: DS.font.body, fontSize: 11, fontWeight: 700, color: DS.color.black },
  totalsHours: { fontFamily: DS.font.body, fontSize: 16, fontWeight: 700, color: DS.color.black },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 36,
    right: 36,
    textAlign: 'center',
    fontFamily: DS.font.body,
    fontSize: 8,
    color: DS.color.secondary,
  },
  emptyState: {
    padding: 18,
    textAlign: 'center',
    fontFamily: DS.font.body,
    fontSize: 10,
    color: DS.color.secondary,
  },
})

export default function MemberHoursReportPDF({
  member,
  organization,
  pointages,
  periodFrom,
  periodTo,
  totalHours,
}: MemberHoursReportPDFProps) {
  const memberFullName = [member.prenom, member.name].filter(Boolean).join(' ')
  const tauxHoraire = member.taux_horaire ?? null
  const totalCost = tauxHoraire ? totalHours * tauxHoraire : null

  // Group by date
  const byDate = pointages.reduce<Record<string, MemberPointage[]>>((acc, p) => {
    if (!acc[p.date]) acc[p.date] = []
    acc[p.date].push(p)
    return acc
  }, {})
  const sortedDates = Object.keys(byDate).sort()

  return (
    <Document>
      <Page size="A4" style={S.page}>
        {/* Header */}
        <View style={S.header}>
          <View style={S.orgBlock}>
            <Text style={S.orgName}>{organization.name}</Text>
            {(organization.address_line1 || organization.city) && (
              <Text style={S.orgAddress}>
                {[organization.address_line1, [organization.postal_code, organization.city].filter(Boolean).join(' ')]
                  .filter(Boolean)
                  .join(' — ')}
              </Text>
            )}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={S.reportLabel}>Rapport d'heures</Text>
            <Text style={S.reportTitle}>{memberFullName}</Text>
            <Text style={S.reportPeriod}>
              Du {fmtDate(periodFrom)} au {fmtDate(periodTo)}
            </Text>
          </View>
        </View>

        {/* Member info */}
        <View style={S.section}>
          <Text style={S.sectionTitle}>Intervenant</Text>
          <View style={S.memberRow}>
            <Text style={S.memberLabel}>Nom</Text>
            <Text style={S.memberValue}>{memberFullName || '—'}</Text>
          </View>
          {member.email && (
            <View style={S.memberRow}>
              <Text style={S.memberLabel}>Email</Text>
              <Text style={S.memberValue}>{member.email}</Text>
            </View>
          )}
          {member.role_label && (
            <View style={S.memberRow}>
              <Text style={S.memberLabel}>Rôle</Text>
              <Text style={S.memberValue}>{member.role_label}</Text>
            </View>
          )}
          {tauxHoraire != null && (
            <View style={S.memberRow}>
              <Text style={S.memberLabel}>Taux horaire</Text>
              <Text style={S.memberValue}>{fmtCurrency(tauxHoraire)} / h</Text>
            </View>
          )}
        </View>

        {/* Pointages table */}
        <View style={S.section}>
          <Text style={S.sectionTitle}>Détail des heures pointées</Text>

          {pointages.length === 0 ? (
            <View style={S.table}>
              <Text style={S.emptyState}>Aucune heure pointée sur la période.</Text>
            </View>
          ) : (
            <View style={S.table}>
              <View style={S.th}>
                <Text style={[S.thCell, S.cellDate]}>Date</Text>
                <Text style={[S.thCell, S.cellChantier]}>Chantier</Text>
                <Text style={[S.thCell, S.cellTache]}>Tâche</Text>
                <Text style={[S.thCell, S.cellStart]}>Début</Text>
                <Text style={[S.thCell, S.cellHours]}>Heures</Text>
              </View>

              {sortedDates.map((date, dIdx) => {
                const rows = byDate[date]
                return rows.map((p, idx) => {
                  const isLastOfReport = dIdx === sortedDates.length - 1 && idx === rows.length - 1
                  return (
                    <View key={p.id} style={isLastOfReport ? S.trLast : S.tr}>
                      <Text style={S.cellDate}>{idx === 0 ? fmtDate(date) : ''}</Text>
                      <Text style={S.cellChantier}>{p.chantier_title}</Text>
                      <Text style={S.cellTache}>{p.tache_title ?? '—'}</Text>
                      <Text style={S.cellStart}>{p.start_time ?? '—'}</Text>
                      <Text style={S.cellHours}>{fmtHours(p.hours)}</Text>
                    </View>
                  )
                })
              })}
            </View>
          )}
        </View>

        {/* Totals */}
        <View style={S.totalsBox}>
          <View style={S.totalsRow}>
            <Text style={S.totalsLabel}>Total heures de la période</Text>
            <Text style={S.totalsHours}>{fmtHours(totalHours)}</Text>
          </View>
          {totalCost != null && (
            <View style={S.totalsRow}>
              <Text style={S.totalsLabel}>Coût main-d'œuvre estimé</Text>
              <Text style={S.totalsValue}>{fmtCurrency(totalCost)}</Text>
            </View>
          )}
        </View>

        <Text style={S.footer} fixed>
          Rapport généré par {organization.name} — Document à conserver pour vos archives.
        </Text>
      </Page>
    </Document>
  )
}
