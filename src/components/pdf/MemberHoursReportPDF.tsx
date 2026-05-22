import React from 'react'
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import { registerFonts, DS, fmtCurrency, pdfText } from '@/lib/pdf/pdf-design-system'
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
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
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
  isAppMember?: boolean
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
  cellDate:    { fontFamily: DS.font.body, width: 64 },
  cellChantier:{ fontFamily: DS.font.body, flex: 1 },
  cellTache:   { fontFamily: DS.font.body, flex: 1 },
  cellStart:   { fontFamily: DS.font.body, width: 46, textAlign: 'right' },
  cellRate:    { fontFamily: DS.font.body, width: 58, textAlign: 'right' },
  cellHours:   { fontFamily: DS.font.body, width: 50, textAlign: 'right' },
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
  rateBreakTitle: {
    fontFamily: DS.font.body,
    fontSize: 9,
    fontWeight: 700,
    color: DS.color.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 10,
    marginBottom: 4,
  },
  rateBreakRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 3,
    backgroundColor: '#f3f4f6',
    marginBottom: 2,
  },
  rateBreakLabel: { fontFamily: DS.font.body, fontSize: 9, color: DS.color.secondary },
  rateBreakValue: { fontFamily: DS.font.body, fontSize: 9, fontWeight: 700, color: DS.color.black },
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
  isAppMember = false,
}: MemberHoursReportPDFProps) {
  const memberFullName = [member.prenom, member.name].filter(Boolean).join(' ')

  // Détecter vue annuelle : from = YYYY-01-01 et to = YYYY-12-31
  const isAnnual = periodFrom.endsWith('-01-01') && periodTo.endsWith('-12-31')
    && periodFrom.slice(0, 4) === periodTo.slice(0, 4)
  const annualYear = isAnnual ? periodFrom.slice(0, 4) : null

  // Ventilation par tranche de taux horaire
  // Si rate_snapshot est null, on utilise member.taux_horaire comme fallback
  const fallbackRate = member.taux_horaire ?? null
  type RateSlice = { rate: number | null; hours: number; cost: number }
  const rateMap = new Map<string, RateSlice>()
  for (const p of pointages) {
    const effectiveRate = p.rate_snapshot ?? fallbackRate
    const key = effectiveRate != null ? String(effectiveRate) : '__none__'
    const existing = rateMap.get(key)
    const cost = effectiveRate != null ? p.hours * effectiveRate : 0
    if (existing) {
      existing.hours += p.hours
      existing.cost += cost
    } else {
      rateMap.set(key, { rate: effectiveRate, hours: p.hours, cost })
    }
  }
  const rateSlices: RateSlice[] = Array.from(rateMap.values()).sort((a, b) =>
    (a.rate ?? -1) - (b.rate ?? -1)
  )
  const totalCost = rateSlices.reduce((s, r) => s + r.cost, 0)
  const hasRateData = rateSlices.some(r => r.rate != null)

  // Regrouper par chantier : sommer les heures, prendre le taux dominant (le plus fréquent)
  type ChantierRow = { chantier_id: string; chantier_title: string; hours: number; rate: number | null }
  const chantierMap = new Map<string, ChantierRow>()
  const chantierRateCount = new Map<string, Map<string, number>>()
  for (const p of pointages) {
    const effectiveRateC = p.rate_snapshot ?? fallbackRate
    const existing = chantierMap.get(p.chantier_id)
    if (existing) {
      existing.hours += p.hours
    } else {
      chantierMap.set(p.chantier_id, {
        chantier_id: p.chantier_id,
        chantier_title: p.chantier_title,
        hours: p.hours,
        rate: effectiveRateC,
      })
    }
    // Compter les taux pour choisir le dominant
    const rateKey = effectiveRateC != null ? String(effectiveRateC) : '__none__'
    if (!chantierRateCount.has(p.chantier_id)) chantierRateCount.set(p.chantier_id, new Map())
    const counts = chantierRateCount.get(p.chantier_id)!
    counts.set(rateKey, (counts.get(rateKey) ?? 0) + 1)
  }
  // Résoudre le taux dominant par chantier
  for (const [cid, row] of chantierMap) {
    const counts = chantierRateCount.get(cid)
    if (counts) {
      let bestKey = '__none__'; let bestCount = 0
      for (const [k, c] of counts) { if (c > bestCount) { bestCount = c; bestKey = k } }
      row.rate = bestKey !== '__none__' ? Number(bestKey) : null
    }
  }
  const chantierRows = Array.from(chantierMap.values()).sort((a, b) =>
    a.chantier_title.localeCompare(b.chantier_title, 'fr')
  )
  const showRateCol = chantierRows.some(r => r.rate != null)

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
                  .join(' - ')}
              </Text>
            )}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={S.reportLabel}>{isAnnual ? 'Rapport annuel' : "Rapport d'heures"}</Text>
            <Text style={S.reportTitle}>{pdfText(memberFullName)}</Text>
            <Text style={S.reportPeriod}>
              {isAnnual ? `Année ${annualYear}` : `Du ${fmtDate(periodFrom)} au ${fmtDate(periodTo)}`}
            </Text>
          </View>
        </View>

        {/* Member info */}
        <View style={S.section}>
          <Text style={S.sectionTitle}>{isAppMember ? 'Membre' : 'Intervenant'}</Text>
          <View style={S.memberRow}>
            <Text style={S.memberLabel}>Nom</Text>
            <Text style={S.memberValue}>{pdfText(memberFullName) || '-'}</Text>
          </View>
          {member.email && (
            <View style={S.memberRow}>
              <Text style={S.memberLabel}>Email</Text>
              <Text style={S.memberValue}>{pdfText(member.email)}</Text>
            </View>
          )}
          {member.role_label && (
            <View style={S.memberRow}>
              <Text style={S.memberLabel}>Rôle</Text>
              <Text style={S.memberValue}>{pdfText(member.role_label)}</Text>
            </View>
          )}
        </View>

        {/* Pointages table */}
        <View style={S.section}>
          <Text style={S.sectionTitle}>Détail des heures pointées</Text>

          {chantierRows.length === 0 ? (
            <View style={S.table}>
              <Text style={S.emptyState}>Aucune heure pointée sur la période.</Text>
            </View>
          ) : (
            <View style={S.table}>
              <View style={S.th}>
                <Text style={[S.thCell, S.cellChantier]}>Chantier</Text>
                {showRateCol && <Text style={[S.thCell, S.cellRate]}>Taux</Text>}
                <Text style={[S.thCell, S.cellHours]}>Heures</Text>
              </View>
              {chantierRows.map((row, idx) => (
                <View key={row.chantier_id} style={idx === chantierRows.length - 1 ? S.trLast : S.tr}>
                  <Text style={S.cellChantier}>{pdfText(row.chantier_title)}</Text>
                  {showRateCol && (
                    <Text style={S.cellRate}>
                      {row.rate != null ? `${row.rate} EUR/h` : '-'}
                    </Text>
                  )}
                  <Text style={S.cellHours}>{fmtHours(row.hours)}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Totals + ventilation par taux */}
        <View style={S.totalsBox}>
          <View style={S.totalsRow}>
            <Text style={S.totalsLabel}>Total heures de la période</Text>
            <Text style={S.totalsHours}>{fmtHours(totalHours)}</Text>
          </View>
          {hasRateData && (
            <View style={S.totalsRow}>
              <Text style={S.totalsLabel}>Coût main-d'oeuvre total</Text>
              <Text style={S.totalsValue}>{fmtCurrency(totalCost)}</Text>
            </View>
          )}

          {rateSlices.length > 1 && (
            <>
              <Text style={S.rateBreakTitle}>Ventilation par taux horaire</Text>
              {rateSlices.map((slice, i) => (
                <View key={i} style={S.rateBreakRow}>
                  <Text style={S.rateBreakLabel}>
                    {slice.rate != null ? `${slice.rate} EUR/h` : 'Sans taux défini'}
                    {' - '}{fmtHours(slice.hours)}
                  </Text>
                  <Text style={S.rateBreakValue}>
                    {slice.rate != null ? fmtCurrency(slice.cost) : fmtHours(slice.hours)}
                  </Text>
                </View>
              ))}
            </>
          )}
        </View>

        <Text style={S.footer} fixed>
          Rapport généré par {pdfText(organization.name)} — Document à conserver pour vos archives.
        </Text>
      </Page>
    </Document>
  )
}
