import { createAdminClient } from '@/lib/supabase/admin'
import { z } from 'zod'
import type { ContractStatus } from '@/lib/contracts/templates'
import type { ContractPdfSnapshot } from '@/lib/pdf/documents/contract'

export type ContractDocumentPublicationRecord = {
  id: string
  organization_id: string
  status: string
  sent_at: string | null
  signed_at: string | null
  client_signed_at: string | null
  client_signature_image: string | null
  client_signatory_name: string | null
  client_signatory_role: string | null
  pdf_reference: string | null
  signature_document_hash: string | null
  pdf_snapshot: unknown
  linked_quote_document: unknown
}

const nonBlankTextSchema = z.string().refine(value => value.trim().length > 0)
const nullableTextSchema = z.string().nullable()

const contractStatusSchema: z.ZodType<ContractStatus> = z.enum(['draft', 'sent', 'signed', 'archived'])

const contractDocumentSnapshotSchema = z.object({
  organizationId: nonBlankTextSchema.optional(),
  generatedAt: nonBlankTextSchema,
  reference: nonBlankTextSchema,
  disclaimer: nonBlankTextSchema.optional(),
  contract: z.object({
    id: nonBlankTextSchema,
    title: nonBlankTextSchema,
    type: z.enum(['sous_traitance', 'maintenance']),
    role: z.enum(['donneur_ordre', 'sous_traitant']),
    status: contractStatusSchema,
    templateTitle: nonBlankTextSchema,
    clauses: z.object({
      objet: nonBlankTextSchema,
      duree: nonBlankTextSchema,
      prix: nonBlankTextSchema,
      obligations: nonBlankTextSchema,
      assurances: nonBlankTextSchema,
      securite: nonBlankTextSchema,
      confidentialite: nonBlankTextSchema,
      resiliation: nonBlankTextSchema,
      annexes: nonBlankTextSchema,
    }).passthrough(),
    customSections: z.array(z.object({
      id: nonBlankTextSchema,
      title: nonBlankTextSchema,
      content: z.string(),
    }).passthrough()).optional(),
  }).passthrough(),
  organization: z.object({
    name: nonBlankTextSchema,
    email: nullableTextSchema,
    phone: nullableTextSchema,
    address_line1: nullableTextSchema,
    address_line2: nullableTextSchema,
    postal_code: nullableTextSchema,
    city: nullableTextSchema,
    country: nullableTextSchema,
    siret: nullableTextSchema,
    siren: nullableTextSchema,
    vat_number: nullableTextSchema,
    logo_url: nullableTextSchema,
    forme_juridique: nullableTextSchema,
    capital_social: z.union([z.string(), z.number().finite()]).nullable(),
    rcs: nullableTextSchema,
    rcs_ville: nullableTextSchema,
    insurance_info: nullableTextSchema,
    court_competent: nullableTextSchema.optional(),
    decennale_enabled: z.boolean().nullable().optional(),
    decennale_assureur: nullableTextSchema.optional(),
    decennale_police: nullableTextSchema.optional(),
    signatory_name: nullableTextSchema.optional(),
    signatory_role: nullableTextSchema.optional(),
    signature_image: nullableTextSchema.optional(),
  }).passthrough().nullable(),
  counterparty: z.object({
    name: nonBlankTextSchema,
    email: nullableTextSchema,
    phone: nullableTextSchema,
    address: nullableTextSchema,
    signature_image: nullableTextSchema.optional(),
    signatory_name: nullableTextSchema.optional(),
    signatory_role: nullableTextSchema.optional(),
    signed_at: nullableTextSchema.optional(),
    client: z.object({
      type: nullableTextSchema.optional(),
      company_name: nullableTextSchema.optional(),
      contact_name: nullableTextSchema.optional(),
      first_name: nullableTextSchema.optional(),
      last_name: nullableTextSchema.optional(),
      email: nullableTextSchema.optional(),
      phone: nullableTextSchema.optional(),
      address_line1: nullableTextSchema.optional(),
      postal_code: nullableTextSchema.optional(),
      city: nullableTextSchema.optional(),
      siret: nullableTextSchema.optional(),
      siren: nullableTextSchema.optional(),
      vat_number: nullableTextSchema.optional(),
    }).passthrough().nullable().optional(),
  }).passthrough(),
  chantier: z.object({
    title: nonBlankTextSchema,
    address_line1: nullableTextSchema,
    postal_code: nullableTextSchema,
    city: nullableTextSchema,
    start_date: nullableTextSchema,
    estimated_end_date: nullableTextSchema,
    budget_ht: z.number().finite().nullable(),
  }).passthrough().nullable(),
}).passthrough()

/**
 * Render only a persisted publication. Signature/lifecycle fields are overlaid
 * from the current row; its legal terms, parties, reference and generatedAt
 * remain the immutable publication captured before consent.
 */
export function contractDocumentSnapshotFromPublication(
  record: ContractDocumentPublicationRecord,
): ContractPdfSnapshot | null {
  const parsed = contractDocumentSnapshotSchema.safeParse(record.pdf_snapshot)
  const parsedStatus = contractStatusSchema.safeParse(record.status)
  if (
    !parsed.success
    || !parsedStatus.success
    || parsed.data.contract.id !== record.id
  ) return null
  const snapshot = parsed.data
  if (
    snapshot.reference !== record.pdf_reference
    || (snapshot.organizationId !== undefined && snapshot.organizationId !== record.organization_id)
    || (parsedStatus.data === 'sent' && (
      snapshot.organizationId !== record.organization_id
      || !record.signature_document_hash
    ))
    || (record.signature_document_hash !== null && !/^[0-9a-f]{64}$/.test(record.signature_document_hash))
  ) return null

  return {
    ...snapshot,
    contract: {
      ...snapshot.contract,
      status: parsedStatus.data,
    },
    counterparty: {
      ...snapshot.counterparty,
      signature_image: record.client_signature_image ?? snapshot.counterparty.signature_image ?? null,
      signatory_name: record.client_signatory_name ?? snapshot.counterparty.signatory_name ?? null,
      signatory_role: record.client_signatory_role ?? snapshot.counterparty.signatory_role ?? null,
      signed_at: record.client_signed_at ?? snapshot.counterparty.signed_at ?? null,
    },
  }
}

export async function contractDocumentSnapshotFromVerifiedPublication(
  record: ContractDocumentPublicationRecord,
): Promise<ContractPdfSnapshot | null> {
  const snapshot = contractDocumentSnapshotFromPublication(record)
  if (!snapshot) return null
  if (!record.signature_document_hash) return record.status === 'sent' ? null : snapshot
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('verify_contract_document_publication', {
    p_contract_id: record.id,
    p_organization_id: record.organization_id,
    p_expected_hash: record.signature_document_hash,
    p_pdf_snapshot: record.pdf_snapshot,
    p_linked_quote_document: record.linked_quote_document,
  })
  if (error) throw error
  return data === true ? snapshot : null
}

