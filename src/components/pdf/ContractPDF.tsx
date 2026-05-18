import React from 'react'
import { Document, Image, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import {
  CLAUSE_LABELS,
  CONTRACT_TYPE_LABELS,
  getRoleLabel,
  type ContractClauseKey,
  type ContractClauses,
  type ContractCustomSection,
  type ContractRole,
  type ContractStatus,
  type ContractType,
} from '@/lib/contracts/templates'
import { DS, pdfText, registerFonts } from '@/lib/pdf/pdf-design-system'

registerFonts()

export type ContractPdfSnapshot = {
  generatedAt: string
  reference: string
  disclaimer?: string
  contract: {
    id: string
    title: string
    type: ContractType
    role: ContractRole
    status: ContractStatus
    templateTitle: string
    clauses: ContractClauses
    customSections?: ContractCustomSection[]
  }
  organization: {
    name: string
    email: string | null
    phone: string | null
    address_line1: string | null
    address_line2: string | null
    postal_code: string | null
    city: string | null
    country: string | null
    siret: string | null
    siren: string | null
    vat_number: string | null
    logo_url: string | null
    forme_juridique: string | null
    capital_social: string | null
    rcs: string | null
    rcs_ville: string | null
    insurance_info: string | null
    court_competent?: string | null
    decennale_enabled?: boolean | null
    decennale_assureur?: string | null
    decennale_police?: string | null
    signatory_name?: string | null
    signatory_role?: string | null
    signature_image?: string | null
  } | null
  counterparty: {
    name: string
    email: string | null
    phone: string | null
    address: string | null
    signature_image?: string | null
    signatory_name?: string | null
    signatory_role?: string | null
    signed_at?: string | null
    client?: {
      type?: string | null
      company_name?: string | null
      contact_name?: string | null
      first_name?: string | null
      last_name?: string | null
      email?: string | null
      phone?: string | null
      address_line1?: string | null
      postal_code?: string | null
      city?: string | null
      siret?: string | null
      siren?: string | null
      vat_number?: string | null
    } | null
  }
  chantier: {
    title: string
    address_line1: string | null
    postal_code: string | null
    city: string | null
    start_date: string | null
    estimated_end_date: string | null
    budget_ht: number | null
  } | null
}

const CLAUSE_ORDER = Object.keys(CLAUSE_LABELS) as ContractClauseKey[]

function fmtDate(value: string | null | undefined): string {
  if (!value) return '-'
  const part = value.includes('T') ? value.slice(0, 10) : value
  const [year, month, day] = part.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

function compactLines(lines: Array<string | null | undefined>): string[] {
  return lines.map(line => pdfText(line).trim()).filter(Boolean)
}

const S = StyleSheet.create({
  page: {
    fontFamily: DS.font.body,
    fontSize: DS.size.base,
    color: DS.color.body,
    backgroundColor: DS.color.white,
    paddingTop: DS.space.xxl,
    paddingBottom: 50,
    paddingHorizontal: DS.space.page,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: DS.space.lg,
    paddingBottom: DS.space.lg,
    borderBottomWidth: 1,
    borderBottomColor: DS.color.divider,
    marginBottom: DS.space.xl,
  },
  logo: {
    width: 88,
    height: 42,
    objectFit: 'contain',
    marginBottom: DS.space.sm,
  },
  logoPlaceholder: {
    width: 88,
    height: 42,
    backgroundColor: DS.color.black,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: DS.space.sm,
  },
  logoPlaceholderText: {
    color: DS.color.white,
    fontFamily: DS.font.heading,
    fontWeight: 800,
    fontSize: DS.size.lg,
  },
  orgName: {
    fontFamily: DS.font.heading,
    fontWeight: 800,
    fontSize: DS.size.md,
    color: DS.color.black,
    textTransform: 'uppercase',
  },
  smallLine: {
    fontSize: DS.size.xs,
    color: DS.color.secondary,
    marginTop: 2,
  },
  metaBox: {
    alignItems: 'flex-end',
  },
  titleBlock: {
    marginBottom: DS.space.xl,
    borderBottomWidth: 1,
    borderBottomColor: DS.color.black,
    paddingBottom: DS.space.md,
  },
  titleLabel: {
    fontFamily: DS.font.heading,
    fontWeight: 800,
    fontSize: DS.size.xxl,
    color: DS.color.black,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  titleSub: {
    fontFamily: DS.font.heading,
    fontWeight: 700,
    fontSize: DS.size.md,
    color: DS.color.black,
    marginTop: 5,
  },
  accent: {
    height: 3,
    width: 42,
    backgroundColor: DS.color.accent,
    marginTop: DS.space.sm,
  },
  headerLeft: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    gap: DS.space.md,
    marginBottom: DS.space.lg,
  },
  box: {
    flex: 1,
    backgroundColor: DS.color.surface,
    padding: DS.space.md,
  },
  boxLabel: {
    fontFamily: DS.font.heading,
    fontWeight: 800,
    fontSize: DS.size.xxs,
    color: DS.color.secondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: DS.space.xs,
  },
  boxTitle: {
    fontFamily: DS.font.heading,
    fontWeight: 700,
    fontSize: DS.size.md,
    color: DS.color.black,
    marginBottom: 3,
  },
  boxLine: {
    fontSize: DS.size.xs,
    color: DS.color.body,
    marginTop: 2,
  },
  sectionTitle: {
    fontFamily: DS.font.heading,
    fontWeight: 800,
    fontSize: DS.size.sm,
    color: DS.color.black,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginTop: DS.space.md,
    paddingBottom: DS.space.xs,
    borderBottomWidth: 1,
    borderBottomColor: DS.color.black,
  },
  clause: {
    paddingTop: DS.space.sm,
    paddingBottom: DS.space.sm,
    borderBottomWidth: 1,
    borderBottomColor: DS.color.divider,
  },
  clauseTitle: {
    fontFamily: DS.font.heading,
    fontWeight: 700,
    fontSize: DS.size.sm,
    color: DS.color.black,
    marginBottom: 4,
  },
  clauseText: {
    fontSize: DS.size.sm,
    color: DS.color.body,
    lineHeight: 1.45,
    textAlign: 'justify',
  },
  footer: {
    position: 'absolute',
    bottom: 22,
    left: DS.space.page,
    right: DS.space.page,
    borderTopWidth: 1,
    borderTopColor: DS.color.divider,
    paddingTop: DS.space.xs,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    fontSize: DS.size.xxs,
    color: DS.color.muted,
  },
  signatures: {
    flexDirection: 'row',
    gap: DS.space.lg,
    marginTop: DS.space.xxl,
    paddingTop: DS.space.lg,
    breakInside: 'avoid',
  },
  signatureBox: {
    flex: 1,
    minHeight: 90,
    borderWidth: 1,
    borderColor: DS.color.divider,
    padding: DS.space.md,
  },
  signatureTitle: {
    fontFamily: DS.font.heading,
    fontWeight: 800,
    fontSize: DS.size.xs,
    color: DS.color.black,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: DS.space.sm,
  },
  signatureLine: {
    fontSize: DS.size.xs,
    color: DS.color.secondary,
    marginTop: 3,
  },
  signatureValue: {
    fontSize: DS.size.xs,
    color: DS.color.black,
    fontFamily: DS.font.heading,
    fontWeight: 700,
  },
  signatureImage: {
    width: 140,
    height: 50,
    objectFit: 'contain',
    marginTop: 4,
  },
  jurisdiction: {
    marginTop: DS.space.lg,
    paddingTop: DS.space.md,
    paddingBottom: DS.space.md,
    borderTopWidth: 1,
    borderTopColor: DS.color.black,
    borderBottomWidth: 1,
    borderBottomColor: DS.color.divider,
  },
  jurisdictionText: {
    fontSize: DS.size.sm,
    color: DS.color.body,
    lineHeight: 1.45,
  },
})

function PartyBlock({ label, title, lines }: { label: string; title: string; lines: string[] }) {
  return (
    <View style={S.box}>
      <Text style={S.boxLabel}>{label}</Text>
      <Text style={S.boxTitle}>{pdfText(title)}</Text>
      {lines.map((line, index) => <Text key={`${label}-${index}`} style={S.boxLine}>{line}</Text>)}
    </View>
  )
}

function counterpartRole(role: ContractRole): ContractRole {
  return role === 'donneur_ordre' ? 'sous_traitant' : 'donneur_ordre'
}

function cleanContractTitle(title: string): string {
  return pdfText(title).replace(/\s+générique/gi, '').trim()
}

function initials(name: string | null | undefined): string {
  return pdfText(name ?? 'AT')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'AT'
}

export default function ContractPDF({ snapshot }: { snapshot: ContractPdfSnapshot }) {
  const org = snapshot.organization
  const counterpartyClient = snapshot.counterparty.client ?? null
  const orgLines = compactLines([
    org?.forme_juridique,
    org?.address_line1,
    org?.address_line2,
    [org?.postal_code, org?.city].filter(Boolean).join(' '),
    org?.siret ? `SIRET : ${org.siret}` : org?.siren ? `SIREN : ${org.siren}` : null,
    org?.vat_number ? `TVA : ${org.vat_number}` : null,
    org?.email,
    org?.phone,
  ])
  const counterpartyLines = compactLines([
    snapshot.counterparty.address
      || [counterpartyClient?.address_line1, counterpartyClient?.postal_code, counterpartyClient?.city].filter(Boolean).join(' '),
    counterpartyClient?.siret ? `SIRET : ${counterpartyClient.siret}` : counterpartyClient?.siren ? `SIREN : ${counterpartyClient.siren}` : null,
    counterpartyClient?.vat_number ? `TVA : ${counterpartyClient.vat_number}` : null,
    counterpartyClient?.contact_name ? `Contact : ${counterpartyClient.contact_name}` : null,
    snapshot.counterparty.email ?? counterpartyClient?.email,
    snapshot.counterparty.phone ?? counterpartyClient?.phone,
  ])
  const chantierLines = compactLines([
    snapshot.chantier?.address_line1,
    [snapshot.chantier?.postal_code, snapshot.chantier?.city].filter(Boolean).join(' '),
    snapshot.chantier?.start_date ? `Début prévu : ${fmtDate(snapshot.chantier.start_date)}` : null,
    snapshot.chantier?.estimated_end_date ? `Fin estimée : ${fmtDate(snapshot.chantier.estimated_end_date)}` : null,
  ])

  return (
    <Document
      title={snapshot.contract.title}
      author={org?.name ?? 'ATELIER'}
      subject={snapshot.reference}
      creator="ATELIER"
      producer="ATELIER"
    >
      <Page size="A4" style={S.page} wrap>
        <View style={S.header}>
          <View style={S.headerLeft}>
            {org?.logo_url ? (
              <Image src={org.logo_url} style={S.logo} />
            ) : (
              <View style={S.logoPlaceholder}>
                <Text style={S.logoPlaceholderText}>{initials(org?.name)}</Text>
              </View>
            )}
          </View>
          <View style={S.metaBox}>
            <Text style={S.smallLine}>Référence : {pdfText(snapshot.reference)}</Text>
            <Text style={S.smallLine}>Généré le {fmtDate(snapshot.generatedAt)}</Text>
          </View>
        </View>

        <View style={S.titleBlock}>
          <Text style={S.titleLabel}>{CONTRACT_TYPE_LABELS[snapshot.contract.type]}</Text>
          <Text style={S.titleSub}>{cleanContractTitle(snapshot.contract.title)}</Text>
          <View style={S.accent} />
        </View>

        <View style={S.row}>
          <PartyBlock
            label={getRoleLabel(snapshot.contract.role, snapshot.contract.type)}
            title={org?.name ?? 'Organisation'}
            lines={orgLines}
          />
          <PartyBlock
            label={getRoleLabel(counterpartRole(snapshot.contract.role), snapshot.contract.type)}
            title={snapshot.counterparty.name}
            lines={counterpartyLines}
          />
        </View>

        {snapshot.chantier && (
          <View style={S.row}>
            <PartyBlock label="Chantier lié" title={snapshot.chantier.title} lines={chantierLines} />
            <View style={S.box}>
              <Text style={S.boxLabel}>Cadre</Text>
              <Text style={S.boxLine}>Type : {CONTRACT_TYPE_LABELS[snapshot.contract.type]}</Text>
              <Text style={S.boxLine}>Référence : {pdfText(snapshot.reference)}</Text>
            </View>
          </View>
        )}

        <Text style={S.sectionTitle}>Clauses</Text>
        {CLAUSE_ORDER.map(key => (
          <View key={key} style={S.clause} wrap={false}>
            <Text style={S.clauseTitle}>{CLAUSE_LABELS[key]}</Text>
            <Text style={S.clauseText}>{pdfText(snapshot.contract.clauses[key])}</Text>
          </View>
        ))}

        {(snapshot.contract.customSections ?? []).map(section => (
          <View key={section.id} style={S.clause} wrap={false}>
            <Text style={S.clauseTitle}>{pdfText(section.title)}</Text>
            <Text style={S.clauseText}>{pdfText(section.content)}</Text>
          </View>
        ))}

        <View style={S.jurisdiction} wrap={false}>
          <Text style={S.clauseTitle}>Tribunal compétent</Text>
          <Text style={S.jurisdictionText}>
            {pdfText(org?.court_competent
              ? `En cas de litige relatif au présent contrat, le tribunal compétent est : ${org.court_competent}.`
              : 'En cas de litige relatif au présent contrat, le tribunal compétent sera déterminé conformément aux règles applicables.'
            )}
          </Text>
        </View>

        <View style={S.signatures} wrap={false}>
          <View style={S.signatureBox}>
            <Text style={S.signatureTitle}>Pour {pdfText(org?.name ?? 'l’organisation')}</Text>
            <Text style={S.signatureLine}>Nom : <Text style={S.signatureValue}>{pdfText(org?.signatory_name ?? '')}</Text></Text>
            <Text style={S.signatureLine}>Qualité : <Text style={S.signatureValue}>{pdfText(org?.signatory_role ?? '')}</Text></Text>
            <Text style={S.signatureLine}>Date : <Text style={S.signatureValue}>{fmtDate(snapshot.generatedAt)}</Text></Text>
            <Text style={S.signatureLine}>Signature :</Text>
            {org?.signature_image ? (
              <Image src={org.signature_image} style={S.signatureImage} />
            ) : null}
          </View>
          <View style={S.signatureBox}>
            <Text style={S.signatureTitle}>Pour {pdfText(snapshot.counterparty.name)}</Text>
            <Text style={S.signatureLine}>Nom : <Text style={S.signatureValue}>{pdfText(snapshot.counterparty.signatory_name ?? '')}</Text></Text>
            <Text style={S.signatureLine}>Qualité : <Text style={S.signatureValue}>{pdfText(snapshot.counterparty.signatory_role ?? '')}</Text></Text>
            <Text style={S.signatureLine}>Date : <Text style={S.signatureValue}>{snapshot.counterparty.signed_at ? fmtDate(snapshot.counterparty.signed_at) : ''}</Text></Text>
            <Text style={S.signatureLine}>Signature :</Text>
            {snapshot.counterparty.signature_image ? (
              <Image src={snapshot.counterparty.signature_image} style={S.signatureImage} />
            ) : null}
          </View>
        </View>

        <View style={S.footer} fixed>
          <Text style={S.footerText}>{pdfText(snapshot.reference)}</Text>
          <Text style={S.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber}/${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
