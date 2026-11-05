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
import { fmtCapitalSocial, pdfText } from '@/lib/pdf/pdf-design-system'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { embedImage } from '../engine/image'
import {
  drawCardRow, drawCentered, drawMeta, drawParagraphs, drawParties, drawSectionTitle,
  legalFooterLines, setupChrome, signatureCard,
} from '../engine/layout'

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
    capital_social: string | number | null
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
  const [year, month, day] = part.split('-').map(Number)
  if (!year || !month || !day) return value
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function compactLines(lines: Array<string | null | undefined>): string[] {
  return lines.map(line => pdfText(line).trim()).filter(Boolean)
}

function counterpartRole(role: ContractRole): ContractRole {
  return role === 'donneur_ordre' ? 'sous_traitant' : 'donneur_ordre'
}

function cleanContractTitle(title: string): string {
  return pdfText(title).replace(/\s+générique/gi, '').trim()
}

export async function renderContractPdf(snapshot: ContractPdfSnapshot, origin: string): Promise<Buffer> {
  const fontBytes = await loadFontBytes(origin)
  return renderContractPdfWithFonts(snapshot, fontBytes)
}

export async function renderContractPdfWithFonts(snapshot: ContractPdfSnapshot, fontBytes: FontBytes): Promise<Buffer> {
  const doc = await PdfDoc.create(fontBytes)

  const org = snapshot.organization
  const counterpartyClient = snapshot.counterparty.client ?? null
  const orgLines = compactLines([
    org?.forme_juridique,
    [org?.address_line1, org?.address_line2, [org?.postal_code, org?.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    [org?.siret ? `SIRET ${org.siret}` : org?.siren ? `SIREN ${org.siren}` : null, org?.vat_number ? `TVA ${org.vat_number}` : null].filter(Boolean).join(' · '),
    [org?.email, org?.phone].filter(Boolean).join(' · '),
  ])
  const counterpartyLines = compactLines([
    snapshot.counterparty.address || [counterpartyClient?.address_line1, counterpartyClient?.postal_code, counterpartyClient?.city].filter(Boolean).join(' '),
    [
      counterpartyClient?.siret ? `SIRET ${counterpartyClient.siret}` : counterpartyClient?.siren ? `SIREN ${counterpartyClient.siren}` : null,
      counterpartyClient?.vat_number ? `TVA ${counterpartyClient.vat_number}` : null,
    ].filter(Boolean).join(' · '),
    counterpartyClient?.contact_name ? `Contact : ${counterpartyClient.contact_name}` : null,
    [snapshot.counterparty.email ?? counterpartyClient?.email, snapshot.counterparty.phone ?? counterpartyClient?.phone].filter(Boolean).join(' · '),
  ])

  const logoImg = org?.logo_url ? await embedImage(doc.doc, org.logo_url) : null
  const orgSignatureImg = org?.signature_image ? await embedImage(doc.doc, org.signature_image) : null
  const counterpartySignatureImg = snapshot.counterparty.signature_image ? await embedImage(doc.doc, snapshot.counterparty.signature_image) : null

  const typeLabel = pdfText(CONTRACT_TYPE_LABELS[snapshot.contract.type])
  setupChrome(doc, {
    title: `Contrat de ${typeLabel.toLowerCase()}`,
    reference: snapshot.reference,
    logo: logoImg,
    orgName: org?.name ?? 'Organisation',
    footerLines: org
      ? legalFooterLines(org, { isVatSubject: true, capital: fmtCapitalSocial(org.capital_social) })
      : [pdfText(snapshot.reference)],
  })
  doc.addPage()

  // ── Métadonnées ──
  const chantier = snapshot.chantier
  drawMeta(doc, [
    { label: 'Date', value: fmtDate(snapshot.generatedAt) },
    { label: 'Contrat', value: cleanContractTitle(snapshot.contract.title) },
    { label: 'Chantier', value: chantier ? pdfText(chantier.title) : '' },
  ])

  // ── Parties ──
  drawParties(doc,
    { label: getRoleLabel(snapshot.contract.role, snapshot.contract.type), name: org?.name ?? 'Organisation', lines: orgLines },
    { label: getRoleLabel(counterpartRole(snapshot.contract.role), snapshot.contract.type), name: snapshot.counterparty.name, lines: counterpartyLines },
  )

  // ── Chantier lié ──
  if (chantier) {
    const parts = compactLines([
      [chantier.address_line1, [chantier.postal_code, chantier.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      chantier.start_date ? `Début prévu : ${fmtDate(chantier.start_date)}` : null,
      chantier.estimated_end_date ? `Fin estimée : ${fmtDate(chantier.estimated_end_date)}` : null,
    ])
    drawCentered(doc, 'Chantier lié', [pdfText(chantier.title), ...parts].join(' · '), { marginTop: 13.5 })
  }

  // ── Clauses ──
  for (const key of CLAUSE_ORDER) {
    drawSectionTitle(doc, CLAUSE_LABELS[key])
    drawParagraphs(doc, snapshot.contract.clauses[key])
  }
  for (const section of snapshot.contract.customSections ?? []) {
    drawSectionTitle(doc, pdfText(section.title))
    drawParagraphs(doc, section.content)
  }

  // ── Tribunal compétent ──
  drawSectionTitle(doc, 'Tribunal compétent')
  drawParagraphs(doc, org?.court_competent
    ? `En cas de litige relatif au présent contrat, le tribunal compétent est : ${org.court_competent}.`
    : 'En cas de litige relatif au présent contrat, le tribunal compétent sera déterminé conformément aux règles applicables.')

  // ── Signatures, en bas de la dernière page ──
  const identity = (name: string | null | undefined, role: string | null | undefined, date: string) =>
    [`Nom : ${pdfText(name ?? '')}`, `Qualité : ${pdfText(role ?? '')}`, `Date : ${date}`]
  const orgLines2 = identity(org?.signatory_name, org?.signatory_role, fmtDate(snapshot.generatedAt))
  const cpLines = identity(snapshot.counterparty.signatory_name, snapshot.counterparty.signatory_role, snapshot.counterparty.signed_at ? fmtDate(snapshot.counterparty.signed_at) : '')
  drawCardRow(doc, [
    signatureCard(doc, `Pour ${pdfText(org?.name ?? "l'organisation")}`, 'Date et signature', orgSignatureImg ? { signed: { lines: orgLines2, image: orgSignatureImg } } : { lines: orgLines2 }),
    signatureCard(doc, `Pour ${pdfText(snapshot.counterparty.name)}`, 'Date, signature précédée de « Lu et approuvé »', counterpartySignatureImg ? { signed: { lines: cpLines, image: counterpartySignatureImg } } : { lines: cpLines }),
  ], { pin: true, marginTop: 18 })

  return doc.save()
}
