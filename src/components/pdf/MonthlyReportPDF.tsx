import React from 'react'
import { Document, Page, View, Text, Image } from '@react-pdf/renderer'
import { registerFonts, DS } from '@/lib/pdf/pdf-design-system'
import { APP_NAME } from '@/lib/brand'
import type { Organization } from '@/lib/data/queries/organization'

export type ReportInvoice = {
  id: string
  number: string | null
  title: string | null
  status: string
  invoice_type: string
  total_ht: number
  total_tva: number
  total_ttc: number
  currency: string
  issue_date: string | null
  due_date: string | null
  created_at: string
  client_name: string | null
  items_internal_total: number
}

export type ReportQuote = {
  id: string
  number: string | null
  title: string | null
  status: string
  total_ht: number
  currency: string
  created_at: string
  client_name: string | null
}

export type MonthlyReportData = {
  month: string // YYYY-MM
  organization: Organization & { logo_url: string | null }
  invoices: ReportInvoice[]
  quotes: ReportQuote[]
}

const MONTHS_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTHS_FR[m - 1]} ${y}`
}

function fmt(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 2 })
    .format(amount)
    .replace(/[   ]/g, ' ')
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon', sent: 'Envoyée', paid: 'Payée', cancelled: 'Annulée',
}
const QUOTE_STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon', sent: 'Envoyé', viewed: 'Consulté',
  accepted: 'Accepté', refused: 'Refusé', expired: 'Expiré', converted: 'Converti',
}

export default function MonthlyReportPDF({ data }: { data: MonthlyReportData }) {
  registerFonts()

  const { organization, invoices, quotes, month } = data
  const isVatSubject = organization.is_vat_subject
  const currency = invoices[0]?.currency ?? quotes[0]?.currency ?? 'EUR'

  // ── Agrégats factures ─────────────────────────────────────────────────────
  const sentPaid = invoices.filter(inv => ['sent', 'paid'].includes(inv.status))
  const caHt = sentPaid.reduce((s, inv) => s + inv.total_ht, 0)
  const encaisseHt = invoices.filter(inv => inv.status === 'paid').reduce((s, inv) => s + inv.total_ht, 0)
  const encaisseTtc = invoices.filter(inv => inv.status === 'paid').reduce((s, inv) => s + inv.total_ttc, 0)
  const resteHt = invoices.filter(inv => inv.status === 'sent').reduce((s, inv) => s + inv.total_ht, 0)
  const totalInternalCost = invoices.reduce((s, inv) => s + inv.items_internal_total, 0)
  const margeHt = caHt - totalInternalCost
  const margePct = caHt > 0 ? Math.round((margeHt / caHt) * 100) : 0

  // TVA collectée par taux
  const tvaTotale = sentPaid.reduce((s, inv) => s + inv.total_tva, 0)

  // ── Agrégats devis ────────────────────────────────────────────────────────
  const qEmis = quotes.length
  const qAccepted = quotes.filter(q => q.status === 'accepted').length
  const qAcceptedHt = quotes.filter(q => q.status === 'accepted').reduce((s, q) => s + q.total_ht, 0)
  const qConvRate = qEmis > 0 ? Math.round((qAccepted / qEmis) * 100) : 0

  const S = {
    page: { fontFamily: DS.font.body, fontSize: DS.size.base, color: DS.color.body, backgroundColor: DS.color.white, paddingTop: DS.space.xxl, paddingBottom: 60, paddingHorizontal: DS.space.page },
    header: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'flex-start' as const, marginBottom: DS.space.xl, paddingBottom: DS.space.xl, borderBottomWidth: 1, borderBottomColor: DS.color.divider },
    logo: { width: 48, height: 48, objectFit: 'contain' as const },
    logoPlaceholder: { width: 48, height: 48, backgroundColor: DS.color.black, borderRadius: 8, alignItems: 'center' as const, justifyContent: 'center' as const },
    logoPlaceholderText: { color: DS.color.white, fontFamily: DS.font.heading, fontWeight: 800, fontSize: DS.size.lg },
    orgName: { fontFamily: DS.font.heading, fontWeight: 800, fontSize: DS.size.xl, color: DS.color.black },
    orgDetail: { fontSize: DS.size.xs, color: DS.color.secondary, marginTop: 3 },
    reportTitle: { fontFamily: DS.font.heading, fontWeight: 800, fontSize: DS.size.xxxl, color: DS.color.black },
    reportSubtitle: { fontSize: DS.size.sm, color: DS.color.secondary, marginTop: 4 },
    sectionTitle: { fontFamily: DS.font.heading, fontWeight: 700, fontSize: DS.size.sm, color: DS.color.black, marginBottom: DS.space.sm, marginTop: DS.space.xl, textTransform: 'uppercase' as const, letterSpacing: 1 },
    // KPI : pas de gap natif fiable — on utilise marginRight sur chaque box sauf le dernier
    kpiRow: { flexDirection: 'row' as const, marginBottom: DS.space.md },
    kpiBox: { flex: 1, backgroundColor: DS.color.surface, borderRadius: 6, padding: DS.space.md, marginRight: DS.space.sm },
    kpiBoxLast: { flex: 1, backgroundColor: DS.color.surface, borderRadius: 6, padding: DS.space.md },
    kpiLabel: { fontSize: DS.size.xxs, color: DS.color.secondary, textTransform: 'uppercase' as const, letterSpacing: 0.8, marginBottom: 6 },
    kpiValue: { fontFamily: DS.font.heading, fontWeight: 700, fontSize: DS.size.xl, color: DS.color.black, lineHeight: 1.2 },
    kpiSub: { fontSize: DS.size.xxs, color: DS.color.secondary, marginTop: 4 },
    accentBox: { backgroundColor: DS.color.accent, borderRadius: 6, padding: DS.space.md, marginRight: DS.space.sm },
    accentBoxLast: { backgroundColor: DS.color.accent, borderRadius: 6, padding: DS.space.md },
    accentValue: { fontFamily: DS.font.heading, fontWeight: 700, fontSize: DS.size.xl, color: DS.color.black, lineHeight: 1.2 },
    // Table
    tableHeader: { flexDirection: 'row' as const, backgroundColor: DS.color.black, paddingHorizontal: DS.space.sm, paddingTop: 6, paddingBottom: 6, borderRadius: 4, marginBottom: 0 },
    thText: { fontSize: DS.size.xxs, color: DS.color.white, fontFamily: DS.font.heading, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.8 },
    row: { flexDirection: 'row' as const, paddingHorizontal: DS.space.sm, paddingTop: 7, paddingBottom: 7, borderBottomWidth: 0.5, borderBottomColor: DS.color.divider, alignItems: 'center' as const },
    rowAlt: { flexDirection: 'row' as const, paddingHorizontal: DS.space.sm, paddingTop: 7, paddingBottom: 7, borderBottomWidth: 0.5, borderBottomColor: DS.color.divider, backgroundColor: DS.color.surface, alignItems: 'center' as const },
    cell: { fontSize: DS.size.xs, color: DS.color.body, lineHeight: 1.4 },
    cellBold: { fontSize: DS.size.xs, fontFamily: DS.font.heading, fontWeight: 700, color: DS.color.black, lineHeight: 1.4 },
    footer: { position: 'absolute' as const, bottom: 24, left: DS.space.page, right: DS.space.page },
    footerText: { fontSize: DS.size.xxs, color: DS.color.secondary, textAlign: 'center' as const },
    pageNumber: { position: 'absolute' as const, bottom: 12, right: DS.space.page, fontSize: DS.size.xxs, color: DS.color.secondary },
    divider: { height: 0.5, backgroundColor: DS.color.divider, marginVertical: DS.space.lg },
    vatBox: { backgroundColor: DS.color.surface, borderRadius: 6, paddingHorizontal: DS.space.md, paddingVertical: DS.space.sm, marginTop: DS.space.sm },
    vatExempt: { fontSize: DS.size.sm, color: DS.color.secondary },
  }

  // ── Colonnes factures ────────────────────────────────────────────────────────
  // Avec TVA : 12+22+14+14+10+12+16 = 100%
  // Sans TVA : 12+28+16+18+  0+14+12 = 100%  (TVA absente, on redistribue)
  const INV_WITH_TVA = {
    num:    { w: '12%' as const },
    client: { w: '22%' as const },
    date:   { w: '14%' as const },
    ht:     { w: '14%' as const },
    tva:    { w: '10%' as const },
    ttc:    { w: '12%' as const },
    status: { w: '16%' as const },
  }
  const INV_NO_TVA = {
    num:    { w: '12%' as const },
    client: { w: '28%' as const },
    date:   { w: '16%' as const },
    ht:     { w: '18%' as const },
    tva:    { w: '0%'  as const },
    ttc:    { w: '14%' as const },
    status: { w: '12%' as const },
  }
  const IC = isVatSubject ? INV_WITH_TVA : INV_NO_TVA

  // ── Colonnes devis ────────────────────────────────────────────────────────
  // 12+28+22+16+14+8 = 100%
  const QC = {
    num:    { w: '12%' as const },
    title:  { w: '28%' as const },
    client: { w: '22%' as const },
    date:   { w: '14%' as const },
    ht:     { w: '16%' as const },
    status: { w: '8%'  as const },
  }

  // Styles communs aux cellules : View conteneur + Text intérieur
  const cellView  = (w: string, align: 'left' | 'right' | 'center' = 'left', pr = 4) =>
    ({ width: w, paddingRight: pr, paddingVertical: 1, alignItems: align === 'right' ? 'flex-end' as const : align === 'center' ? 'center' as const : 'flex-start' as const })
  const thView    = (w: string, align: 'left' | 'right' | 'center' = 'left') =>
    ({ width: w, paddingRight: 4, alignItems: align === 'right' ? 'flex-end' as const : align === 'center' ? 'center' as const : 'flex-start' as const })

  return (
    <Document title={`Rapport ${fmtMonth(month)} — ${organization.name}`} author={organization.name} creator={APP_NAME} language="fr-FR">
      <Page size="A4" style={S.page}>

        {/* ── En-tête ── */}
        <View style={S.header}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {organization.logo_url
              ? <Image style={[S.logo, { marginRight: DS.space.md }]} src={organization.logo_url} />
              : <View style={[S.logoPlaceholder, { marginRight: DS.space.md }]}><Text style={S.logoPlaceholderText}>{organization.name.slice(0, 2).toUpperCase()}</Text></View>
            }
            <View>
              <Text style={S.orgName}>{organization.name}</Text>
              {organization.siret && <Text style={S.orgDetail}>SIRET : {organization.siret}</Text>}
              {organization.email && <Text style={S.orgDetail}>{organization.email}</Text>}
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={S.reportTitle}>{fmtMonth(month)}</Text>
            <Text style={S.reportSubtitle}>Rapport mensuel — généré le {fmtDate(new Date().toISOString())}</Text>
          </View>
        </View>

        {/* ── KPI Factures ── */}
        <Text style={S.sectionTitle}>Synthèse facturation</Text>
        {(() => {
          const sentPaidCount = invoices.filter(i => ['sent', 'paid'].includes(i.status)).length
          const sentCount = invoices.filter(i => i.status === 'sent').length
          const hasMargin = totalInternalCost > 0
          return (
            <View style={S.kpiRow}>
              <View style={S.accentBox}>
                <Text style={S.kpiLabel}>CA émis HT</Text>
                <Text style={S.accentValue}>{fmt(caHt, currency)}</Text>
                <Text style={[S.kpiSub, { color: DS.color.black }]}>{sentPaidCount} facture{sentPaidCount > 1 ? 's' : ''}</Text>
              </View>
              <View style={S.kpiBox}>
                <Text style={S.kpiLabel}>Encaissé HT</Text>
                <Text style={S.kpiValue}>{fmt(encaisseHt, currency)}</Text>
                {isVatSubject && <Text style={S.kpiSub}>TTC : {fmt(encaisseTtc, currency)}</Text>}
              </View>
              <View style={hasMargin ? S.kpiBox : S.kpiBoxLast}>
                <Text style={S.kpiLabel}>Reste à recouvrer</Text>
                <Text style={[S.kpiValue, { color: resteHt > 0 ? DS.color.accent : DS.color.body }]}>{fmt(resteHt, currency)}</Text>
                <Text style={S.kpiSub}>{sentCount} facture{sentCount > 1 ? 's' : ''} en attente</Text>
              </View>
              {hasMargin && (
                <View style={S.kpiBoxLast}>
                  <Text style={S.kpiLabel}>Marge brute</Text>
                  <Text style={[S.kpiValue, { color: margePct >= 30 ? '#16A34A' : margePct >= 15 ? DS.color.accent : '#DC2626' }]}>{margePct}%</Text>
                  <Text style={S.kpiSub}>{fmt(margeHt, currency)} HT</Text>
                </View>
              )}
            </View>
          )
        })()}

        {/* ── TVA ── */}
        {isVatSubject ? (
          <View style={S.vatBox}>
            <Text style={[S.kpiLabel, { marginBottom: 6 }]}>TVA collectée</Text>
            <Text style={[S.kpiValue, { fontSize: DS.size.lg }]}>{fmt(tvaTotale, currency)}</Text>
            <Text style={S.kpiSub}>Sur {fmt(caHt, currency)} HT facturé</Text>
          </View>
        ) : (
          <View style={S.vatBox}>
            <Text style={S.vatExempt}>TVA non applicable — Art. 293B du CGI (franchise en base)</Text>
          </View>
        )}

        {/* ── KPI Devis ── */}
        <Text style={S.sectionTitle}>Synthèse devis</Text>
        <View style={[S.kpiRow, { marginBottom: DS.space.sm }]}>
          <View style={S.kpiBox}>
            <Text style={S.kpiLabel}>Devis émis</Text>
            <Text style={S.kpiValue}>{qEmis}</Text>
          </View>
          <View style={S.kpiBox}>
            <Text style={S.kpiLabel}>Acceptés</Text>
            <Text style={S.kpiValue}>{qAccepted}</Text>
            <Text style={S.kpiSub}>{fmt(qAcceptedHt, currency)} HT</Text>
          </View>
          <View style={S.accentBoxLast}>
            <Text style={S.kpiLabel}>Taux de conversion</Text>
            <Text style={S.accentValue}>{qConvRate}%</Text>
          </View>
        </View>

        <View style={S.divider} />

        {/* ── Tableau factures ── */}
        {invoices.length > 0 && (
          <>
            <Text style={S.sectionTitle}>Détail des factures</Text>

            {/* Header */}
            <View style={S.tableHeader}>
              <View style={thView(IC.num.w)}>
                <Text style={S.thText}>N°</Text>
              </View>
              <View style={thView(IC.client.w)}>
                <Text style={S.thText}>Client</Text>
              </View>
              <View style={thView(IC.date.w)}>
                <Text style={S.thText}>Date</Text>
              </View>
              <View style={thView(IC.ht.w, 'right')}>
                <Text style={S.thText}>HT</Text>
              </View>
              {isVatSubject && (
                <View style={thView(IC.tva.w, 'right')}>
                  <Text style={S.thText}>TVA</Text>
                </View>
              )}
              <View style={thView(IC.ttc.w, 'right')}>
                <Text style={S.thText}>TTC</Text>
              </View>
              <View style={thView(IC.status.w, 'right')}>
                <Text style={S.thText}>Statut</Text>
              </View>
            </View>

            {/* Lignes */}
            {invoices.map((inv, i) => (
              <View key={inv.id} style={i % 2 === 1 ? S.rowAlt : S.row} wrap={false}>
                <View style={cellView(IC.num.w)}>
                  <Text style={S.cell}>{inv.number ?? '—'}</Text>
                </View>
                <View style={cellView(IC.client.w)}>
                  <Text style={S.cell}>{inv.client_name ?? '—'}</Text>
                </View>
                <View style={cellView(IC.date.w)}>
                  <Text style={S.cell}>{fmtDate(inv.issue_date ?? inv.created_at)}</Text>
                </View>
                <View style={cellView(IC.ht.w, 'right')}>
                  <Text style={S.cellBold}>{fmt(inv.total_ht, inv.currency)}</Text>
                </View>
                {isVatSubject && (
                  <View style={cellView(IC.tva.w, 'right')}>
                    <Text style={S.cell}>{fmt(inv.total_tva, inv.currency)}</Text>
                  </View>
                )}
                <View style={cellView(IC.ttc.w, 'right')}>
                  <Text style={S.cell}>{fmt(inv.total_ttc, inv.currency)}</Text>
                </View>
                <View style={cellView(IC.status.w, 'right', 0)}>
                  <Text style={S.cell}>{STATUS_LABELS[inv.status] ?? inv.status}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        {/* ── Tableau devis ── */}
        {quotes.length > 0 && (
          <>
            <Text style={[S.sectionTitle, { marginTop: DS.space.xl }]}>Détail des devis</Text>

            {/* Header */}
            <View style={S.tableHeader}>
              <View style={thView(QC.num.w)}>
                <Text style={S.thText}>N°</Text>
              </View>
              <View style={thView(QC.title.w)}>
                <Text style={S.thText}>Titre</Text>
              </View>
              <View style={thView(QC.client.w)}>
                <Text style={S.thText}>Client</Text>
              </View>
              <View style={thView(QC.date.w)}>
                <Text style={S.thText}>Date</Text>
              </View>
              <View style={thView(QC.ht.w, 'right')}>
                <Text style={S.thText}>HT</Text>
              </View>
              <View style={thView(QC.status.w, 'right')}>
                <Text style={S.thText}>Statut</Text>
              </View>
            </View>

            {/* Lignes */}
            {quotes.map((q, i) => (
              <View key={q.id} style={i % 2 === 1 ? S.rowAlt : S.row} wrap={false}>
                <View style={cellView(QC.num.w)}>
                  <Text style={S.cell}>{q.number ?? '—'}</Text>
                </View>
                <View style={cellView(QC.title.w)}>
                  <Text style={S.cell}>{q.title ?? 'Sans titre'}</Text>
                </View>
                <View style={cellView(QC.client.w)}>
                  <Text style={[S.cell, { color: DS.color.secondary }]}>{q.client_name ?? '—'}</Text>
                </View>
                <View style={cellView(QC.date.w)}>
                  <Text style={S.cell}>{fmtDate(q.created_at)}</Text>
                </View>
                <View style={cellView(QC.ht.w, 'right')}>
                  <Text style={S.cellBold}>{fmt(q.total_ht, q.currency)}</Text>
                </View>
                <View style={cellView(QC.status.w, 'right', 0)}>
                  <Text style={S.cell}>{QUOTE_STATUS_LABELS[q.status] ?? q.status}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        {/* ── Footer ── */}
        <View style={S.footer} fixed>
          <Text style={S.footerText}>{organization.name} — Rapport {fmtMonth(month)} — {APP_NAME}</Text>
        </View>
        <Text style={S.pageNumber} render={({ pageNumber, totalPages }) => totalPages > 1 ? `${pageNumber} / ${totalPages}` : ''} fixed />

      </Page>
    </Document>
  )
}
