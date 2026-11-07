// @atelier-migrated
// Logique pure des contrats : formulaire, filtre, statistiques. Aucun état React ici.

export { PAGE_SIZE, paginate } from '@/lib/pagination'

import type { Chantier } from '@/lib/data/queries/chantiers'
import type { Client } from '@/lib/data/queries/clients'
import type { ContractListItem, ContractTemplateOption } from '@/lib/data/queries/contracts'
import type { Quote } from '@/lib/data/queries/quotes'
import {
  CLAUSE_LABELS,
  type ContractClauseKey,
  type ContractClauses,
  type ContractCustomSection,
  type ContractRole,
  type ContractStatus,
  type ContractType,
} from '@/lib/contracts/templates'

export type ContractFormState = {
  title: string
  contractType: ContractType
  role: ContractRole
  clientId: string
  chantierId: string
  quoteId: string
  counterpartyName: string
  counterpartyEmail: string
  counterpartyPhone: string
  counterpartyAddress: string
  templateKey: string
  clauses: ContractClauses
  customSections: ContractCustomSection[]
  durationText: string
}

export const CLAUSE_ORDER = Object.keys(CLAUSE_LABELS) as ContractClauseKey[]

export const STATUS_LABELS: Record<ContractStatus, { label: string; status: 'neutral' | 'wait' | 'success' }> = {
  draft: { label: 'Brouillon', status: 'neutral' },
  sent: { label: 'Envoyé', status: 'wait' },
  signed: { label: 'Signé', status: 'success' },
  archived: { label: 'Archivé', status: 'neutral' },
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat('fr-FR').format(new Date(value))
}

export function clientName(client: Client): string {
  return client.company_name || client.contact_name || [client.first_name, client.last_name].filter(Boolean).join(' ') || client.email || 'Client sans nom'
}

export function firstTemplateFor(type: ContractType, templates: ContractTemplateOption[]) {
  return templates.find(template => template.type === type) ?? templates[0]
}

export function buildInitialForm(templates: ContractTemplateOption[], contract?: ContractListItem | null): ContractFormState {
  if (contract) {
    return {
      title: contract.title,
      contractType: contract.contract_type,
      role: contract.role,
      clientId: contract.client_id ?? '',
      chantierId: contract.chantier_id ?? '',
      quoteId: contract.quote_id ?? '',
      counterpartyName: contract.counterparty_name,
      counterpartyEmail: contract.counterparty_email ?? '',
      counterpartyPhone: contract.counterparty_phone ?? '',
      counterpartyAddress: contract.counterparty_address ?? '',
      templateKey: contract.template_key,
      clauses: contract.clauses,
      customSections: contract.custom_sections ?? [],
      durationText: contract.duration_text ?? '',
    }
  }

  const template = firstTemplateFor('sous_traitance', templates)
  return {
    title: '',
    contractType: 'sous_traitance',
    role: 'donneur_ordre',
    clientId: '',
    chantierId: '',
    quoteId: '',
    counterpartyName: '',
    counterpartyEmail: '',
    counterpartyPhone: '',
    counterpartyAddress: '',
    templateKey: template?.key ?? '',
    clauses: template?.clauses ?? {} as ContractClauses,
    customSections: template?.customSections ?? [],
    durationText: '',
  }
}

function addressOf(client: Client) {
  return [client.address_line1, client.postal_code, client.city].filter(Boolean).join(', ')
}

/** Changer le type reprend le premier modèle de ce type. */
export function applyContractType(form: ContractFormState, nextType: ContractType, templates: ContractTemplateOption[]): ContractFormState {
  const template = firstTemplateFor(nextType, templates)
  return {
    ...form,
    contractType: nextType,
    templateKey: template?.key ?? '',
    clauses: template?.clauses ?? form.clauses,
    customSections: template?.customSections ?? [],
  }
}

export function applyContractTemplate(form: ContractFormState, templateKey: string, templates: ContractTemplateOption[]): ContractFormState {
  const template = templates.find(item => item.key === templateKey)
  if (!template) return form
  return { ...form, templateKey, clauses: template.clauses, customSections: template.customSections ?? [] }
}

/** Choisir un client remplit la partie contractante et écarte un devis d'un autre client. */
export function applyContractClient(form: ContractFormState, clientId: string, clients: Client[], quotes: Quote[]): ContractFormState {
  const client = clients.find(item => item.id === clientId)
  const quoteStillValid = form.quoteId ? quotes.some(q => q.id === form.quoteId && q.client?.id === clientId) : true
  return {
    ...form,
    clientId,
    quoteId: quoteStillValid ? form.quoteId : '',
    counterpartyName: client ? clientName(client) : '',
    counterpartyEmail: client?.email ?? '',
    counterpartyPhone: client?.phone ?? '',
    counterpartyAddress: client ? addressOf(client) : '',
  }
}

/** Choisir un chantier reprend son client, s'il en a un. */
export function applyContractChantier(form: ContractFormState, chantierId: string, chantiers: Chantier[], clients: Client[]): ContractFormState {
  const chantier = chantiers.find(item => item.id === chantierId)
  const linkedClientId = chantier?.client?.id ?? ''
  const client = linkedClientId ? clients.find(item => item.id === linkedClientId) : null
  return {
    ...form,
    chantierId,
    clientId: linkedClientId || form.clientId,
    counterpartyName: client ? clientName(client) : form.counterpartyName,
    counterpartyEmail: client?.email ?? form.counterpartyEmail,
    counterpartyPhone: client?.phone ?? form.counterpartyPhone,
    counterpartyAddress: client ? addressOf(client) : form.counterpartyAddress,
  }
}

export function contractPayload(form: ContractFormState) {
  return {
    title: form.title,
    contractType: form.contractType,
    role: form.role,
    clientId: form.clientId || null,
    chantierId: form.chantierId || null,
    quoteId: form.quoteId || null,
    counterpartyName: form.counterpartyName,
    counterpartyEmail: form.counterpartyEmail || null,
    counterpartyPhone: form.counterpartyPhone || null,
    counterpartyAddress: form.counterpartyAddress || null,
    templateKey: form.templateKey,
    clauses: form.clauses,
    customSections: form.customSections,
    durationText: form.durationText.trim() || null,
  }
}

/** Devis proposés : ceux du client choisi, sinon tous les devis numérotés. */
export function availableQuotesFor(form: Pick<ContractFormState, 'clientId'>, quotes: Quote[]) {
  return form.clientId ? quotes.filter(q => q.client?.id === form.clientId && q.number) : quotes.filter(q => q.number)
}

export function filterContracts(contracts: ContractListItem[], query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return contracts
  return contracts.filter(contract =>
    contract.title.toLowerCase().includes(q)
    || contract.counterparty_name.toLowerCase().includes(q)
    || contract.template_title.toLowerCase().includes(q)
    || (contract.pdf_reference ?? '').toLowerCase().includes(q),
  )
}

export function contractStats(contracts: ContractListItem[]) {
  return {
    total: contracts.length,
    draft: contracts.filter(contract => contract.status === 'draft').length,
    signed: contracts.filter(contract => contract.status === 'signed').length,
    generated: contracts.filter(contract => contract.pdf_generated_at).length,
  }
}
