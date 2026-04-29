import React from 'react'
import { Document, Page, View, Text, Image } from '@react-pdf/renderer'
import type { Organization } from '@/lib/data/queries/organization'
import type { InvoiceWithItems } from '@/lib/data/queries/invoices'
import { APP_NAME } from '@/lib/brand'
import { registerFonts, makePageStyles, DS, pdfText } from '@/lib/pdf/pdf-design-system'

registerFonts()

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number, currency = 'EUR') =>
  pdfText(new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n))

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

  // ── Construction du footer légal multi-ligne ──
  const fmtCapital = (v: string | number | null) => {
    if (v == null) return null
    const n = typeof v === 'string' ? parseFloat(v.replace(/[\s   ]/g, '').replace(',', '.').replace('€', '')) : v
    if (isNaN(n)) return null
    return pdfText(new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' €')
  }

  // Ligne 1 : forme juridique + capital social
  const line1Parts: string[] = []
  if (organization.forme_juridique) line1Parts.push(organization.forme_juridique)
  const capitalFmt = fmtCapital(organization.capital_social)
  if (capitalFmt) line1Parts.push(`Capital social : ${capitalFmt}`)

  // Ligne 2 : identifiants (SIRET, RCS, TVA)
  const line2Parts: string[] = []
  if (organization.siret) line2Parts.push(`SIRET : ${organization.siret}`)
  if (organization.rcs && organization.rcs_ville) line2Parts.push(`RCS ${organization.rcs_ville} ${organization.rcs}`)
  else if (organization.rcs) line2Parts.push(`RCS ${organization.rcs}`)
  if (!isVatSubject) line2Parts.push('TVA non applicable, art. 293B du CGI')
  else if (organization.vat_number) line2Parts.push(`TVA : ${organization.vat_number}`)

  // Ligne 3 : assurance (adaptée au profil métier)
  let insuranceLine: string | null = null
  if (organization.insurance_info) {
    const label = organization.decennale_enabled
      ? 'Assurance responsabilité civile professionnelle et décennale'
      : 'Assurance responsabilité civile professionnelle'
    insuranceLine = `${label} : ${organization.insurance_info}`
  }

  const legalLines: string[] = [
    line1Parts.join(' · '),
    line2Parts.join(' · '),
    insuranceLine,
    organization.certifications,
  ].filter((l): l is string => !!l && l.length > 0)

  return (
    <Document
      title={`Facture ${invoice.number ?? ''} — ${organization.name}`}
      author={organization.name}
      subject={`Facture ${invoice.number ?? invoice.title ?? invoice.id}`}
      creator={APP_NAME}
      language="fr-FR"
      pdfVersion="1.7"
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
                  {pdfText(organization.name.slice(0, 2).toUpperCase())}
                </Text>
              </View>
            )}
          </View>
          <View style={S.companyBlock}>
            <Text style={S.companyName}>{pdfText(organization.name)}</Text>
            {orgStreet && <Text style={S.companyDetail}>{pdfText(orgStreet)}</Text>}
            {orgPostalCity && <Text style={S.companyDetail}>{pdfText(orgPostalCity)}</Text>}
            {organization.phone && <Text style={S.companyDetail}>Tél : {pdfText(organization.phone)}</Text>}
            {organization.email && <Text style={S.companyDetail}>{pdfText(organization.email)}</Text>}
            {organization.siret && <Text style={S.companyDetail}>SIRET : {pdfText(organization.siret)}</Text>}
            {isVatSubject && organization.vat_number && (
              <Text style={S.companyDetail}>TVA : {pdfText(organization.vat_number)}</Text>
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
            <Text style={S.addressName}>{pdfText(organization.name)}</Text>
            {orgStreet && <Text style={S.addressLine}>{pdfText(orgStreet)}</Text>}
            {orgPostalCity && <Text style={S.addressLine}>{pdfText(orgPostalCity)}</Text>}
            {organization.email && <Text style={S.addressLine}>{pdfText(organization.email)}</Text>}
            {organization.siren && <Text style={S.addressLine}>SIREN : {pdfText(organization.siren)}</Text>}
          </View>
          <View style={S.addressBlock}>
            <Text style={S.addressLabel}>Facturé à</Text>
            {invoice.client ? (
              <>
                <Text style={S.addressName}>{pdfText(clientDisplayName(invoice.client))}</Text>
                {invoice.client.address_line1 && (
                  <Text style={S.addressLine}>{pdfText(invoice.client.address_line1)}</Text>
                )}
                {(invoice.client.postal_code || invoice.client.city) && (
                  <Text style={S.addressLine}>
                    {pdfText([invoice.client.postal_code, invoice.client.city].filter(Boolean).join(' '))}
                  </Text>
                )}
                {invoice.client.email && <Text style={S.addressLine}>{pdfText(invoice.client.email)}</Text>}
                {invoice.client.phone && <Text style={S.addressLine}>{pdfText(invoice.client.phone)}</Text>}
                {invoice.client.siret ? (
                  <Text style={S.addressLine}>SIRET : {pdfText(invoice.client.siret)}</Text>
                ) : invoice.client.siren ? (
                  <Text style={S.addressLine}>SIREN : {pdfText(invoice.client.siren)}</Text>
                ) : null}
                {invoice.client.vat_number && (
                  <Text style={S.addressLine}>TVA : {pdfText(invoice.client.vat_number)}</Text>
                )}
              </>
            ) : (
              <Text style={S.addressLine}>—</Text>
            )}
          </View>
        </View>

        {/* ── Garantie décennale ── */}
        {organization.decennale_enabled && organization.decennale_assureur && (
          <View style={{ marginBottom: DS.space.lg, paddingVertical: DS.space.md, paddingHorizontal: DS.space.md, borderWidth: 0.5, borderColor: DS.color.divider, backgroundColor: DS.color.surface }} wrap={false}>
            <Text style={{ fontFamily: DS.font.heading, fontWeight: 700, fontSize: DS.size.xxs, color: DS.color.secondary, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: DS.space.sm }}>
              Garantie décennale — Art. L241-1 Code des assurances
            </Text>
            <Text style={{ fontFamily: DS.font.body, fontSize: DS.size.sm, color: DS.color.body, lineHeight: 1.5 }}>
              {pdfText(`Assureur : ${organization.decennale_assureur}`)}
              {organization.decennale_police ? pdfText(`  ·  Police n° ${organization.decennale_police}`) : ''}
              {organization.decennale_couverture ? pdfText(`  ·  Couverture : ${organization.decennale_couverture}`) : ''}
              {(organization.decennale_date_debut || organization.decennale_date_fin)
                ? pdfText(`  ·  Validité : ${organization.decennale_date_debut ? new Date(organization.decennale_date_debut).toLocaleDateString('fr-FR') : '?'} – ${organization.decennale_date_fin ? new Date(organization.decennale_date_fin).toLocaleDateString('fr-FR') : '?'}`)
                : ''}
            </Text>
          </View>
        )}

        {/* ── Notes client ── */}
        {invoice.notes_client && (
          <View style={S.introBox}>
            <Text style={S.introText}>{pdfText(invoice.notes_client)}</Text>
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
            <Text style={[S.itemText, S.colDesc]}>{pdfText(item.description)}</Text>
            <Text style={[S.itemTextRight, S.colQty]}>{item.quantity}</Text>
            <Text style={[S.itemText, S.colUnit, { textAlign: 'center' }]}>{pdfText(item.unit)}</Text>
            <Text style={[S.itemTextRight, S.colPu]}>{fmt(item.unit_price, currency)}</Text>
            {isVatSubject && <Text style={[S.itemTextRight, S.colVat]}>{item.vat_rate}%</Text>}
            <Text style={[S.itemTextRight, S.colTotal]}>{fmt(item.quantity * item.unit_price, currency)}</Text>
          </View>
        ))}

        {/* ── Totaux + Paiement ── */}
        <View wrap={false}>
          <View style={{ borderTopWidth: 1, borderTopColor: DS.color.black, marginBottom: DS.space.md }} />

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
              {invoice.aid_label && invoice.aid_amount != null && invoice.aid_amount > 0 && (
                <>
                  <View style={[S.totalsRow, { marginTop: DS.space.sm }]}>
                    <Text style={S.totalsLabel}>{pdfText(invoice.aid_label)}</Text>
                    <Text style={[S.totalsValue, { color: '#16A34A' }]}>{`−${fmt(invoice.aid_amount, currency)}`}</Text>
                  </View>
                  <View style={[S.totalTtcRow, { backgroundColor: DS.color.accent, marginTop: DS.space.xs }]}>
                    <Text style={S.totalTtcLabel}>RESTE À CHARGE</Text>
                    <Text style={S.totalTtcValue}>{fmt(Math.max(0, totalTtc - invoice.aid_amount), currency)}</Text>
                  </View>
                </>
              )}
            </View>
          </View>

          {/* Modalités de règlement */}
          {(organization.iban || organization.payment_terms_days || invoice.payment_conditions) && (
            <View style={{ marginTop: DS.space.xl }}>
              <Text style={S.conditionsTitle}>Modalités de règlement</Text>
              {invoice.payment_conditions ? (
                <Text style={S.conditionsText}>{pdfText(invoice.payment_conditions)}</Text>
              ) : organization.payment_terms_days ? (
                <Text style={S.conditionsText}>
                  Règlement à {organization.payment_terms_days} jours à compter de la date de facturation.
                </Text>
              ) : null}
              {organization.iban && (
                <Text style={S.conditionsText}>
                  Virement · IBAN : {pdfText(organization.iban)}
                  {organization.bic ? pdfText(`  ·  BIC : ${organization.bic}`) : ''}
                  {organization.bank_name ? pdfText(`  ·  ${organization.bank_name}`) : ''}
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
                  ? pdfText(` ${organization.recovery_indemnity_text ?? "Conformément à l'article L441-10 du Code de commerce, une indemnité forfaitaire de 40 € pour frais de recouvrement est due de plein droit en cas de retard de paiement."}`)
                  : ''}
                {organization.court_competent ? pdfText(` En cas de litige : ${organization.court_competent}.`) : ''}
              </Text>
            </View>
          )}

        </View>

        {/* ── Footer légal + pagination ── */}
        <View style={S.footer} fixed>
          <View style={{ flex: 1 }}>
            {legalLines.map((line, i) => (
              <Text key={i} style={S.footerText}>{pdfText(line)}</Text>
            ))}
          </View>
        </View>

      </Page>
    </Document>
  )
}
