import React from 'react'
import { Document, Page, View, Text, Image } from '@react-pdf/renderer'
import type { Organization } from '@/lib/data/queries/organization'
import type { QuoteWithItems } from '@/lib/data/queries/quotes'
import type { Client } from '@/lib/data/queries/clients'
import { APP_NAME } from '@/lib/brand'
import { registerFonts, makePageStyles, DS } from '@/lib/pdf/pdf-design-system'

registerFonts()

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Remplace tout espace (normal, insécable U+00A0, fine insécable U+202F) par
// pour empêcher react-pdf de couper les montants en milieu de nombre.
const fmt = (n: number, currency = 'EUR') =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 2 })
    .format(n)
    .replace(/[   ]/g, ' ')

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

// ─── Component ────────────────────────────────────────────────────────────────

export default function QuotePDF({ quote, organization, client }: QuotePDFProps) {
  const S = makePageStyles()

  const isVatSubject = organization.is_vat_subject !== false
  const isClientPro = client?.type === 'company'

  const visibleSections = quote.sections.map(s => ({
    ...s,
    items: s.items.filter(i => !i.is_internal),
  })).filter(s => s.items.length > 0)
  const visibleUnsectioned = quote.unsectionedItems.filter(i => !i.is_internal)

  const allItems = [
    ...visibleSections.flatMap(s => s.items),
    ...visibleUnsectioned,
  ]

  const totalHt = allItems.reduce((s, i) => s + i.quantity * i.unit_price, 0)
  const vatMap: Record<number, number> = {}
  if (isVatSubject) {
    for (const item of allItems) {
      const v = item.quantity * item.unit_price * (item.vat_rate / 100)
      vatMap[item.vat_rate] = (vatMap[item.vat_rate] ?? 0) + v
    }
  }
  const totalTva = Object.values(vatMap).reduce((s, v) => s + v, 0)
  const totalTtc = isVatSubject ? totalHt + totalTva : totalHt

  const validUntil = quote.valid_until
    ? quote.valid_until
    : addDays(quote.created_at, quote.validity_days ?? 30)

  const orgStreet = organization.address_line1 ?? null
  const orgPostalCity = [organization.postal_code, organization.city].filter(Boolean).join(' ') || null

  // ── Construction du footer légal multi-ligne ──
  const fmtCapital = (v: string | number | null) => {
    if (v == null) return null
    const n = typeof v === 'string' ? parseFloat(v.replace(/[\s   ]/g, '').replace(',', '.').replace('€', '')) : v
    if (isNaN(n)) return null
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' €'
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
      title={`Devis ${quote.number ?? ''} — ${organization.name}`}
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
            DEVIS{quote.number ? ` N° ${quote.number}` : ''}
          </Text>
          <View style={{ flexDirection: 'row', gap: DS.space.xl, marginTop: 6 }}>
            <Text style={S.titleMeta}>Date : {fmtDate(quote.created_at)}</Text>
            <Text style={S.titleMeta}>Valable jusqu&apos;au : {fmtDate(validUntil)}</Text>
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
              <Text style={S.addressLine}>—</Text>
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

        {/* ── Garantie décennale ── */}
        {organization.decennale_enabled && organization.decennale_assureur && (
          <View style={{ marginBottom: DS.space.lg, paddingVertical: DS.space.md, paddingHorizontal: DS.space.md, borderWidth: 0.5, borderColor: DS.color.divider, backgroundColor: DS.color.surface }} wrap={false}>
            <Text style={{ fontFamily: DS.font.heading, fontWeight: 700, fontSize: DS.size.xxs, color: DS.color.secondary, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: DS.space.sm }}>
              Garantie décennale — Art. L241-1 Code des assurances
            </Text>
            <Text style={{ fontFamily: DS.font.body, fontSize: DS.size.sm, color: DS.color.body, lineHeight: 1.5 }}>
              {`Assureur : ${organization.decennale_assureur}`}
              {organization.decennale_police ? `  ·  Police n° ${organization.decennale_police}` : ''}
              {organization.decennale_couverture ? `  ·  Couverture : ${organization.decennale_couverture}` : ''}
              {(organization.decennale_date_debut || organization.decennale_date_fin)
                ? `  ·  Validité : ${organization.decennale_date_debut ? new Date(organization.decennale_date_debut).toLocaleDateString('fr-FR') : '?'} – ${organization.decennale_date_fin ? new Date(organization.decennale_date_fin).toLocaleDateString('fr-FR') : '?'}`
                : ''}
            </Text>
          </View>
        )}

        {/* ── Intro ── */}
        {quote.notes_client && (
          <View style={S.introBox}>
            <Text style={S.introText}>{quote.notes_client}</Text>
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

        {visibleSections.map(section => (
          <View key={section.id}>
            {section.title && (
              <View style={S.sectionRow} wrap={false}>
                <Text style={S.sectionTitle}>{section.title}</Text>
              </View>
            )}
            {section.items.map(item => (
              <View key={item.id} style={S.itemRow} wrap={false}>
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

        {visibleUnsectioned.map(item => (
          <View key={item.id} style={S.itemRow} wrap={false}>
            <Text style={[S.itemText, S.colDesc]}>{item.description ?? ''}</Text>
            <Text style={[S.itemTextRight, S.colQty]}>{item.quantity}</Text>
            <Text style={[S.itemText, S.colUnit, { textAlign: 'center' }]}>{item.unit ?? ''}</Text>
            <Text style={[S.itemTextRight, S.colPu]}>{fmt(item.unit_price, quote.currency)}</Text>
            {isVatSubject && <Text style={[S.itemTextRight, S.colVat]}>{item.vat_rate}%</Text>}
            <Text style={[S.itemTextRight, S.colTotal]}>{fmt(item.quantity * item.unit_price, quote.currency)}</Text>
          </View>
        ))}

        {/* ── Totaux + Conditions + Signature ── */}
        <View wrap={false}>

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
                  <Text style={[S.totalsValue, { color: DS.color.muted }]}>Non applicable</Text>
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
                  <Text style={S.conditionsTitle}>Modalités de règlement</Text>
                  {organization.payment_terms_days && (
                    <Text style={S.conditionsText}>
                      Règlement à {organization.payment_terms_days} jours à compter de la date de facturation.
                    </Text>
                  )}
                  {organization.iban && (
                    <Text style={S.conditionsText}>
                      Virement · IBAN : {organization.iban}
                      {organization.bic ? `  ·  BIC : ${organization.bic}` : ''}
                      {organization.bank_name ? `  ·  ${organization.bank_name}` : ''}
                    </Text>
                  )}
                  {organization.late_penalty_rate && (
                    <Text style={S.conditionsText}>
                      Pénalités de retard : {organization.late_penalty_rate}% par an.
                    </Text>
                  )}
                  {organization.late_penalty_rate && isClientPro && (
                    <Text style={S.conditionsText}>
                      {organization.recovery_indemnity_text
                        ?? "Conformément à l'article L441-10 du Code de commerce, une indemnité forfaitaire de 40 € pour frais de recouvrement est due de plein droit en cas de retard de paiement."}
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

        {/* ── Footer légal + pagination ── */}
        <View style={S.footer} fixed>
          <View style={{ flex: 1 }}>
            {legalLines.map((line, i) => (
              <Text key={i} style={S.footerText}>{line}</Text>
            ))}
          </View>
          <Text
            style={S.pageNumber}
            render={({ pageNumber, totalPages }) =>
              totalPages > 1 ? `${pageNumber} / ${totalPages}` : ''
            }
          />
        </View>

      </Page>
    </Document>
  )
}
