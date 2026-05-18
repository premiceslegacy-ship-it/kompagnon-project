import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from './clients'
import { getOrganization } from './organization'
import {
  getContractTemplates,
  normalizeClauses,
  normalizeCustomSections,
  type ContractClauses,
  type ContractCustomSection,
  type ContractRole,
  type ContractStatus,
  type ContractTemplate,
  type ContractType,
} from '@/lib/contracts/templates'

export type ContractListItem = {
  id: string
  title: string
  contract_type: ContractType
  role: ContractRole
  status: ContractStatus
  counterparty_name: string
  counterparty_email: string | null
  counterparty_phone: string | null
  counterparty_address: string | null
  template_key: string
  template_title: string
  clauses: ContractClauses
  custom_sections: ContractCustomSection[]
  duration_text: string | null
  quote_id: string | null
  pdf_reference: string | null
  pdf_generated_at: string | null
  sent_at: string | null
  signed_at: string | null
  archived_at: string | null
  created_at: string
  client_id: string | null
  chantier_id: string | null
  client: { id: string; company_name: string | null; contact_name: string | null; first_name: string | null; last_name: string | null } | null
  chantier: { id: string; title: string } | null
  quote: { id: string; number: string | null; title: string | null; total_ttc: number | null } | null
}

export type ContractDetail = ContractListItem & {
  client_id: string | null
  chantier_id: string | null
  counterparty_email: string | null
  counterparty_phone: string | null
  counterparty_address: string | null
  clauses: ContractClauses
  pdf_snapshot: Record<string, unknown> | null
}

export type ContractTemplateOption = ContractTemplate

async function getCustomContractTemplates(orgId: string, type?: ContractType | null): Promise<ContractTemplateOption[]> {
  const supabase = await createClient()
  let query = supabase
    .from('contract_templates')
    .select('id, contract_type, title, trade, clauses, custom_sections')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (type) query = query.eq('contract_type', type)

  const { data, error } = await query
  if (error) {
    if (error.code !== '42P01') console.error('[getCustomContractTemplates]', error)
    return []
  }

  return (data ?? []).map((template: any) => ({
    key: `custom:${template.id}`,
    title: template.title,
    type: template.contract_type,
    trade: template.trade ?? 'personnalise',
    clauses: template.clauses,
    customSections: normalizeCustomSections(template.custom_sections),
    isCustom: true,
  }))
}

export async function getContracts(): Promise<ContractListItem[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('contracts')
    .select(`
      id, client_id, chantier_id, quote_id, title, contract_type, role, status,
      counterparty_name, counterparty_email, counterparty_phone, counterparty_address,
      template_key, template_title, clauses, custom_sections, duration_text, pdf_reference, pdf_generated_at,
      sent_at, signed_at, archived_at, created_at,
      client:clients(id, company_name, contact_name, first_name, last_name),
      chantier:chantiers(id, title),
      quote:quotes(id, number, title, total_ttc)
    `)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[getContracts]', error)
    return []
  }

  return (data ?? []).map((contract: any) => {
    const fallback = getContractTemplates(contract.contract_type as ContractType)
      .find(template => template.key === contract.template_key)?.clauses
    return {
      ...contract,
      clauses: fallback ? normalizeClauses(contract.clauses, fallback) : contract.clauses,
      custom_sections: normalizeCustomSections(contract.custom_sections),
    }
  }) as ContractListItem[]
}

export async function getContractById(contractId: string): Promise<ContractDetail | null> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return null

  const { data, error } = await supabase
    .from('contracts')
    .select(`
      id, organization_id, client_id, chantier_id, quote_id, title, contract_type, role, status,
      counterparty_name, counterparty_email, counterparty_phone, counterparty_address,
      template_key, template_title, clauses, custom_sections, duration_text, pdf_reference, pdf_generated_at, pdf_snapshot,
      sent_at, signed_at, archived_at, created_at,
      client:clients(id, company_name, contact_name, first_name, last_name),
      chantier:chantiers(id, title),
      quote:quotes(id, number, title, total_ttc)
    `)
    .eq('id', contractId)
    .eq('organization_id', orgId)
    .single()

  if (error || !data) {
    if (error) console.error('[getContractById]', error)
    return null
  }

  const templates = getContractTemplates(data.contract_type as ContractType)
  const fallback = templates.find(template => template.key === data.template_key)?.clauses ?? templates[0]?.clauses

  return {
    ...(data as unknown as ContractDetail),
    clauses: fallback ? normalizeClauses((data as any).clauses, fallback) : (data as any).clauses,
    custom_sections: normalizeCustomSections((data as any).custom_sections),
  }
}

export async function getContractTemplateOptions(type?: ContractType | null): Promise<ContractTemplateOption[]> {
  const org = await getOrganization()
  if (!org) return getContractTemplates(type, null)
  const [defaults, custom] = await Promise.all([
    Promise.resolve(getContractTemplates(type, org.business_activity_id ?? null)),
    getCustomContractTemplates(org.id, type),
  ])
  return [...custom, ...defaults]
}

export type AttachableDoc = {
  id: string
  label: string
  meta: string | null
}

/**
 * Retourne les devis et factures rattachés à un client (pour proposer en PJ lors d'un envoi de contrat).
 * Filtre les éléments dépourvus de PDF généré quand requis.
 */
export async function getClientDocsForAttachment(
  clientId: string,
): Promise<{ quotes: AttachableDoc[]; invoices: AttachableDoc[] }> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId || !clientId) return { quotes: [], invoices: [] }

  const [{ data: quotes }, { data: invoices }] = await Promise.all([
    supabase
      .from('quotes')
      .select('id, number, title, status, total_ttc')
      .eq('organization_id', orgId)
      .eq('client_id', clientId)
      .eq('is_archived', false)
      .not('number', 'is', null)
      .order('created_at', { ascending: false }),
    supabase
      .from('invoices')
      .select('id, number, title, status, total_ttc')
      .eq('organization_id', orgId)
      .eq('client_id', clientId)
      .eq('is_archived', false)
      .neq('status', 'cancelled')
      .not('number', 'is', null)
      .order('created_at', { ascending: false }),
  ])

  const fmtAmount = (n: number | null | undefined) =>
    typeof n === 'number'
      ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n)
      : null

  return {
    quotes: (quotes ?? []).map(q => ({
      id: q.id,
      label: q.number ? `${q.number} - ${q.title ?? ''}` : (q.title ?? 'Devis'),
      meta: fmtAmount(q.total_ttc),
    })),
    invoices: (invoices ?? []).map(i => ({
      id: i.id,
      label: i.number ? `${i.number} - ${i.title ?? ''}` : (i.title ?? 'Facture'),
      meta: fmtAmount(i.total_ttc),
    })),
  }
}

/**
 * Retourne les contrats du client (pour proposer en PJ lors d'un envoi de devis ou facture).
 */
export async function getClientContractsForAttachment(clientId: string): Promise<AttachableDoc[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId || !clientId) return []

  const { data } = await supabase
    .from('contracts')
    .select('id, title, contract_type, status, pdf_reference')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .neq('status', 'archived')
    .order('created_at', { ascending: false })

  const typeLabel: Record<string, string> = { sous_traitance: 'Sous-traitance', maintenance: 'Maintenance' }
  return (data ?? []).map(c => ({
    id: c.id,
    label: c.title,
    meta: typeLabel[c.contract_type as string] ?? c.contract_type,
  }))
}
