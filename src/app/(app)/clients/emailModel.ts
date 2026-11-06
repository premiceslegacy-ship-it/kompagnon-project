// @atelier-migrated
// Logique pure de l'email groupé : destinataires, filtre d'envoi, libellés. Aucun état React ici.

import type { Client } from '@/lib/data/queries/clients'
import { getClientDisplayName } from '@/lib/client'

export type BroadcastFilter =
  | { mode: 'all' }
  | { mode: 'all_active' }
  | { mode: 'by_status'; statuses: string[] }
  | { mode: 'manual'; ids: string[] }

// 'all' = tous les contacts, sans pré-sélection de groupe
export type CategoryFilter = 'all' | 'active' | 'prospect' | 'lead_hot' | 'lead_cold' | 'subcontractor' | 'inactive'

export const CATEGORY_OPTIONS: { value: CategoryFilter; label: string }[] = [
  { value: 'all', label: 'Tous les contacts' },
  { value: 'active', label: 'Clients actifs' },
  { value: 'prospect', label: 'Prospects' },
  { value: 'lead_hot', label: 'Leads chauds' },
  { value: 'lead_cold', label: 'Leads froids' },
  { value: 'subcontractor', label: 'Sous-traitants' },
  { value: 'inactive', label: 'Inactifs' },
]

export const TONE_OPTIONS = [
  { value: 'professionnel', label: 'Professionnel' },
  { value: 'chaleureux', label: 'Chaleureux' },
  { value: 'neutre', label: 'Neutre' },
]

export function buildFilter(selectedIds: string[], category: CategoryFilter): BroadcastFilter {
  if (selectedIds.length > 0) return { mode: 'manual', ids: selectedIds }
  if (category === 'all') return { mode: 'all' }
  if (category === 'active') return { mode: 'all_active' }
  return { mode: 'by_status', statuses: [category] }
}

export function contactsWithEmail(clients: Client[]): Client[] {
  return clients.filter(c => c.email && c.email.trim() !== '')
}

/** Contacts proposés : ceux de la catégorie, puis filtrés par la recherche (nom ou e-mail). */
export function visibleContactsFor(clients: Client[], category: CategoryFilter, search: string): Client[] {
  let list = category === 'all' ? contactsWithEmail(clients) : contactsWithEmail(clients).filter(c => c.status === category)
  const needle = search.trim().toLowerCase()
  if (needle) {
    list = list.filter(c => getClientDisplayName(c).toLowerCase().includes(needle) || (c.email ?? '').toLowerCase().includes(needle))
  }
  return list
}

/** Nombre de destinataires réels : la sélection manuelle, sinon toute la catégorie. */
export function recipientCountFor(clients: Client[], category: CategoryFilter, selectedCount: number): number {
  if (selectedCount > 0) return selectedCount
  const withEmail = contactsWithEmail(clients)
  return category === 'all' ? withEmail.length : withEmail.filter(c => c.status === category).length
}

export function recipientLabelFor(category: CategoryFilter, selectedCount: number): string {
  if (selectedCount > 0) return `${selectedCount} contact${selectedCount > 1 ? 's' : ''} sélectionné${selectedCount > 1 ? 's' : ''}`
  return CATEGORY_OPTIONS.find(o => o.value === category)?.label ?? category
}
