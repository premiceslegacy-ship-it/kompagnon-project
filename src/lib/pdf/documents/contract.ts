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
import { pdfText } from '@/lib/pdf/pdf-design-system'
import { PdfDoc } from '../engine/doc'
import type { FontBytes } from '../engine/fonts'
import { loadFontBytes } from '../engine/fonts'
import { embedImage } from '../engine/image'
import {
  drawClause, drawCompactHeader, drawHeader, drawMeta, drawNote, drawParties, drawSectionHeading, drawSignatureBoxes, installFooter,
} from '../engine/kit'
import { legalFooterLines } from '../engine/legal'

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
  const [year, month, day] = part.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
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
    org?.address_line1,
    org?.address_line2,
    [org?.postal_code, org?.city].filter(Boolean).join(' '),
    [org?.email, org?.phone].filter(Boolean).join(' · '),
    org?.siret ? `SIRET ${org.siret}` : org?.siren ? `SIREN ${org.siren}` : null,
    org?.vat_number ? `TVA ${org.vat_number}` : null,
  ])
  const counterpartyLines = compactLines([
    snapshot.counterparty.address || [counterpartyClient?.address_line1, counterpartyClient?.postal_code, counterpartyClient?.city].filter(Boolean).join(' '),
    counterpartyClient?.contact_name ? `Contact : ${counterpartyClient.contact_name}` : null,
    [snapshot.counterparty.email ?? counterpartyClient?.email, snapshot.counterparty.phone ?? counterpartyClient?.phone].filter(Boolean).join(' · '),
    counterpartyClient?.siret ? `SIRET ${counterpartyClient.siret}` : counterpartyClient?.siren ? `SIREN ${counterpartyClient.siren}` : null,
    counterpartyClient?.vat_number ? `TVA ${counterpartyClient.vat_number}` : null,
  ])
  const chantierLines = compactLines([
    snapshot.chantier?.title,
    [snapshot.chantier?.address_line1, [snapshot.chantier?.postal_code, snapshot.chantier?.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    snapshot.chantier?.start_date ? `début prévu le ${fmtDate(snapshot.chantier.start_date)}` : null,
    snapshot.chantier?.estimated_end_date ? `fin estimée le ${fmtDate(snapshot.chantier.estimated_end_date)}` : null,
  ])

  const logoImg = org?.logo_url ? await embedImage(doc.doc, org.logo_url) : null
  const orgSignatureImg = org?.signature_image ? await embedImage(doc.doc, org.signature_image) : null
  const counterpartySignatureImg = snapshot.counterparty.signature_image ? await embedImage(doc.doc, snapshot.counterparty.signature_image) : null

  const brand = { logo: logoImg, name: org?.name ?? 'Organisation' }
  const heading = { title: pdfText(CONTRACT_TYPE_LABELS[snapshot.contract.type]), number: snapshot.reference }
  doc.onNewPage = ({ pageIndex }) => pageIndex === 0 ? drawHeader(doc, brand, heading) : drawCompactHeader(doc, brand, heading)
  installFooter(doc, org ? legalFooterLines({ ...org, certifications: null }) : [])
  doc.addPage()

  drawMeta(doc, [
    { label: 'Date', value: fmtLongDate(snapshot.generatedAt) },
    { label: 'Référence', value: snapshot.reference },
    { label: 'Contrat', value: cleanContractTitle(snapshot.contract.title) },
  ])
  drawParties(
    doc,
    { label: getRoleLabel(snapshot.contract.role, snapshot.contract.type), name: org?.name ?? 'Organisation', lines: orgLines },
    { label: getRoleLabel(counterpartRole(snapshot.contract.role), snapshot.contract.type), name: snapshot.counterparty.name, lines: counterpartyLines },
  )
  if (snapshot.chantier) drawNote(doc, 'Chantier lié', chantierLines.join(' · '), 12)

  // ── Clauses ──
  drawSectionHeading(doc, 'Clauses', 18)
  for (const key of CLAUSE_ORDER) {
    drawClause(doc, CLAUSE_LABELS[key], pdfText(snapshot.contract.clauses[key]))
  }
  for (const section of snapshot.contract.customSections ?? []) {
    drawClause(doc, pdfText(section.title), pdfText(section.content))
  }
  drawClause(
    doc,
    'Tribunal compétent',
    org?.court_competent
      ? `En cas de litige relatif au présent contrat, le tribunal compétent est : ${org.court_competent}.`
      : 'En cas de litige relatif au présent contrat, le tribunal compétent sera déterminé conformément aux règles applicables.',
  )

  // ── Signatures ──
  drawSignatureBoxes(doc, [
    { title: `Pour ${pdfText(org?.name ?? "l'organisation")}`, name: org?.signatory_name, role: org?.signatory_role, date: fmtDate(snapshot.generatedAt), image: orgSignatureImg },
    { title: `Pour ${pdfText(snapshot.counterparty.name)}`, name: snapshot.counterparty.signatory_name, role: snapshot.counterparty.signatory_role, date: snapshot.counterparty.signed_at ? fmtDate(snapshot.counterparty.signed_at) : null, image: counterpartySignatureImg },
  ], 96)

  return doc.save()
}

const fmtLongDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
