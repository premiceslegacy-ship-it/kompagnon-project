import React from 'react'
import {
  Document, Page, View, Text, Image, StyleSheet,
} from '@react-pdf/renderer'
import type { Organization } from '@/lib/data/queries/organization'
import type { QuoteWithItems } from '@/lib/data/queries/quotes'
import type { Client } from '@/lib/data/queries/clients'
import { APP_NAME } from '@/lib/brand'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number, currency = 'EUR') =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 2 })
    .format(n)
    .replace(/\u202F/g, ' ')

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })

function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

function clientDisplayName(client: Client): string {
  return client.company_name || [client.first_name, client.last_name].filter(Boolean).join(' ') || client.email || ''
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type QuotePDFProps = {
  quote: QuoteWithItems & { notes_client?: string | null; payment_conditions?: string | null }
  organization: Organization
  client: Client | null
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(accent: string) {
  return StyleSheet.create({
    page: {
      fontFamily: 'Helvetica',
      fontSize: 9,
      color: '#1a1a1a',
      backgroundColor: '#ffffff',
      paddingTop: 40,
      paddingBottom: 50,
      paddingHorizontal: 45,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 28,
      paddingBottom: 20,
      borderBottomWidth: 2,
      borderBottomColor: accent,
    },
    logo: { width: 80, height: 40, objectFit: 'contain' },
    logoPlaceholder: {
      width: 80, height: 40,
      backgroundColor: accent,
      borderRadius: 6,
      justifyContent: 'center',
      alignItems: 'center',
    },
    logoPlaceholderText: { color: '#ffffff', fontFamily: 'Helvetica-Bold', fontSize: 14 },
    companyBlock: { alignItems: 'flex-end', maxWidth: 200 },
    companyName: { fontFamily: 'Helvetica-Bold', fontSize: 13, color: '#1a1a1a', marginBottom: 3 },
    companyDetail: { fontSize: 8, color: '#666', textAlign: 'right', marginBottom: 1 },
    titleBanner: {
      backgroundColor: accent,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 6,
      marginBottom: 20,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    titleText: { fontFamily: 'Helvetica-Bold', fontSize: 14, color: '#ffffff' },
    titleMeta: { fontSize: 8, color: 'rgba(255,255,255,0.85)', textAlign: 'right' },
    addressRow: { flexDirection: 'row', gap: 16, marginBottom: 20 },
    addressBlock: { flex: 1, padding: 12, backgroundColor: '#f8f8f8', borderRadius: 6 },
    addressLabel: {
      fontFamily: 'Helvetica-Bold',
      fontSize: 7,
      color: '#999',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginBottom: 5,
    },
    addressName: { fontFamily: 'Helvetica-Bold', fontSize: 10, color: '#1a1a1a', marginBottom: 3 },
    addressLine: { fontSize: 8, color: '#555', marginBottom: 1.5 },
    introBox: {
      marginBottom: 18,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderLeftWidth: 3,
      borderLeftColor: accent,
      backgroundColor: '#fafafa',
    },
    introText: { fontSize: 8.5, color: '#444', lineHeight: 1.5 },
    clientRequestBox: {
      marginBottom: 18,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderWidth: 1,
      borderColor: '#e2e8f0',
      borderRadius: 6,
      backgroundColor: '#f8fafc',
    },
    clientRequestLabel: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5 },
    clientRequestText: { fontSize: 8.5, color: '#334155', lineHeight: 1.6 },
    tableHeader: {
      flexDirection: 'row',
      backgroundColor: accent,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 4,
      marginBottom: 2,
    },
    tableHeaderText: {
      fontFamily: 'Helvetica-Bold',
      fontSize: 7.5,
      color: '#ffffff',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    sectionRow: {
      flexDirection: 'row',
      backgroundColor: '#f0f0f0',
      paddingHorizontal: 10,
      paddingVertical: 5,
      marginTop: 6,
      marginBottom: 1,
      borderRadius: 3,
    },
    sectionTitle: { fontFamily: 'Helvetica-Bold', fontSize: 8, color: '#333' },
    itemRow: {
      flexDirection: 'row',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderBottomWidth: 0.5,
      borderBottomColor: '#e8e8e8',
    },
    itemRowAlt: { backgroundColor: '#fbfbfb' },
    itemText: { fontSize: 8, color: '#333' },
    itemTextRight: { fontSize: 8, color: '#333', textAlign: 'right' },
    colDesc: { flex: 4 },
    colQty: { width: 35, textAlign: 'right' },
    colUnit: { width: 30, textAlign: 'center' },
    colPu: { width: 65, textAlign: 'right' },
    colVat: { width: 40, textAlign: 'right' },
    colTotal: { width: 70, textAlign: 'right' },
    totalsContainer: { marginTop: 16, alignItems: 'flex-end' },
    totalsBox: { width: 240 },
    totalsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 3,
      borderBottomWidth: 0.5,
      borderBottomColor: '#e8e8e8',
    },
    totalsLabel: { fontSize: 8.5, color: '#666' },
    totalsValue: { fontSize: 8.5, color: '#333', textAlign: 'right' },
    totalTtcRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 7,
      paddingHorizontal: 10,
      marginTop: 5,
      backgroundColor: accent,
      borderRadius: 4,
    },
    totalTtcLabel: { fontFamily: 'Helvetica-Bold', fontSize: 10, color: '#ffffff' },
    totalTtcValue: { fontFamily: 'Helvetica-Bold', fontSize: 10, color: '#ffffff' },
    vatExemptNotice: {
      fontSize: 7.5,
      color: '#888',
      fontStyle: 'italic',
      textAlign: 'right',
      marginTop: 3,
    },
    bottomSection: { marginTop: 24, flexDirection: 'row', gap: 16 },
    conditionsBox: { flex: 1 },
    conditionsTitle: { fontFamily: 'Helvetica-Bold', fontSize: 8, color: '#333', marginBottom: 4 },
    conditionsText: { fontSize: 7.5, color: '#555', lineHeight: 1.4 },
    signatureBox: {
      width: 180,
      borderWidth: 1,
      borderColor: '#ddd',
      borderRadius: 4,
      padding: 10,
      minHeight: 60,
      justifyContent: 'flex-end',
    },
    signatureLabel: { fontSize: 7, color: '#aaa', textAlign: 'center' },
    // Footer légal — position absolue, affiché uniquement sur la dernière page via render prop
    footer: {
      position: 'absolute',
      bottom: 22,
      left: 45,
      right: 45,
      borderTopWidth: 0.5,
      borderTopColor: '#ddd',
      paddingTop: 6,
    },
    footerText: { fontSize: 6.5, color: '#aaa', textAlign: 'center', lineHeight: 1.5 },
    pageNumber: { position: 'absolute', bottom: 22, right: 45, fontSize: 7, color: '#bbb' },
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function QuotePDF({ quote, organization, client }: QuotePDFProps) {
  const accent = organization.primary_color ?? '#6C63FF'
  const S = makeStyles(accent)

  // Franchise en base de TVA (art. 293B CGI)
  const isVatSubject = organization.is_vat_subject !== false
  // L'indemnité forfaitaire de 40 € (art. L441-10) est réservée aux relations B2B
  const isClientPro = client?.type === 'company'

  const visibleSections = quote.sections.map(s => ({
    ...s,
    items: s.items.filter(i => !i.is_internal),
  }))
  const visibleUnsectioned = quote.unsectionedItems.filter(i => !i.is_internal)

  const allItems = [
    ...visibleSections.flatMap(s => s.items),
    ...visibleUnsectioned,
  ]

  const totalHt = allItems.reduce((sum, i) => sum + i.quantity * i.unit_price, 0)

  const vatMap: Record<number, number> = {}
  if (isVatSubject) {
    for (const item of allItems) {
      const vatAmt = item.quantity * item.unit_price * (item.vat_rate / 100)
      vatMap[item.vat_rate] = (vatMap[item.vat_rate] ?? 0) + vatAmt
    }
  }
  const totalTva = Object.values(vatMap).reduce((s, v) => s + v, 0)
  const totalTtc = isVatSubject ? totalHt + totalTva : totalHt

  const validUntil = quote.valid_until
    ? quote.valid_until
    : addDays(quote.created_at, quote.validity_days ?? 30)

  // Mentions légales — apparaissent uniquement en bas de la dernière page
  const legalParts: string[] = []
  if (organization.forme_juridique) legalParts.push(organization.forme_juridique)
  if (organization.capital_social) legalParts.push(`Capital : ${organization.capital_social}`)
  if (organization.siret) legalParts.push(`SIRET : ${organization.siret}`)
  if (!isVatSubject) {
    legalParts.push('TVA non applicable, art. 293B du CGI')
  } else if (organization.vat_number) {
    legalParts.push(`TVA : ${organization.vat_number}`)
  }
  if (organization.rcs && organization.rcs_ville) legalParts.push(`RCS ${organization.rcs_ville} ${organization.rcs}`)
  else if (organization.rcs) legalParts.push(`RCS ${organization.rcs}`)
  if (organization.insurance_info) legalParts.push(`Assurance : ${organization.insurance_info}`)
  if (organization.certifications) legalParts.push(organization.certifications)
  const legalLine = legalParts.join('  ·  ') || organization.name

  const orgStreet = organization.address_line1 ?? null
  const orgPostalCity = [organization.postal_code, organization.city].filter(Boolean).join(' ') || null
  const orgCountry = organization.country ?? null

  return (
    <Document
      title={`Devis ${quote.number ?? ''} - ${organization.name}`}
      author={organization.name}
      creator={APP_NAME}
    >
      <Page size="A4" style={S.page}>

        {/* ── Header ── */}
        <View style={S.header}>
          <View>
            {organization.logo_url ? (
              <Image style={S.logo} src={organization.logo_url} />
            ) : (
              <View style={S.logoPlaceholder}>
                <Text style={S.logoPlaceholderText}>
                  {organization.name.slice(0, 2).toUpperCase()}
                </Text>
              </View>
            )}
          </View>
          <View style={S.companyBlock}>
            <Text style={S.companyName}>{organization.name}</Text>
            {orgStreet && <Text style={S.companyDetail}>{orgStreet}</Text>}
            {orgPostalCity && <Text style={S.companyDetail}>{orgPostalCity}</Text>}
            {orgCountry && <Text style={S.companyDetail}>{orgCountry}</Text>}
            {organization.phone && <Text style={S.companyDetail}>Tél : {organization.phone}</Text>}
            {organization.email && <Text style={S.companyDetail}>{organization.email}</Text>}
            {organization.siret && <Text style={S.companyDetail}>SIRET : {organization.siret}</Text>}
            {isVatSubject && organization.vat_number && (
              <Text style={S.companyDetail}>TVA : {organization.vat_number}</Text>
            )}
            {!isVatSubject && (
              <Text style={S.companyDetail}>TVA non applicable, art. 293B CGI</Text>
            )}
          </View>
        </View>

        {/* ── Title Banner ── */}
        <View style={S.titleBanner}>
          <Text style={S.titleText}>
            DEVIS{quote.number ? ` N° ${quote.number}` : ''}
          </Text>
          <View>
            <Text style={S.titleMeta}>Date : {fmtDate(quote.created_at)}</Text>
            <Text style={S.titleMeta}>Valable jusqu&apos;au : {fmtDate(validUntil)}</Text>
          </View>
        </View>

        {/* ── Address blocks ── */}
        <View style={S.addressRow}>
          <View style={S.addressBlock}>
            <Text style={S.addressLabel}>Émetteur</Text>
            <Text style={S.addressName}>{organization.name}</Text>
            {orgStreet && <Text style={S.addressLine}>{orgStreet}</Text>}
            {orgPostalCity && <Text style={S.addressLine}>{orgPostalCity}</Text>}
            {orgCountry && <Text style={S.addressLine}>{orgCountry}</Text>}
            {organization.email && <Text style={S.addressLine}>{organization.email}</Text>}
          </View>
          <View style={S.addressBlock}>
            <Text style={S.addressLabel}>Client</Text>
            {client ? (
              <>
                <Text style={S.addressName}>{clientDisplayName(client)}</Text>
                {client.address_line1 && <Text style={S.addressLine}>{client.address_line1}</Text>}
                {(client.postal_code || client.city) && (
                  <Text style={S.addressLine}>{[client.postal_code, client.city].filter(Boolean).join(' ')}</Text>
                )}
                {client.email && <Text style={S.addressLine}>{client.email}</Text>}
                {client.phone && <Text style={S.addressLine}>{client.phone}</Text>}
                {client.siret && <Text style={S.addressLine}>SIRET : {client.siret}</Text>}
              </>
            ) : (
              <Text style={S.addressLine}>-</Text>
            )}
          </View>
        </View>

        {/* ── Demande du client (formulaire public) ── */}
        {quote.client_request_description && quote.client_request_visible_on_pdf && (
          <View style={S.clientRequestBox}>
            <Text style={S.clientRequestLabel}>Votre demande</Text>
            <Text style={S.clientRequestText}>{quote.client_request_description}</Text>
          </View>
        )}

        {/* ── Intro text ── */}
        {quote.notes_client && (
          <View style={S.introBox}>
            <Text style={S.introText}>{quote.notes_client}</Text>
          </View>
        )}

        {/* ── Items table ── */}
        <View style={S.tableHeader}>
          <Text style={[S.tableHeaderText, S.colDesc]}>Désignation</Text>
          <Text style={[S.tableHeaderText, S.colQty]}>Qté</Text>
          <Text style={[S.tableHeaderText, S.colUnit]}>Unité</Text>
          <Text style={[S.tableHeaderText, S.colPu]}>PU HT</Text>
          {isVatSubject && <Text style={[S.tableHeaderText, S.colVat]}>TVA %</Text>}
          <Text style={[S.tableHeaderText, S.colTotal]}>Total HT</Text>
        </View>

        {/* Sections */}
        {visibleSections.map(section => (
          <View key={section.id}>
            {section.title && (
              <View style={S.sectionRow} wrap={false}>
                <Text style={S.sectionTitle}>{section.title}</Text>
              </View>
            )}
            {section.items.map((item, idx) => (
              <View key={item.id} style={[S.itemRow, idx % 2 === 1 ? S.itemRowAlt : {}]} wrap={false}>
                <Text style={[S.itemText, S.colDesc]}>{item.description ?? ''}</Text>
                <Text style={[S.itemTextRight, S.colQty]}>{item.quantity}</Text>
                <Text style={[S.itemText, S.colUnit, { textAlign: 'center' }]}>{item.unit ?? ''}</Text>
                <Text style={[S.itemTextRight, S.colPu]}>{fmt(item.unit_price, quote.currency)}</Text>
                {isVatSubject && <Text style={[S.itemTextRight, S.colVat]}>{item.vat_rate}%</Text>}
                <Text style={[S.itemTextRight, S.colTotal]}>{fmt(item.quantity * item.unit_price, quote.currency)}</Text>
              </View>
            ))}
          </View>
        ))}

        {/* Unsectioned items */}
        {visibleUnsectioned.length > 0 && (
          <View>
            {visibleUnsectioned.map((item, idx) => (
              <View key={item.id} style={[S.itemRow, idx % 2 === 1 ? S.itemRowAlt : {}]} wrap={false}>
                <Text style={[S.itemText, S.colDesc]}>{item.description ?? ''}</Text>
                <Text style={[S.itemTextRight, S.colQty]}>{item.quantity}</Text>
                <Text style={[S.itemText, S.colUnit, { textAlign: 'center' }]}>{item.unit ?? ''}</Text>
                <Text style={[S.itemTextRight, S.colPu]}>{fmt(item.unit_price, quote.currency)}</Text>
                {isVatSubject && <Text style={[S.itemTextRight, S.colVat]}>{item.vat_rate}%</Text>}
                <Text style={[S.itemTextRight, S.colTotal]}>{fmt(item.quantity * item.unit_price, quote.currency)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Totals + Conditions + Signature (bloqués ensemble sur la même page) ── */}
        <View wrap={false}>
          {/* Totals */}
          <View style={S.totalsContainer}>
            <View style={S.totalsBox}>
              <View style={S.totalsRow}>
                <Text style={S.totalsLabel}>Total HT</Text>
                <Text style={S.totalsValue}>{fmt(totalHt, quote.currency)}</Text>
              </View>
              {isVatSubject ? (
                Object.entries(vatMap).map(([rate, amount]) => (
                  <View key={rate} style={S.totalsRow}>
                    <Text style={S.totalsLabel}>TVA {rate}%</Text>
                    <Text style={S.totalsValue}>{fmt(amount, quote.currency)}</Text>
                  </View>
                ))
              ) : (
                <View style={S.totalsRow}>
                  <Text style={S.totalsLabel}>TVA</Text>
                  <Text style={[S.totalsValue, { fontStyle: 'italic', color: '#999' }]}>Non applicable</Text>
                </View>
              )}
              <View style={S.totalTtcRow}>
                <Text style={S.totalTtcLabel}>{isVatSubject ? 'TOTAL TTC' : 'TOTAL HT'}</Text>
                <Text style={S.totalTtcValue}>{fmt(totalTtc, quote.currency)}</Text>
              </View>
              {!isVatSubject && (
                <Text style={S.vatExemptNotice}>TVA non applicable, art. 293B du CGI</Text>
              )}
            </View>
          </View>

          {/* Conditions + Signature */}
          <View style={S.bottomSection}>
            <View style={S.conditionsBox}>
              {quote.payment_conditions && (
                <>
                  <Text style={S.conditionsTitle}>Conditions de paiement</Text>
                  <Text style={S.conditionsText}>{quote.payment_conditions}</Text>
                </>
              )}
              {(organization.iban || organization.payment_terms_days) && (
                <>
                  <Text style={[S.conditionsTitle, { marginTop: quote.payment_conditions ? 8 : 0 }]}>Modalités de règlement</Text>
                  {organization.payment_terms_days && (
                    <Text style={S.conditionsText}>Règlement à {organization.payment_terms_days} jours à compter de la date de facturation.</Text>
                  )}
                  {organization.iban && (
                    <Text style={S.conditionsText}>
                      Virement bancaire · IBAN : {organization.iban}{organization.bic ? `  ·  BIC : ${organization.bic}` : ''}{organization.bank_name ? `  ·  ${organization.bank_name}` : ''}
                    </Text>
                  )}
                  {organization.late_penalty_rate && (
                    <Text style={S.conditionsText}>
                      Pénalités de retard : {organization.late_penalty_rate}% par an.
                    </Text>
                  )}
                  {organization.late_penalty_rate && isClientPro && (
                    <Text style={S.conditionsText}>
                      {organization.recovery_indemnity_text
                        ?? "Conformément à l'article L441-10 du Code de commerce, une indemnité forfaitaire de 40 € pour frais de recouvrement est due de plein droit en cas de retard de paiement."}
                    </Text>
                  )}
                  {organization.court_competent && (
                    <Text style={S.conditionsText}>En cas de litige : {organization.court_competent}.</Text>
                  )}
                </>
              )}
            </View>
            <View style={S.signatureBox}>
              <Text style={S.signatureLabel}>Bon pour accord, date et signature</Text>
            </View>
          </View>
        </View>

        {/* ── Footer légal — uniquement sur la dernière page ── */}
        <View style={S.footer} fixed>
          <Text
            style={S.footerText}
            render={({ pageNumber, totalPages }) =>
              pageNumber === totalPages ? legalLine : ''
            }
          />
        </View>

        {/* ── Numéro de page — sur toutes les pages ── */}
        <Text
          style={S.pageNumber}
          render={({ pageNumber, totalPages }) =>
            totalPages > 1 ? `${pageNumber} / ${totalPages}` : ''
          }
          fixed
        />

      </Page>
    </Document>
  )
}
