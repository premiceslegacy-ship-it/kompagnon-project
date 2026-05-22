import React from 'react'
import { Document, Page, View, Text, Image } from '@react-pdf/renderer'
import { registerFonts, DS, pdfText } from '@/lib/pdf/pdf-design-system'
import { APP_NAME } from '@/lib/brand'
import type { Organization } from '@/lib/data/queries/organization'
import type { MonthlyReport, AnnualReport, HoursReport, TopClientEntry, TopChantierEntry, AnnualObjectives } from '@/lib/data/queries/reporting'

const MONTHS_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

function fmt(n: number): string {
  return pdfText(new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
    .format(n))
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)} %`
}

function fmtH(n: number): string {
  return `${n.toFixed(1)} h`
}

type Props = {
  vue: 'mois' | 'annee'
  year: number
  month: number
  organization: Organization & { logo_url: string | null }
  monthlyReport: MonthlyReport | null
  annualReport: AnnualReport | null
  hoursReport: HoursReport | null
  topClients: TopClientEntry[]
  topChantiers: TopChantierEntry[]
  objectives: AnnualObjectives | null
}

export default function RapportKpiPDF({
  vue, year, month, organization,
  monthlyReport, annualReport,
  hoursReport, topClients, topChantiers, objectives,
}: Props) {
  registerFonts()

  const titre = vue === 'mois'
    ? `Rapport ${MONTHS_FR[month - 1]} ${year}`
    : `Rapport Annuel ${year}`

  const S = {
    page: {
      fontFamily: DS.font.body,
      fontSize: DS.size.base,
      color: DS.color.body,
      backgroundColor: DS.color.white,
      paddingTop: DS.space.xxl,
      paddingBottom: 60,
      paddingHorizontal: DS.space.page,
    },
    header: {
      flexDirection: 'row' as const,
      justifyContent: 'space-between' as const,
      alignItems: 'flex-start' as const,
      marginBottom: DS.space.xl,
      paddingBottom: DS.space.xl,
      borderBottomWidth: 1,
      borderBottomColor: DS.color.divider,
    },
    orgName: { fontFamily: DS.font.heading, fontWeight: 800 as const, fontSize: DS.size.xl, color: DS.color.black },
    orgDetail: { fontSize: DS.size.xs, color: DS.color.secondary, marginTop: 2 },
    reportTitle: { fontFamily: DS.font.heading, fontWeight: 800 as const, fontSize: DS.size.xxxl, color: DS.color.black },
    reportSubtitle: { fontSize: DS.size.xs, color: DS.color.secondary, marginTop: 4 },
    sectionTitle: {
      fontFamily: DS.font.heading,
      fontWeight: 700 as const,
      fontSize: DS.size.xs,
      color: DS.color.black,
      marginBottom: DS.space.sm,
      marginTop: DS.space.xl,
      textTransform: 'uppercase' as const,
      letterSpacing: 1,
    },
    kpiRow: { flexDirection: 'row' as const, marginBottom: DS.space.md },
    kpiBox: { flex: 1, backgroundColor: DS.color.surface, borderRadius: 6, padding: DS.space.md, marginRight: DS.space.sm },
    kpiBoxLast: { flex: 1, backgroundColor: DS.color.surface, borderRadius: 6, padding: DS.space.md },
    kpiBoxAccent: { flex: 1, backgroundColor: DS.color.accent, borderRadius: 6, padding: DS.space.md, marginRight: DS.space.sm },
    kpiBoxAccentLast: { flex: 1, backgroundColor: DS.color.accent, borderRadius: 6, padding: DS.space.md },
    kpiLabel: { fontSize: DS.size.xxs, color: DS.color.secondary, textTransform: 'uppercase' as const, letterSpacing: 0.8, marginBottom: 5 },
    kpiLabelAccent: { fontSize: DS.size.xxs, color: DS.color.black, textTransform: 'uppercase' as const, letterSpacing: 0.8, marginBottom: 5 },
    kpiValue: { fontFamily: DS.font.heading, fontWeight: 700 as const, fontSize: DS.size.lg, color: DS.color.black },
    kpiSub: { fontSize: DS.size.xxs, color: DS.color.secondary, marginTop: 3 },
    kpiSubAccent: { fontSize: DS.size.xxs, color: DS.color.black, marginTop: 3 },
    divider: { height: 0.5, backgroundColor: DS.color.divider, marginVertical: DS.space.lg },
    tableHeader: {
      flexDirection: 'row' as const,
      backgroundColor: DS.color.black,
      paddingHorizontal: DS.space.sm,
      paddingVertical: 5,
      borderRadius: 4,
      marginBottom: 0,
    },
    thText: { fontSize: DS.size.xxs, color: DS.color.white, fontFamily: DS.font.heading, fontWeight: 700 as const, textTransform: 'uppercase' as const, letterSpacing: 0.8 },
    row: { flexDirection: 'row' as const, paddingHorizontal: DS.space.sm, paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: DS.color.divider },
    rowAlt: { flexDirection: 'row' as const, paddingHorizontal: DS.space.sm, paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: DS.color.divider, backgroundColor: DS.color.surface },
    cell: { fontSize: DS.size.xs, color: DS.color.body },
    cellBold: { fontSize: DS.size.xs, fontFamily: DS.font.heading, fontWeight: 700 as const, color: DS.color.black },
    progressBar: { height: 4, backgroundColor: DS.color.divider, borderRadius: 2, marginTop: 4 },
    progressFill: { height: 4, backgroundColor: DS.color.accent, borderRadius: 2 },
    footer: { position: 'absolute' as const, bottom: 24, left: DS.space.page, right: DS.space.page },
    footerText: { fontSize: DS.size.xxs, color: DS.color.secondary, textAlign: 'center' as const },
    pageNumber: { position: 'absolute' as const, bottom: 12, right: DS.space.page, fontSize: DS.size.xxs, color: DS.color.secondary },
  }

  const r = monthlyReport
  const ar = annualReport

  return (
    <Document title={`${titre} - ${organization.name}`} author={organization.name} creator={APP_NAME} language="fr-FR">
      <Page size="A4" style={S.page}>

        {/* En-tête */}
        <View style={S.header}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {organization.logo_url ? (
              <Image style={{ width: 44, height: 44, objectFit: 'contain', marginRight: DS.space.md }} src={organization.logo_url} />
            ) : (
              <View style={{ width: 44, height: 44, backgroundColor: DS.color.black, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: DS.space.md }}>
                <Text style={{ color: DS.color.white, fontFamily: DS.font.heading, fontWeight: 800, fontSize: DS.size.lg }}>
                  {organization.name.slice(0, 2).toUpperCase()}
                </Text>
              </View>
            )}
            <View>
              <Text style={S.orgName}>{pdfText(organization.name)}</Text>
              {organization.siret && <Text style={S.orgDetail}>SIRET : {organization.siret}</Text>}
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={S.reportTitle}>{titre}</Text>
            <Text style={S.reportSubtitle}>Généré le {new Date().toLocaleDateString('fr-FR')}</Text>
          </View>
        </View>

        {/* KPI principaux */}
        <Text style={S.sectionTitle}>Synthèse</Text>
        <View style={S.kpiRow}>
          <View style={S.kpiBoxAccent}>
            <Text style={S.kpiLabelAccent}>CA HT</Text>
            <Text style={[S.kpiValue, { color: DS.color.black }]}>{fmt(r?.caHt ?? ar?.caHt ?? 0)}</Text>
            <Text style={S.kpiSubAccent}>{fmt(r?.caTtc ?? ar?.caTtc ?? 0)} TTC</Text>
          </View>
          <View style={S.kpiBox}>
            <Text style={S.kpiLabel}>Encaissé</Text>
            <Text style={S.kpiValue}>{fmt(r?.encaisse ?? ar?.encaisse ?? 0)}</Text>
          </View>
          <View style={S.kpiBox}>
            <Text style={S.kpiLabel}>TVA collectée</Text>
            <Text style={S.kpiValue}>{fmt(r?.tvaDue ?? ar?.tvaDue ?? 0)}</Text>
          </View>
          <View style={S.kpiBoxLast}>
            <Text style={S.kpiLabel}>Bénéfice estimé</Text>
            <Text style={[S.kpiValue, { color: (r?.beneficeEstime ?? ar?.beneficeEstime ?? 0) >= 0 ? '#16A34A' : '#DC2626' }]}>
              {fmt(r?.beneficeEstime ?? ar?.beneficeEstime ?? 0)}
            </Text>
          </View>
        </View>
        <View style={[S.kpiRow, { marginBottom: 0 }]}>
          <View style={S.kpiBox}>
            <Text style={S.kpiLabel}>Chantiers terminés</Text>
            <Text style={S.kpiValue}>{String(r?.chantiersTermines ?? ar?.chantiersTermines ?? 0)}</Text>
          </View>
          {ar && (
            <View style={S.kpiBox}>
              <Text style={S.kpiLabel}>Nouveaux clients</Text>
              <Text style={S.kpiValue}>{String(ar.nouveauxClients)}</Text>
            </View>
          )}
          <View style={r ? S.kpiBox : S.kpiBoxLast}>
            <Text style={S.kpiLabel}>Heures travaillées</Text>
            <Text style={S.kpiValue}>{fmtH(hoursReport?.total ?? 0)}</Text>
          </View>
          {r && (
            <View style={S.kpiBoxLast}>
              <Text style={S.kpiLabel}>Factures émises</Text>
              <Text style={S.kpiValue}>{String(r.nouvellesFactures)}</Text>
              <Text style={S.kpiSub}>{r.facturesPayees} payée(s)</Text>
            </View>
          )}
        </View>

        {/* Objectifs */}
        {objectives && (objectives.revenue_ht_target || objectives.hours_target || objectives.chantiers_count_target) && (
          <>
            <Text style={S.sectionTitle}>Objectifs {year}</Text>
            {[
              objectives.revenue_ht_target && { label: 'CA HT', current: r?.caHt ?? ar?.caHt ?? 0, target: objectives.revenue_ht_target, format: fmt },
              objectives.chantiers_count_target && { label: 'Chantiers', current: r?.chantiersTermines ?? ar?.chantiersTermines ?? 0, target: objectives.chantiers_count_target, format: (n: number) => String(Math.round(n)) },
              objectives.hours_target && { label: 'Heures', current: hoursReport?.total ?? 0, target: objectives.hours_target, format: fmtH },
            ].filter(Boolean).map((obj, i) => {
              if (!obj) return null
              const pct = Math.min((obj.current / obj.target) * 100, 100)
              return (
                <View key={i} style={{ marginBottom: DS.space.sm }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: DS.size.xs, color: DS.color.body }}>{obj.label}</Text>
                    <Text style={{ fontSize: DS.size.xs, color: DS.color.secondary }}>{obj.format(obj.current)} / {obj.format(obj.target)}</Text>
                  </View>
                  <View style={S.progressBar}>
                    <View style={[S.progressFill, { width: `${pct}%` as any }]} />
                  </View>
                </View>
              )
            })}
          </>
        )}

        <View style={S.divider} />

        {/* Heures par personne */}
        {hoursReport && hoursReport.byPerson.length > 0 && (
          <>
            <Text style={S.sectionTitle}>Heures par personne</Text>
            <View style={S.tableHeader}>
              <View style={{ width: '60%' }}><Text style={S.thText}>Personne</Text></View>
              <View style={{ width: '20%', alignItems: 'flex-end' }}><Text style={S.thText}>Heures</Text></View>
              <View style={{ width: '20%', alignItems: 'flex-end' }}><Text style={S.thText}>%</Text></View>
            </View>
            {hoursReport.byPerson.map((p, i) => (
              <View key={i} style={i % 2 === 1 ? S.rowAlt : S.row} wrap={false}>
                <View style={{ width: '60%' }}><Text style={S.cell}>{pdfText(p.personName)}</Text></View>
                <View style={{ width: '20%', alignItems: 'flex-end' }}><Text style={S.cellBold}>{fmtH(p.hours)}</Text></View>
                <View style={{ width: '20%', alignItems: 'flex-end' }}><Text style={S.cell}>{((p.hours / hoursReport.total) * 100).toFixed(0)} %</Text></View>
              </View>
            ))}
          </>
        )}

        {/* Top clients */}
        {topClients.length > 0 && (
          <>
            <Text style={S.sectionTitle}>Top clients</Text>
            <View style={S.tableHeader}>
              <View style={{ width: '45%' }}><Text style={S.thText}>Client</Text></View>
              <View style={{ width: '25%', alignItems: 'flex-end' }}><Text style={S.thText}>CA HT</Text></View>
              <View style={{ width: '30%', alignItems: 'flex-end' }}><Text style={S.thText}>Marge</Text></View>
            </View>
            {topClients.slice(0, 8).map((c, i) => (
              <View key={c.clientId} style={i % 2 === 1 ? S.rowAlt : S.row} wrap={false}>
                <View style={{ width: '45%' }}><Text style={S.cell}>{pdfText(c.clientName)}</Text></View>
                <View style={{ width: '25%', alignItems: 'flex-end' }}><Text style={S.cellBold}>{fmt(c.caHt)}</Text></View>
                <View style={{ width: '30%', alignItems: 'flex-end' }}>
                  <Text style={[S.cell, { color: c.marginEur >= 0 ? '#16A34A' : '#DC2626' }]}>{fmt(c.marginEur)}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        {/* Top chantiers */}
        {topChantiers.length > 0 && (
          <>
            <Text style={S.sectionTitle}>Top chantiers</Text>
            <View style={S.tableHeader}>
              <View style={{ width: '42%' }}><Text style={S.thText}>Chantier</Text></View>
              <View style={{ width: '20%', alignItems: 'flex-end' }}><Text style={S.thText}>Facturé</Text></View>
              <View style={{ width: '20%', alignItems: 'flex-end' }}><Text style={S.thText}>Encaissé</Text></View>
              <View style={{ width: '18%', alignItems: 'flex-end' }}><Text style={S.thText}>Marge</Text></View>
            </View>
            {topChantiers.slice(0, 8).map((c, i) => (
              <View key={c.chantierId} style={i % 2 === 1 ? S.rowAlt : S.row} wrap={false}>
                <View style={{ width: '42%' }}><Text style={S.cell}>{pdfText(c.chantierTitle)}</Text></View>
                <View style={{ width: '20%', alignItems: 'flex-end' }}><Text style={S.cellBold}>{fmt(c.caHt)}</Text></View>
                <View style={{ width: '20%', alignItems: 'flex-end' }}><Text style={S.cellBold}>{fmt(c.encaisseHt)}</Text></View>
                <View style={{ width: '18%', alignItems: 'flex-end' }}>
                  <Text style={[S.cell, { color: c.marginEur >= 0 ? '#16A34A' : '#DC2626' }]}>{fmt(c.marginEur)}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        {/* Footer */}
        <View style={S.footer} fixed>
          <Text style={S.footerText}>{pdfText(organization.name)} - {titre} - {APP_NAME}</Text>
        </View>
        <Text style={S.pageNumber} render={({ pageNumber, totalPages }) => totalPages > 1 ? `${pageNumber} / ${totalPages}` : ''} fixed />

      </Page>
    </Document>
  )
}
