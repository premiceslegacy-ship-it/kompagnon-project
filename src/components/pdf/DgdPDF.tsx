import React from 'react'
import { Document, Page, View, Text, Image } from '@react-pdf/renderer'
import { registerFonts, makePageStyles, DS, pdfText, fmtCapitalSocial } from '@/lib/pdf/pdf-design-system'
import { APP_NAME } from '@/lib/brand'
import type { Organization } from '@/lib/data/queries/organization'

registerFonts()

// ─── Types ────────────────────────────────────────────────────────────────────

export type DgdLine = {
  label: string
  reference?: string | null
  date?: string | null
  amount_ht: number
  retention_pct?: number | null
  retention_amount?: number | null
  net_ht?: number | null
  cumulative_pct?: number | null
  type: 'marche' | 'avenant' | 'situation' | 'solde' | 'liberation_rg' | 'total'
}

export type DgdPDFProps = {
  chantierTitle: string
  chantierAddress?: string | null
  clientName?: string | null
  marketReference?: string | null
  lines: DgdLine[]
  totalMarcheHt: number
  totalSituationsHt: number
  totalRetentionHt: number
  totalNetHt: number
  receptionDate?: string | null
  receptionStatus?: string | null
  organization: Organization
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  pdfText(new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n))

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-'

// ─── Component ────────────────────────────────────────────────────────────────

export default function DgdPDF({
  chantierTitle,
  chantierAddress,
  clientName,
  marketReference,
  lines,
  totalMarcheHt,
  totalSituationsHt,
  totalRetentionHt,
  totalNetHt,
  receptionDate,
  receptionStatus,
  organization,
}: DgdPDFProps) {
  const S = makePageStyles()

  const orgPostalCity = [organization.postal_code, organization.city].filter(Boolean).join(' ')

  const line2Parts: string[] = []
  if (organization.siret) line2Parts.push(`SIRET : ${organization.siret}`)
  if (organization.rcs && organization.rcs_ville) line2Parts.push(`RCS ${organization.rcs_ville} ${organization.rcs}`)
  else if (organization.rcs) line2Parts.push(`RCS ${organization.rcs}`)
  const isVatSubject = organization.is_vat_subject !== false
  if (!isVatSubject) line2Parts.push('TVA non applicable, art. 293B du CGI')
  else if (organization.vat_number) line2Parts.push(`TVA : ${organization.vat_number}`)

  const legalLines: string[] = [
    [organization.forme_juridique, fmtCapitalSocial(organization.capital_social) ? `Capital social : ${fmtCapitalSocial(organization.capital_social)}` : null].filter(Boolean).join(' · '),
    line2Parts.join(' · '),
    organization.insurance_info ? `Assurance RC${organization.decennale_enabled ? ' et décennale' : ''} : ${organization.insurance_info}` : null,
  ].filter((l): l is string => !!l && l.length > 0)

  const typeColors: Record<DgdLine['type'], string> = {
    marche:        '#1e40af',
    avenant:       '#7c3aed',
    situation:     DS.color.body,
    solde:         '#065f46',
    liberation_rg: '#b45309',
    total:         DS.color.black,
  }

  const typeLabels: Record<DgdLine['type'], string> = {
    marche:        'Marché',
    avenant:       'Avenant',
    situation:     'Situation',
    solde:         'Solde',
    liberation_rg: 'Libération RG',
    total:         'TOTAL',
  }

  return (
    <Document
      title={`DGD - ${chantierTitle}`}
      author={organization.name}
      subject="Décompte Général Définitif"
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
                <Text style={S.logoPlaceholderText}>{pdfText(organization.name.slice(0, 2).toUpperCase())}</Text>
              </View>
            )}
          </View>
          <View style={S.companyBlock}>
            <Text style={S.companyName}>{pdfText(organization.name)}</Text>
            {organization.address_line1 && <Text style={S.companyDetail}>{pdfText(organization.address_line1)}</Text>}
            {orgPostalCity && <Text style={S.companyDetail}>{pdfText(orgPostalCity)}</Text>}
            {organization.phone && <Text style={S.companyDetail}>{pdfText(organization.phone)}</Text>}
          </View>
        </View>

        {/* ── Titre ── */}
        <View style={{ marginBottom: DS.space.lg }}>
          <Text style={{ fontFamily: DS.font.heading, fontSize: 16, fontWeight: 700, color: DS.color.black, marginBottom: DS.space.xs }}>
            {pdfText('DECOMPTE GENERAL DEFINITIF')}
          </Text>
          <Text style={{ fontFamily: DS.font.body, fontSize: DS.size.sm, color: DS.color.muted }}>
            {pdfText('NF P 03-001 / Marche prive de travaux')}
          </Text>
        </View>

        {/* ── Infos chantier / client ── */}
        <View style={{ flexDirection: 'row', gap: DS.space.lg, marginBottom: DS.space.xl }}>
          <View style={{ flex: 1, backgroundColor: DS.color.surface, borderRadius: 6, padding: DS.space.md, gap: DS.space.xs }}>
            <Text style={{ fontFamily: DS.font.heading, fontSize: DS.size.xs, fontWeight: 700, color: DS.color.muted, textTransform: 'uppercase', marginBottom: 2 }}>Chantier</Text>
            <Text style={{ fontFamily: DS.font.heading, fontSize: DS.size.md, fontWeight: 700, color: DS.color.black }}>{pdfText(chantierTitle)}</Text>
            {chantierAddress && <Text style={{ fontFamily: DS.font.body, fontSize: DS.size.sm, color: DS.color.body }}>{pdfText(chantierAddress)}</Text>}
            {marketReference && <Text style={{ fontFamily: DS.font.body, fontSize: DS.size.sm, color: DS.color.muted }}>{pdfText(`Ref. marche : ${marketReference}`)}</Text>}
            {receptionDate && (
              <Text style={{ fontFamily: DS.font.body, fontSize: DS.size.sm, color: DS.color.muted }}>
                {pdfText(`Reception : ${fmtDate(receptionDate)} — ${receptionStatus === 'sans_reserve' ? 'sans reserve' : receptionStatus === 'reserve_levee' ? 'reserves levees' : 'avec reserves'}`)}
              </Text>
            )}
          </View>
          {clientName && (
            <View style={{ flex: 1, backgroundColor: DS.color.surface, borderRadius: 6, padding: DS.space.md, gap: DS.space.xs }}>
              <Text style={{ fontFamily: DS.font.heading, fontSize: DS.size.xs, fontWeight: 700, color: DS.color.muted, textTransform: 'uppercase', marginBottom: 2 }}>Maitre d'ouvrage</Text>
              <Text style={{ fontFamily: DS.font.heading, fontSize: DS.size.md, fontWeight: 700, color: DS.color.black }}>{pdfText(clientName)}</Text>
            </View>
          )}
        </View>

        {/* ── Tableau des lignes ── */}
        <View style={{ borderTopWidth: 1, borderTopColor: DS.color.divider, marginBottom: DS.space.sm }} />
        <View style={{ flexDirection: 'row', paddingHorizontal: DS.space.sm, paddingVertical: DS.space.xs, marginBottom: DS.space.xs }}>
          <Text style={{ flex: 1, fontFamily: DS.font.heading, fontSize: DS.size.xs, fontWeight: 700, color: DS.color.muted, textTransform: 'uppercase' }}>Designation</Text>
          <Text style={{ width: 60, fontFamily: DS.font.heading, fontSize: DS.size.xs, fontWeight: 700, color: DS.color.muted, textTransform: 'uppercase', textAlign: 'right' }}>Avct %</Text>
          <Text style={{ width: 80, fontFamily: DS.font.heading, fontSize: DS.size.xs, fontWeight: 700, color: DS.color.muted, textTransform: 'uppercase', textAlign: 'right' }}>Montant HT</Text>
          <Text style={{ width: 60, fontFamily: DS.font.heading, fontSize: DS.size.xs, fontWeight: 700, color: DS.color.muted, textTransform: 'uppercase', textAlign: 'right' }}>RG</Text>
          <Text style={{ width: 85, fontFamily: DS.font.heading, fontSize: DS.size.xs, fontWeight: 700, color: DS.color.muted, textTransform: 'uppercase', textAlign: 'right' }}>Net HT</Text>
        </View>
        <View style={{ borderTopWidth: 0.5, borderTopColor: DS.color.divider }} />

        {lines.map((line, i) => {
          const isTotal = line.type === 'total'
          return (
            <View
              key={i}
              wrap={false}
              style={{
                flexDirection: 'row',
                paddingHorizontal: DS.space.sm,
                paddingVertical: DS.space.xs,
                borderBottomWidth: 0.5,
                borderBottomColor: DS.color.divider,
                backgroundColor: isTotal ? DS.color.surface : undefined,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: isTotal ? DS.font.heading : DS.font.body, fontSize: DS.size.sm, fontWeight: isTotal ? 700 : 400, color: typeColors[line.type] }}>
                  {pdfText(`[${typeLabels[line.type]}] ${line.label}`)}
                </Text>
                {line.reference && (
                  <Text style={{ fontFamily: DS.font.body, fontSize: DS.size.xs, color: DS.color.muted }}>
                    {pdfText(line.reference)}
                  </Text>
                )}
                {line.date && (
                  <Text style={{ fontFamily: DS.font.body, fontSize: DS.size.xs, color: DS.color.muted }}>
                    {pdfText(fmtDate(line.date))}
                  </Text>
                )}
              </View>
              <Text style={{ width: 60, fontFamily: DS.font.body, fontSize: DS.size.sm, color: DS.color.body, textAlign: 'right' }}>
                {line.cumulative_pct != null ? pdfText(`${line.cumulative_pct}%`) : ''}
              </Text>
              <Text style={{ width: 80, fontFamily: isTotal ? DS.font.heading : DS.font.body, fontSize: DS.size.sm, fontWeight: isTotal ? 700 : 400, color: typeColors[line.type], textAlign: 'right' }}>
                {pdfText(fmt(line.amount_ht))}
              </Text>
              <Text style={{ width: 60, fontFamily: DS.font.body, fontSize: DS.size.sm, color: '#ea580c', textAlign: 'right' }}>
                {line.retention_amount ? pdfText(`-${fmt(line.retention_amount)}`) : ''}
              </Text>
              <Text style={{ width: 85, fontFamily: isTotal ? DS.font.heading : DS.font.body, fontSize: DS.size.sm, fontWeight: isTotal ? 700 : 400, color: isTotal ? DS.color.black : DS.color.body, textAlign: 'right' }}>
                {pdfText(fmt(line.net_ht ?? line.amount_ht))}
              </Text>
            </View>
          )
        })}

        {/* ── Récapitulatif ── */}
        <View style={{ marginTop: DS.space.xl, alignItems: 'flex-end' }}>
          <View style={{ width: 280, gap: DS.space.xs }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontFamily: DS.font.body, fontSize: DS.size.sm, color: DS.color.muted }}>Marche initial + avenants HT</Text>
              <Text style={{ fontFamily: DS.font.body, fontSize: DS.size.sm, color: DS.color.body }}>{pdfText(fmt(totalMarcheHt))}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontFamily: DS.font.body, fontSize: DS.size.sm, color: DS.color.muted }}>Total facture HT</Text>
              <Text style={{ fontFamily: DS.font.body, fontSize: DS.size.sm, color: DS.color.body }}>{pdfText(fmt(totalSituationsHt))}</Text>
            </View>
            {totalRetentionHt > 0 && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontFamily: DS.font.body, fontSize: DS.size.sm, color: '#ea580c' }}>Retenues de garantie prelevees</Text>
                <Text style={{ fontFamily: DS.font.body, fontSize: DS.size.sm, color: '#ea580c' }}>{pdfText(`-${fmt(totalRetentionHt)}`)}</Text>
              </View>
            )}
            <View style={{ borderTopWidth: 1, borderTopColor: DS.color.black, marginTop: DS.space.xs }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontFamily: DS.font.heading, fontSize: DS.size.md, fontWeight: 700, color: DS.color.black }}>SOLDE NET HT</Text>
              <Text style={{ fontFamily: DS.font.heading, fontSize: DS.size.md, fontWeight: 700, color: DS.color.black }}>{pdfText(fmt(totalNetHt))}</Text>
            </View>
          </View>
        </View>

        {/* ── Signatures ── */}
        <View style={{ marginTop: DS.space.xl * 2, flexDirection: 'row', gap: DS.space.xl }}>
          {[
            { label: `L'Entrepreneur — ${organization.name}`, sub: organization.signatory_name ?? '' },
            { label: "Le Maitre d'ouvrage", sub: clientName ?? '' },
          ].map((party, i) => (
            <View key={i} style={{ flex: 1, borderTopWidth: 1, borderTopColor: DS.color.divider, paddingTop: DS.space.sm }}>
              <Text style={{ fontFamily: DS.font.heading, fontSize: DS.size.sm, fontWeight: 700, color: DS.color.black, marginBottom: DS.space.xs }}>{pdfText(party.label)}</Text>
              {party.sub && <Text style={{ fontFamily: DS.font.body, fontSize: DS.size.xs, color: DS.color.muted, marginBottom: DS.space.lg }}>{pdfText(party.sub)}</Text>}
              <Text style={{ fontFamily: DS.font.body, fontSize: DS.size.xs, color: DS.color.muted }}>Date :</Text>
              <View style={{ marginTop: DS.space.xl, borderBottomWidth: 0.5, borderBottomColor: DS.color.divider }} />
              <Text style={{ fontFamily: DS.font.body, fontSize: DS.size.xs, color: DS.color.muted, marginTop: DS.space.xs }}>Signature :</Text>
            </View>
          ))}
        </View>

        {/* ── Footer ── */}
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
