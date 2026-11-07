import type { OrganizationModules } from '@/lib/organization-modules'

export type NavigationPlace = 'today' | 'documents' | 'chantiers' | 'clients' | 'company'
export type NavigationIconName =
  | 'home' | 'document' | 'chantier' | 'clients' | 'company' | 'catalogue'
  | 'reports' | 'maintenance' | 'hours' | 'teams' | 'settings' | 'contracts'
  | 'recurring' | 'planning' | 'requests' | 'assistant' | 'invoice'

export type NavigationEntry = {
  readonly id: string
  readonly label: string
  readonly href: string
  readonly icon: NavigationIconName
  readonly description?: string
}

export type NavigationAccess = {
  readonly permissionKeys: readonly string[]
  readonly currentRoleSlug: string | null
  readonly modules: OrganizationModules
}

export type NavigationModel = {
  readonly primary: readonly (NavigationEntry & { readonly place: NavigationPlace })[]
  readonly companyGroups: readonly (readonly NavigationEntry[])[]
  readonly secondary: Readonly<Record<'documents' | 'chantiers' | 'clients', readonly NavigationEntry[]>>
  readonly allLinks: readonly NavigationEntry[]
  readonly creations: readonly NavigationEntry[]
  readonly canUseAssistant: boolean
}

const TODAY: NavigationEntry = { id: 'today', label: "Aujourd'hui", href: '/dashboard', icon: 'home' }
const DOCUMENTS: NavigationEntry = { id: 'documents', label: 'Documents', href: '/finances', icon: 'document' }
const CONTRACTS: NavigationEntry = { id: 'contracts', label: 'Contrats', href: '/contracts', icon: 'contracts' }
const RECURRING: NavigationEntry = { id: 'recurring', label: 'Récurrentes', href: '/finances/recurring', icon: 'recurring' }
// Reachable from the quote editor (« Assisté ») and from the search, not as a navigation shortcut.
const QUOTE_AI: NavigationEntry = { id: 'quote-ai', label: 'Devis avec Sarah', description: 'Dicter, décrire ou importer un document', href: '/atelier-ia', icon: 'assistant' }
const CHANTIERS: NavigationEntry = { id: 'chantiers', label: 'Chantiers', href: '/chantiers', icon: 'chantier' }
const PLANNING: NavigationEntry = { id: 'planning', label: 'Planning', href: '/chantiers/planning', icon: 'planning' }
const CLIENTS: NavigationEntry = { id: 'clients', label: 'Clients', href: '/clients', icon: 'clients' }
const REQUESTS: NavigationEntry = { id: 'requests', label: 'Demandes', href: '/requests', icon: 'requests' }
const COMPANY: NavigationEntry = { id: 'company', label: 'Entreprise', href: '/entreprise', icon: 'company' }

const COMPANY_GROUPS: readonly (readonly (NavigationEntry & { readonly permission: string })[])[] = [
  [
    { id: 'catalogue', label: 'Catalogue', href: '/catalog', icon: 'catalogue', permission: 'catalog.view' },
    { id: 'reports', label: 'Rapports', href: '/rapports', icon: 'reports', permission: 'dashboard.view_ca' },
    { id: 'maintenance', label: 'Entretien', href: '/chantiers/entretien', icon: 'maintenance', permission: 'chantiers.view' },
  ],
  [
    { id: 'hours', label: 'Heures', href: '/chantiers/heures', icon: 'hours', permission: 'chantiers.view' },
    { id: 'teams', label: 'Équipes', href: '/chantiers/equipes', icon: 'teams', permission: 'chantiers.view' },
  ],
  [{ id: 'settings', label: 'Réglages', href: '/settings', icon: 'settings', permission: 'settings.view' }],
]

const CREATIONS: readonly (NavigationEntry & { readonly permission: string })[] = [
  { id: 'create-quote', label: 'Devis', description: 'Dicter ou décrire', href: '/finances/quote-editor?returnTo=%2Ffinances', icon: 'document', permission: 'quotes.create' },
  { id: 'create-invoice', label: 'Facture', description: 'Depuis un devis', href: '/finances/invoice-editor?returnTo=%2Ffinances', icon: 'invoice', permission: 'invoices.create' },
  { id: 'create-client', label: 'Client', description: 'Nom et téléphone', href: '/clients?new=1', icon: 'clients', permission: 'clients.create' },
  { id: 'create-chantier', label: 'Chantier', description: "À partir d'un devis", href: '/chantiers?new=1', icon: 'chantier', permission: 'chantiers.create' },
]

export function buildNavigationModel({ permissionKeys, currentRoleSlug, modules }: NavigationAccess): NavigationModel {
  const permissions = new Set(permissionKeys)
  const wildcard = permissions.has('*')
  const can = (key: string) => wildcard || permissions.has(key)
  const financeVisible = can('quotes.view') || can('invoices.view')
  const documents: NavigationEntry[] = []
  if (financeVisible) documents.push({ ...DOCUMENTS, label: 'Devis et factures' })
  if (can('contracts.view')) documents.push(CONTRACTS)
  if (financeVisible) documents.push(RECURRING)
  const quoteAi = (currentRoleSlug === 'owner' || currentRoleSlug === 'admin') && (modules.quote_ai || modules.document_import_ai || modules.voice_input)
  const chantiers = can('chantiers.view') ? [CHANTIERS, PLANNING] : []
  const clients: NavigationEntry[] = []
  if (can('clients.view')) clients.push(CLIENTS)
  if (can('leads.view')) clients.push(REQUESTS)
  const companyGroups = COMPANY_GROUPS.map(group => group.filter(entry => can(entry.permission))).filter(group => group.length > 0)
  const primary: (NavigationEntry & { place: NavigationPlace })[] = []
  if (can('dashboard.view')) primary.push({ ...TODAY, place: 'today' })
  if (documents.length) primary.push({ ...DOCUMENTS, href: documents[0].href, place: 'documents' })
  if (chantiers.length) primary.push({ ...CHANTIERS, place: 'chantiers' })
  if (clients.length) primary.push({ ...CLIENTS, href: clients[0].href, place: 'clients' })
  // The personal menu remains reachable even when no business destination is granted.
  primary.push({ ...COMPANY, place: 'company' })
  return {
    primary,
    companyGroups,
    secondary: { documents, chantiers, clients },
    allLinks: [...(can('dashboard.view') ? [TODAY] : []), ...documents, ...(quoteAi ? [QUOTE_AI] : []), ...chantiers, ...clients, COMPANY, ...companyGroups.flat()],
    creations: CREATIONS.filter(entry => can(entry.permission)),
    canUseAssistant: modules.sarah_assistant && can('ai.sarah'),
  }
}

export function navigationPathMatches(pathname: string, href: string): boolean {
  const query = href.indexOf('?')
  const fragment = href.indexOf('#')
  const end = query < 0 ? fragment : fragment < 0 ? query : Math.min(query, fragment)
  const route = end < 0 ? href : href.slice(0, end)
  return pathname === route || (pathname.startsWith(route) && pathname.charCodeAt(route.length) === 47)
}

const COMPANY_PATHS = ['/entreprise', '/catalog', '/rapports', '/settings', '/chantiers/entretien', '/chantiers/heures', '/chantiers/equipes'] as const
const DOCUMENT_PATHS = ['/finances', '/contracts', '/atelier-ia', '/devis', '/kompagnon-ia'] as const
const CLIENT_PATHS = ['/clients', '/requests'] as const

export function activeNavigationPlace(pathname: string): NavigationPlace | null {
  for (const route of COMPANY_PATHS) if (navigationPathMatches(pathname, route)) return 'company'
  for (const route of DOCUMENT_PATHS) if (navigationPathMatches(pathname, route)) return 'documents'
  for (const route of CLIENT_PATHS) if (navigationPathMatches(pathname, route)) return 'clients'
  if (navigationPathMatches(pathname, '/chantiers')) return 'chantiers'
  if (pathname === '/dashboard') return 'today'
  return null
}
