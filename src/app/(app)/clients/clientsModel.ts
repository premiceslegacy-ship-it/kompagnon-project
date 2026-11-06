// @atelier-migrated
// Logique pure des clients : statuts, suivi des relances, import CSV, filtre et tri. Aucun état React ici.

import type { Client } from '@/lib/data/queries/clients'
import { getClientDisplayName } from '@/lib/client'

export { PAGE_SIZE, paginate } from '@/lib/pagination'

export function clientDisplayName(client: Client): string {
  return getClientDisplayName(client)
}

export type ClientStatusPill = { label: string; status: 'wait' | 'success' | 'danger' | 'neutral' }

export function statusPill(status: string | null): ClientStatusPill {
  switch (status) {
    case 'active': return { label: 'Client', status: 'success' }
    case 'prospect': return { label: 'Prospect', status: 'wait' }
    case 'lead_hot': return { label: 'Lead chaud', status: 'wait' }
    case 'lead_cold': return { label: 'Lead froid', status: 'neutral' }
    case 'subcontractor': return { label: 'Sous-traitant', status: 'neutral' }
    case 'inactive': return { label: 'Inactif', status: 'neutral' }
    default: return { label: status ?? '/', status: 'neutral' }
  }
}

export const LEAD_STATUSES = ['lead_hot', 'lead_cold', 'prospect']

export function isLead(client: Pick<Client, 'status'>): boolean {
  return LEAD_STATUSES.includes(client.status ?? '')
}

// Signale les contacts qui méritent une relance : devis en attente de réponse,
// ou lead/prospect sans aucune interaction depuis 14 jours.
export const FOLLOWUP_IDLE_DAYS = 14

export type FollowupState =
  | { kind: 'pending_quotes'; label: string }
  | { kind: 'idle_lead'; label: string }
  | { kind: 'ok'; label: string }

export function followupState(client: Client, now = Date.now()): FollowupState {
  if ((client.pending_quotes ?? 0) > 0) {
    return { kind: 'pending_quotes', label: `${client.pending_quotes} devis en attente` }
  }
  if (LEAD_STATUSES.includes(client.status ?? '')) {
    const reference = client.last_activity_at ?? client.created_at
    const idleDays = Math.floor((now - new Date(reference).getTime()) / 86400000)
    if (idleDays >= FOLLOWUP_IDLE_DAYS) {
      return { kind: 'idle_lead', label: client.last_activity_at ? `Sans échange depuis ${idleDays} j` : `Jamais contacté (${idleDays} j)` }
    }
  }
  return { kind: 'ok', label: '—' }
}

export function needsFollowup(client: Client, now = Date.now()): boolean {
  return followupState(client, now).kind !== 'ok'
}

export const SOURCE_OPTIONS = [
  { value: '', label: 'Non renseignée' },
  { value: 'bouche_a_oreille', label: 'Bouche à oreille' },
  { value: 'recommandation', label: 'Recommandation client' },
  { value: 'site_web', label: 'Site web' },
  { value: 'reseaux_sociaux', label: 'Réseaux sociaux' },
  { value: 'formulaire_public', label: 'Formulaire public' },
  { value: 'appel_entrant', label: 'Appel entrant' },
  { value: 'salon_evenement', label: 'Salon / Événement' },
  { value: 'autre', label: 'Autre' },
]

export function sourceLabel(source: string | null): string {
  if (!source) return '/'
  return SOURCE_OPTIONS.find(o => o.value === source)?.label ?? source
}

export const STATUS_FILTERS = [
  { value: 'All', label: 'Tous' },
  { value: 'followup', label: 'À relancer' },
  { value: 'active', label: 'Clients' },
  { value: 'prospect', label: 'Prospects' },
  { value: 'lead_hot', label: 'Leads chauds' },
  { value: 'lead_cold', label: 'Leads froids' },
  { value: 'subcontractor', label: 'Sous-traitants' },
  { value: 'inactive', label: 'Inactifs' },
]

export const SORT_OPTIONS = [
  { value: 'created_at', label: 'Plus récents' },
  { value: 'name', label: 'Nom' },
  { value: 'revenue_desc', label: 'Chiffre d\'affaires' },
]

export const CURRENCY_OPTIONS = [
  { value: 'EUR', label: 'EUR : Euro (€)' },
  { value: 'USD', label: 'USD : Dollar US ($)' },
  { value: 'GBP', label: 'GBP : Livre sterling (£)' },
  { value: 'CHF', label: 'CHF : Franc suisse' },
  { value: 'CAD', label: 'CAD : Dollar canadien' },
  { value: 'MAD', label: 'MAD : Dirham marocain' },
  { value: 'DZD', label: 'DZD : Dinar algérien' },
  { value: 'TND', label: 'TND : Dinar tunisien' },
  { value: 'XOF', label: 'XOF : Franc CFA' },
  { value: 'AED', label: 'AED : Dirham émirati' },
]

export function filterClients(clients: Client[], search: string, status: string, now = Date.now()): Client[] {
  const needle = search.toLowerCase()
  return clients.filter(client => {
    const matchesSearch = clientDisplayName(client).toLowerCase().includes(needle) || (client.email ?? '').toLowerCase().includes(needle)
    const matchesStatus = status === 'All' || (status === 'followup' ? needsFollowup(client, now) : client.status === status)
    return matchesSearch && matchesStatus
  })
}

export function sortClients(clients: Client[], sortBy: string): Client[] {
  return [...clients].sort((a, b) => {
    if (sortBy === 'revenue_desc') return (b.total_revenue ?? 0) - (a.total_revenue ?? 0)
    if (sortBy === 'name') return clientDisplayName(a).localeCompare(clientDisplayName(b))
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

export function clientStats(clients: Client[], now = Date.now()) {
  return {
    active: clients.filter(c => c.status === 'active').length,
    pipeline: clients.filter(c => LEAD_STATUSES.includes(c.status ?? '')).length,
    revenue: clients.filter(c => c.status === 'active').reduce((acc, c) => acc + (c.total_revenue ?? 0), 0),
    followup: clients.filter(c => needsFollowup(c, now)).length,
  }
}

// ─── Import CSV ─────────────────────────────────────────────────────────────

export function parseCSV(text: string): string[][] {
  const lines = text.trim().split(/\r?\n/)
  const separator = (lines[0]?.match(/;/g) ?? []).length > (lines[0]?.match(/,/g) ?? []).length ? ';' : ','
  return lines.map(line => {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQuotes = !inQuotes }
      else if (line[i] === separator && !inQuotes) { result.push(current.trim()); current = '' }
      else { current += line[i] }
    }
    result.push(current.trim())
    return result
  })
}

export const CSV_FIELDS = [
  { key: 'company_name', label: 'Entreprise' },
  { key: 'contact_name', label: 'Contact référent' },
  { key: 'first_name', label: 'Prénom' },
  { key: 'last_name', label: 'Nom' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Téléphone' },
  { key: 'address_line1', label: 'Adresse' },
  { key: 'postal_code', label: 'Code postal' },
  { key: 'city', label: 'Ville' },
  { key: 'siret', label: 'SIRET' },
  { key: 'siren', label: 'SIREN' },
  { key: 'vat_number', label: 'TVA Intracommunautaire' },
  { key: 'payment_terms_days', label: 'Délai paiement (jours)' },
  { key: 'source', label: 'Source' },
  { key: 'status', label: 'Statut (lead_cold, lead_hot, prospect, active, subcontractor)' },
  { key: 'notes', label: 'Notes internes' },
]

/** Associe d'office les colonnes dont l'en-tête ressemble au champ attendu. */
export function autoMapColumns(headers: string[]): Record<string, string> {
  const autoMap: Record<string, string> = {}
  CSV_FIELDS.forEach(({ key }) => {
    const idx = headers.findIndex(h =>
      h.toLowerCase().replace(/[^a-z]/g, '').includes(key.replace(/_/g, ''))
      || h.toLowerCase().includes(key.split('_')[0]),
    )
    if (idx !== -1) autoMap[key] = String(idx)
  })
  return autoMap
}

/** Lit un fichier CSV : en-têtes, lignes non vides et association automatique des colonnes. */
export function readCSV(text: string) {
  const rows = parseCSV(text)
  if (rows.length < 2) return null
  const headers = rows[0]
  return { headers, dataRows: rows.slice(1).filter(r => r.some(c => c)), mapping: autoMapColumns(headers) }
}

/** Lignes à envoyer : une par contact, avec « lead froid » par défaut pour un import de leads. */
export function buildImportRows(dataRows: string[][], mapping: Record<string, string>, isLeads: boolean) {
  return dataRows.map(row => {
    const obj: Record<string, string> = {}
    CSV_FIELDS.forEach(({ key }) => {
      const colIdx = mapping[key] !== undefined ? parseInt(mapping[key]) : -1
      obj[key] = colIdx >= 0 ? (row[colIdx] ?? '') : ''
    })
    if (isLeads && !obj.status) obj.status = 'lead_cold'
    return obj
  })
}

export function canImport(mapping: Record<string, string>): boolean {
  return Boolean(mapping['company_name'] || mapping['last_name'] || mapping['first_name'])
}

export function importTemplateCsv(isLeads: boolean): string {
  const headers = 'Entreprise;Contact référent;Prénom;Nom;Email;Téléphone;Adresse;Code Postal;Ville;SIRET;SIREN;TVA Intracommunautaire;Délai Paiement (jours);Source;Statut;Notes'
  const ex1 = isLeads
    ? 'Société Martin Nettoyage;Jean Martin;;contact@martin-nettoyage.fr;0612345678;12 rue de la Paix;75001;Paris;;;;30;bouche_a_oreille;lead_hot;Très intéressé, à rappeler semaine prochaine'
    : 'Société Martin Nettoyage;Jean Martin;;contact@martin-nettoyage.fr;0612345678;12 rue de la Paix;75001;Paris;12345678901234;123456789;FR12123456789;30;;active;Client mensuel'
  const ex2 = isLeads
    ? ';;Jean;Dupont;jean.dupont@email.fr;0698765432;5 avenue des Fleurs;;Lyon;;;30;site_web;lead_cold;'
    : ';;Jean;Dupont;jean.dupont@email.fr;0698765432;5 avenue des Fleurs;;Lyon;;;;30;;active;Particulier'
  return [headers, ex1, ex2].join('\n')
}

export function exportClientsCsv(clients: Client[]): string {
  const headers = ['ID', 'Entreprise', 'Prénom', 'Nom', 'Email', 'Téléphone', 'Statut', 'Source', 'CA Total']
  return [
    headers.join(','),
    ...clients.map(c => [
      c.id,
      `"${c.company_name ?? ''}"`,
      c.first_name ?? '',
      c.last_name ?? '',
      c.email ?? '',
      c.phone ?? '',
      c.status ?? '',
      c.source ?? '',
      c.total_revenue ?? 0,
    ].join(',')),
  ].join('\n')
}
