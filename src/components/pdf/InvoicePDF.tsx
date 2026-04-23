import React from 'react'
import {
  Document, Page, View, Text, Image, StyleSheet,
} from '@react-pdf/renderer'
import type { Organization } from '@/lib/data/queries/organization'
import type { InvoiceWithItems } from '@/lib/data/queries/invoices'
import { APP_NAME } from '@/lib/brand'

// ─── Helpers ──────────────────────────────────────────────────────────────────

// @react-pdf/renderer ne gère pas l'espace fine insécable (U+202F) de fr-FR → slash
const fmt = (n: number, currency = 'EUR') =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 2 })
    .format(n)
    .replace(/\u202F/g, ' ')

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })

function clientDisplayName(client: InvoiceWithItems['client']): string {
  if (!client) return '-'
  return client.company_name
    || [client.first_name, client.last_name].filter(Boolean).join(' ')
    || client.email
    || '-'
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type InvoicePDFProps = {
  invoice: InvoiceWithItems
  organization: Organization
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
    paymentBox: {
      marginTop: 20,
      padding: 14,
      backgroundColor: '#f8f8f8',
      borderRadius: 6,
      borderLeftWidth: 3,
      borderLeftColor: accent,
    },
    paymentTitle: { fontFamily: 'Helvetica-Bold', fontSize: 8.5, color: '#333', marginBottom: 6 },
    paymentLine: { fontSize: 8, color: '#555', marginBottom: 2.5, lineHeight: 1.5 },
    penaltiesBox: {
      marginTop: 8,
      padding: 10,
      backgroundColor: '#fff8ee',
      borderRadius: 4,
      borderWidth: 0.5,
      borderColor: '#f0d090',
    },
    penaltiesText: { fontSize: 7.5, color: '#665533', lineHeight: 1.5 },
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

export default function InvoicePDF({ invoice, organization }: InvoicePDFProps) {
  const accent = organization.primary_color ?? '#6C63FF'
  const S = makeStyles(accent)

  // Franchise en base de TVA (art. 293B CGI)
  const isVatSubject = organization.is_vat_subject !== false

  // Type de facture
  const invoiceType = invoice.invoice_type ?? 'standard'
  const invoiceTypeLabel =
    invoiceType === 'acompte' ? 'FACTURE D\'ACOMPTE' :
    invoiceType === 'solde'   ? 'FACTURE DE SOLDE' :
    'FACTURE'

  const allItems = invoice.items ?? []
  const items = allItems.filter(i => !i.is_internal) // lignes internes masquées du PDF client
  const currency = invoice.currency ?? 'EUR'

  const totalHt = items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0)
  const vatMap: Record<number, number> = {}
  if (isVatSubject) {
    for (const item of items) {
      const vatAmt = item.quantity * item.unit_price * (item.vat_rate / 100)
      vatMap[item.vat_rate] = (vatMap[item.vat_rate] ?? 0) + vatAmt
    }
  }
  const totalTva = Object.values(vatMap).reduce((s, v) => s + v, 0)
  const totalTtc = isVatSubject ? totalHt + totalTva : totalHt

  const orgStreet = organization.address_line1 ?? null
  const orgPostalCity = [organization.postal_code, organization.city].filter(Boolean).join(' ') || null
  const orgCountry = organization.country ?? null

  // Mentions légales — affichées uniquement en bas de la dernière page
  const legalParts: string[] = []
  if (organization.forme_juridique) legalParts.push(organization.forme_juridique)
  if (organization.capital_social) legalParts.push(`Capital : ${organization.capital_social}`)
  if (organization.siret) legalParts.push(`SIRET : ${organization.siret}`)
  if (!isVatSubject) {
    legalParts.push('TVA non applicable, art. 293B du CGI')
  } else if (organization.vat_number) {
    legalParts.push(`TVA intracommunautaire : ${organization.vat_number}`)
  }
  if (organization.rcs && organization.rcs_ville) legalParts.push(`RCS ${organization.rcs_ville} ${organization.rcs}`)
  else if (organization.rcs) legalParts.push(`RCS ${organization.rcs}`)
  if (organization.insurance_info) legalParts.push(`Assurance : ${organization.insurance_info}`)
  if (organization.certifications) legalParts.push(organization.certifications)
  const legalLine = legalParts.join('  ·  ') || organization.name

  const hasPaymentInfo = !!(organization.iban || organization.payment_terms_days)
  const hasPenalties = !!(organization.late_penalty_rate)
  // L'indemnité forfaitaire de 40 € (art. L441-10) est réservée aux relations B2B
  const isClientPro = invoice.client?.type === 'company'

  return (
    <Document
      title={`Facture ${invoice.number ?? ''} - ${organization.name}`}
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
            {orgStreet ? <Text style={S.companyDetail}>{orgStreet}</Text> : null}
            {orgPostalCity ? <Text style={S.companyDetail}>{orgPostalCity}</Text> : null}
            {orgCountry ? <Text style={S.companyDetail}>{orgCountry}</Text> : null}
            {organization.phone ? <Text style={S.companyDetail}>Tél : {organization.phone}</Text> : null}
            {organization.email ? <Text style={S.companyDetail}>{organization.email}</Text> : null}
            {organization.siret ? <Text style={S.companyDetail}>SIRET : {organization.siret}</Text> : null}
            {isVatSubject && organization.vat_number ? (
              <Text style={S.companyDetail}>TVA : {organization.vat_number}</Text>
            ) : null}
            {!isVatSubject ? (
              <Text style={S.companyDetail}>TVA non applicable, art. 293B CGI</Text>
            ) : null}
          </View>
        </View>

        {/* ── Title Banner ── */}
        <View style={S.titleBanner}>
          <Text style={S.titleText}>
            {invoiceTypeLabel}{invoice.number ? ` N° ${invoice.number}` : ''}
          </Text>
          <View>
            {invoice.issue_date ? (
              <Text style={S.titleMeta}>Date : {fmtDate(invoice.issue_date)}</Text>
            ) : null}
            {invoice.due_date ? (
              <Text style={S.titleMeta}>Échéance : {fmtDate(invoice.due_date)}</Text>
            ) : null}
            {invoiceType === 'acompte' && invoice.notes_client ? (
              <Text style={S.titleMeta}>{invoice.notes_client}</Text>
            ) : null}
          </View>
        </View>

        {/* ── Address blocks ── */}
        <View style={S.addressRow}>
          <View style={S.addressBlock}>
            <Text style={S.addressLabel}>Émetteur</Text>
            <Text style={S.addressName}>{organization.name}</Text>
            {orgStreet ? <Text style={S.addressLine}>{orgStreet}</Text> : null}
            {orgPostalCity ? <Text style={S.addressLine}>{orgPostalCity}</Text> : null}
            {orgCountry ? <Text style={S.addressLine}>{orgCountry}</Text> : null}
            {organization.email ? <Text style={S.addressLine}>{organization.email}</Text> : null}
            {organization.siren ? <Text style={S.addressLine}>SIREN : {organization.siren}</Text> : null}
          </View>
          <View style={S.addressBlock}>
            <Text style={S.addressLabel}>Facturé à</Text>
            {invoice.client ? (
              <>
                <Text style={S.addressName}>{clientDisplayName(invoice.client)}</Text>
                {invoice.client.address_line1 ? (
                  <Text style={S.addressLine}>{invoice.client.address_line1}</Text>
                ) : null}
                {(invoice.client.postal_code || invoice.client.city) ? (
                  <Text style={S.addressLine}>
                    {[invoice.client.postal_code, invoice.client.city].filter(Boolean).join(' ')}
                  </Text>
                ) : null}
                {invoice.client.email ? <Text style={S.addressLine}>{invoice.client.email}</Text> : null}
                {invoice.client.phone ? <Text style={S.addressLine}>{invoice.client.phone}</Text> : null}
                {invoice.client.siret ? (
                  <Text style={S.addressLine}>SIRET : {invoice.client.siret}</Text>
                ) : invoice.client.siren ? (
                  <Text style={S.addressLine}>SIREN : {invoice.client.siren}</Text>
                ) : null}
                {invoice.client.vat_number ? (
                  <Text style={S.addressLine}>TVA : {invoice.client.vat_number}</Text>
                ) : null}
              </>
            ) : (
              <Text style={S.addressLine}>-</Text>
            )}
          </View>
        </View>

        {/* ── Notes client ── */}
        {invoice.notes_client ? (
          <View style={S.introBox}>
            <Text style={S.introText}>{invoice.notes_client}</Text>
          </View>
        ) : null}

        {/* ── Table ── */}
        <View style={S.tableHeader}>
          <Text style={[S.tableHeaderText, S.colDesc]}>Désignation</Text>
          <Text style={[S.tableHeaderText, S.colQty]}>Qté</Text>
          <Text style={[S.tableHeaderText, S.colUnit]}>Unité</Text>
          <Text style={[S.tableHeaderText, S.colPu]}>PU HT</Text>
          {isVatSubject && <Text style={[S.tableHeaderText, S.colVat]}>TVA %</Text>}
          <Text style={[S.tableHeaderText, S.colTotal]}>Total HT</Text>
        </View>

        {items.map((item, idx) => (
          <View key={item.id} style={[S.itemRow, idx % 2 === 1 ? S.itemRowAlt : {}]} wrap={false}>
            <Text style={[S.itemText, S.colDesc]}>{item.description ?? ''}</Text>
            <Text style={[S.itemTextRight, S.colQty]}>{item.quantity}</Text>
            <Text style={[S.itemText, S.colUnit, { textAlign: 'center' }]}>{item.unit ?? ''}</Text>
            <Text style={[S.itemTextRight, S.colPu]}>{fmt(item.unit_price, currency)}</Text>
            {isVatSubject && <Text style={[S.itemTextRight, S.colVat]}>{item.vat_rate}%</Text>}
            <Text style={[S.itemTextRight, S.colTotal]}>{fmt(item.quantity * item.unit_price, currency)}</Text>
          </View>
        ))}

        {/* ── Totaux + Paiement + Pénalités (bloqués ensemble sur la même page) ── */}
        <View wrap={false}>

          {/* Totals */}
          <View style={S.totalsContainer}>
            <View style={S.totalsBox}>
              <View style={S.totalsRow}>
                <Text style={S.totalsLabel}>Total HT</Text>
                <Text style={S.totalsValue}>{fmt(totalHt, currency)}</Text>
              </View>
              {isVatSubject ? (
                Object.entries(vatMap).map(([rate, amount]) => (
                  <View key={rate} style={S.totalsRow}>
                    <Text style={S.totalsLabel}>TVA {rate}%</Text>
                    <Text style={S.totalsValue}>{fmt(amount, currency)}</Text>
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
                <Text style={S.totalTtcValue}>{fmt(totalTtc, currency)}</Text>
              </View>
              {!isVatSubject && (
                <Text style={S.vatExemptNotice}>TVA non applicable, art. 293B du CGI</Text>
              )}
            </View>
          </View>

          {/* Conditions de paiement */}
          {hasPaymentInfo ? (
            <View style={S.paymentBox}>
              <Text style={S.paymentTitle}>Modalités de règlement</Text>
              {invoice.payment_conditions ? (
                <Text style={S.paymentLine}>{invoice.payment_conditions}</Text>
              ) : organization.payment_terms_days ? (
                <Text style={S.paymentLine}>
                  Règlement à {organization.payment_terms_days} jours à compter de la date de facturation.
                </Text>
              ) : null}
              {organization.iban ? (
                <Text style={S.paymentLine}>
                  Virement bancaire · IBAN : {organization.iban}
                  {organization.bic ? `   BIC : ${organization.bic}` : ''}
                  {organization.bank_name ? `   ${organization.bank_name}` : ''}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* Pénalités de retard */}
          {hasPenalties ? (
            <View style={S.penaltiesBox}>
              <Text style={S.penaltiesText}>
                {`Pénalités de retard : ${organization.late_penalty_rate}% par an exigibles dès le lendemain de la date d'échéance, sans mise en demeure préalable.`}
                {isClientPro
                  ? (organization.recovery_indemnity_text
                      ? `\n${organization.recovery_indemnity_text}`
                      : "\nConformément à l'article L441-10 du Code de commerce, une indemnité forfaitaire de 40 € pour frais de recouvrement est due de plein droit en cas de retard de paiement.")
                  : ''}
                {organization.court_competent
                  ? `\nEn cas de litige : ${organization.court_competent}.`
                  : ''}
              </Text>
            </View>
          ) : null}

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
