import React from 'react'
import { Document, Page, View, Text, Image } from '@react-pdf/renderer'
import type { Organization } from '@/lib/data/queries/organization'
import type { InvoiceWithItems } from '@/lib/data/queries/invoices'
import { APP_NAME } from '@/lib/brand'
import { registerFonts, makePageStyles, DS } from '@/lib/pdf/pdf-design-system'

registerFonts()

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number, currency = 'EUR') =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 2 })
    .format(n)
    .replace(/ /g, ' ')

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })

function clientDisplayName(client: NonNullable<InvoiceWithItems['client']>): string {
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function InvoicePDF({ invoice, organization }: InvoicePDFProps) {
  const S = makePageStyles()

  const isVatSubject = organization.is_vat_subject !== false
  const isClientPro = invoice.client?.type === 'company'

  const invoiceType = invoice.invoice_type ?? 'standard'
  const invoiceTypeLabel =
    invoiceType === 'acompte' ? "FACTURE D'ACOMPTE" :
    invoiceType === 'solde'   ? 'FACTURE DE SOLDE'  :
    'FACTURE'

  const items = (invoice.items ?? []).filter(i => !i.is_internal)
  const currency = invoice.currency ?? 'EUR'

  const totalHt = items.reduce((s, i) => s + i.quantity * i.unit_price, 0)
  const vatMap: Record<number, number> = {}
  if (isVatSubject) {
    for (const item of items) {
      const v = item.quantity * item.unit_price * (item.vat_rate / 100)
      vatMap[item.vat_rate] = (vatMap[item.vat_rate] ?? 0) + v
    }
  }
  const totalTva = Object.values(vatMap).reduce((s, v) => s + v, 0)
  const totalTtc = isVatSubject ? totalHt + totalTva : totalHt

  const orgStreet = organization.address_line1 ?? null
  const orgPostalCity = [organization.postal_code, organization.city].filter(Boolean).join(' ') || null

  const legalParts: string[] = []
  if (organization.forme_juridique) legalParts.push(organization.forme_juridique)
  if (organization.capital_social) legalParts.push(`Capital : ${organization.capital_social}`)
  if (organization.siret) legalParts.push(`SIRET : ${organization.siret}`)
  if (!isVatSubject) legalParts.push('TVA non applicable, art. 293B du CGI')
  else if (organization.vat_number) legalParts.push(`TVA : ${organization.vat_number}`)
  if (organization.rcs && organization.rcs_ville) legalParts.push(`RCS ${organization.rcs_ville} ${organization.rcs}`)
  else if (organization.rcs) legalParts.push(`RCS ${organization.rcs}`)
  if (organization.insurance_info) legalParts.push(`Assurance : ${organization.insurance_info}`)
  if (organization.certifications) legalParts.push(organization.certifications)
  const legalLine = legalParts.join('  ·  ') || organization.name

  return (
    <Document
      title={`Facture ${invoice.number ?? ''} — ${organization.name}`}
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

        {/* ── Title block ── */}
        <View style={S.titleBlock}>
          <Text style={S.titleLabel}>
            {invoiceTypeLabel}{invoice.number ? ` N° ${invoice.number}` : ''}
          </Text>
          <View style={{ flexDirection: 'row', gap: DS.space.xl, marginTop: 6 }}>
            {invoice.issue_date && (
              <Text style={S.titleMeta}>Date : {fmtDate(invoice.issue_date)}</Text>
            )}
            {invoice.due_date && (
              <Text style={S.titleMeta}>Échéance : {fmtDate(invoice.due_date)}</Text>
            )}
          </View>
          <View style={S.titleAccentLine} />
        </View>

        {/* ── Address blocks ── */}
        <View style={S.addressRow}>
          <View style={S.addressBlock}>
            <Text style={S.addressLabel}>Émetteur</Text>
            <Text style={S.addressName}>{organization.name}</Text>
            {orgStreet && <Text style={S.addressLine}>{orgStreet}</Text>}
            {orgPostalCity && <Text style={S.addressLine}>{orgPostalCity}</Text>}
            {organization.email && <Text style={S.addressLine}>{organization.email}</Text>}
            {organization.siren && <Text style={S.addressLine}>SIREN : {organization.siren}</Text>}
          </View>
          <View style={S.addressBlock}>
            <Text style={S.addressLabel}>Facturé à</Text>
            {invoice.client ? (
              <>
                <Text style={S.addressName}>{clientDisplayName(invoice.client)}</Text>
                {invoice.client.address_line1 && (
                  <Text style={S.addressLine}>{invoice.client.address_line1}</Text>
                )}
                {(invoice.client.postal_code || invoice.client.city) && (
                  <Text style={S.addressLine}>
                    {[invoice.client.postal_code, invoice.client.city].filter(Boolean).join(' ')}
                  </Text>
                )}
                {invoice.client.email && <Text style={S.addressLine}>{invoice.client.email}</Text>}
                {invoice.client.phone && <Text style={S.addressLine}>{invoice.client.phone}</Text>}
                {invoice.client.siret ? (
                  <Text style={S.addressLine}>SIRET : {invoice.client.siret}</Text>
                ) : invoice.client.siren ? (
                  <Text style={S.addressLine}>SIREN : {invoice.client.siren}</Text>
                ) : null}
                {invoice.client.vat_number && (
                  <Text style={S.addressLine}>TVA : {invoice.client.vat_number}</Text>
                )}
              </>
            ) : (
              <Text style={S.addressLine}>—</Text>
            )}
          </View>
        </View>

        {/* ── Notes client ── */}
        {invoice.notes_client && (
          <View style={S.introBox}>
            <Text style={S.introText}>{invoice.notes_client}</Text>
          </View>
        )}

        {/* ── Table ── */}
        <View style={S.tableHeader}>
          <Text style={[S.tableHeaderText, S.colDesc]}>Désignation</Text>
          <Text style={[S.tableHeaderText, S.colQty]}>Qté</Text>
          <Text style={[S.tableHeaderText, S.colUnit]}>Unité</Text>
          <Text style={[S.tableHeaderText, S.colPu]}>PU HT</Text>
          {isVatSubject && <Text style={[S.tableHeaderText, S.colVat]}>TVA %</Text>}
          <Text style={[S.tableHeaderText, S.colTotal]}>Total HT</Text>
        </View>

        {items.map(item => (
          <View key={item.id} style={S.itemRow} wrap={false}>
            <Text style={[S.itemText, S.colDesc]}>{item.description ?? ''}</Text>
            <Text style={[S.itemTextRight, S.colQty]}>{item.quantity}</Text>
            <Text style={[S.itemText, S.colUnit, { textAlign: 'center' }]}>{item.unit ?? ''}</Text>
            <Text style={[S.itemTextRight, S.colPu]}>{fmt(item.unit_price, currency)}</Text>
            {isVatSubject && <Text style={[S.itemTextRight, S.colVat]}>{item.vat_rate}%</Text>}
            <Text style={[S.itemTextRight, S.colTotal]}>{fmt(item.quantity * item.unit_price, currency)}</Text>
          </View>
        ))}

        {/* ── Totaux + Paiement (bloqués ensemble) ── */}
        <View wrap={false}>

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
                  <Text style={[S.totalsValue, { color: DS.color.muted }]}>Non applicable</Text>
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

          {/* Modalités de règlement */}
          {(organization.iban || organization.payment_terms_days || invoice.payment_conditions) && (
            <View style={{ marginTop: DS.space.xl }}>
              <Text style={S.conditionsTitle}>Modalités de règlement</Text>
              {invoice.payment_conditions ? (
                <Text style={S.conditionsText}>{invoice.payment_conditions}</Text>
              ) : organization.payment_terms_days ? (
                <Text style={S.conditionsText}>
                  Règlement à {organization.payment_terms_days} jours à compter de la date de facturation.
                </Text>
              ) : null}
              {organization.iban && (
                <Text style={S.conditionsText}>
                  Virement · IBAN : {organization.iban}
                  {organization.bic ? `  ·  BIC : ${organization.bic}` : ''}
                  {organization.bank_name ? `  ·  ${organization.bank_name}` : ''}
                </Text>
              )}
            </View>
          )}

          {/* Pénalités */}
          {organization.late_penalty_rate && (
            <View style={{ marginTop: DS.space.sm }}>
              <Text style={S.conditionsText}>
                {`Pénalités de retard : ${organization.late_penalty_rate}% par an exigibles dès le lendemain de la date d'échéance, sans mise en demeure préalable.`}
                {isClientPro
                  ? `\n${organization.recovery_indemnity_text ?? "Conformément à l'article L441-10 du Code de commerce, une indemnité forfaitaire de 40 € pour frais de recouvrement est due de plein droit en cas de retard de paiement."}`
                  : ''}
                {organization.court_competent ? `\nEn cas de litige : ${organization.court_competent}.` : ''}
              </Text>
            </View>
          )}

        </View>

        {/* ── Footer légal ── */}
        <View style={S.footer} fixed>
          <Text
            style={S.footerText}
            render={({ pageNumber, totalPages }) =>
              pageNumber === totalPages ? legalLine : ''
            }
          />
        </View>

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
