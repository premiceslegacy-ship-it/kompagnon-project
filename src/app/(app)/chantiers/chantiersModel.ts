// Modèle de la liste des chantiers : statuts, récurrences, filtres, pagination. Sans React.
import type { Chantier } from '@/lib/data/queries/chantiers'
import type { StatusPillStatus } from '@/components/ui/StatusPill'

export type ChantierStatus = Chantier['status']

export type RecurrenceType = 'none' | 'quotidien' | 'plurihebdomadaire' | 'hebdomadaire' | 'mensuel' | 'bimensuel' | 'trimestriel'

export const STATUS_LABELS: Record<ChantierStatus, string> = {
  planifie: 'Planifié',
  en_cours: 'En cours',
  suspendu: 'Suspendu',
  termine: 'Terminé',
  annule: 'Annulé',
}

const STATUS_PILL: Record<ChantierStatus, StatusPillStatus> = {
  planifie: 'neutral',
  en_cours: 'success',
  suspendu: 'wait',
  termine: 'neutral',
  annule: 'danger',
}

export function statusPill(status: ChantierStatus): { status: StatusPillStatus; label: string } {
  return { status: STATUS_PILL[status] ?? 'neutral', label: STATUS_LABELS[status] ?? status }
}

export const STATUS_FILTERS: { value: ChantierStatus | 'tous'; label: string }[] = [
  { value: 'tous', label: 'Tous les statuts' },
  ...(Object.keys(STATUS_LABELS) as ChantierStatus[]).map(value => ({ value, label: STATUS_LABELS[value] })),
]

export const RECURRENCE_OPTIONS: { value: RecurrenceType; label: string }[] = [
  { value: 'none', label: 'Ponctuel (pas de récurrence)' },
  { value: 'quotidien', label: 'Tous les jours' },
  { value: 'plurihebdomadaire', label: 'Plusieurs fois par semaine' },
  { value: 'hebdomadaire', label: 'Toutes les semaines' },
  { value: 'mensuel', label: 'Tous les mois' },
  { value: 'bimensuel', label: 'Tous les 2 mois' },
  { value: 'trimestriel', label: 'Tous les trimestres' },
]

export function recurrenceLabel(recurrence: string | null | undefined): string | null {
  if (!recurrence || recurrence === 'none') return null
  return RECURRENCE_OPTIONS.find(o => o.value === recurrence)?.label ?? recurrence
}

/** 2 h 30 → « 2h30 » ; heures entières sans minutes. */
export function fmtHours(hours: number): string {
  const h = Math.floor(hours)
  const min = Math.round((hours - h) * 60)
  if (min === 0) return `${h}h`
  return `${h}h${String(min).padStart(2, '0')}`
}

export function filterChantiers(chantiers: Chantier[], search: string, status: ChantierStatus | 'tous'): Chantier[] {
  const q = search.toLowerCase()
  return chantiers.filter(c => {
    const matchSearch = !q ||
      c.title.toLowerCase().includes(q) ||
      (c.client?.company_name ?? '').toLowerCase().includes(q) ||
      (c.city ?? '').toLowerCase().includes(q)
    const matchStatus = status === 'tous' || c.status === status
    return matchSearch && matchStatus
  })
}

/** Date courte « 12/10/26 », ou « / » quand elle manque. */
export function fmtShortDate(d: string | null): string {
  return d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '/'
}

/** Actions de statut disponibles pour un chantier, selon son statut actuel. */
export function statusTransitions(status: ChantierStatus): { to: ChantierStatus; label: string }[] {
  const out: { to: ChantierStatus; label: string }[] = []
  if (status === 'suspendu' || status === 'termine' || status === 'annule') out.push({ to: 'en_cours', label: 'Reprendre' })
  if (status !== 'termine' && status !== 'annule') out.push({ to: 'termine', label: 'Terminer' })
  if (status !== 'suspendu' && status !== 'termine' && status !== 'annule') out.push({ to: 'suspendu', label: 'Suspendre' })
  if (status !== 'annule' && status !== 'termine') out.push({ to: 'annule', label: 'Annuler le chantier' })
  return out
}

export type NewChantierForm = {
  title: string; clientId: string; addressLine1: string; postalCode: string; city: string
  startDate: string; estimatedEndDate: string; budgetHt: string
  contactName: string; contactEmail: string; contactPhone: string
  quoteId: string
}

export const EMPTY_CHANTIER_FORM: NewChantierForm = {
  title: '', clientId: '', addressLine1: '', postalCode: '', city: '',
  startDate: '', estimatedEndDate: '', budgetHt: '',
  contactName: '', contactEmail: '', contactPhone: '',
  quoteId: '',
}

type LinkableQuote = {
  id: string; title: string | null; client_id: string | null; total_ht: number | null
  client_address_line1?: string | null; client_postal_code?: string | null; client_city?: string | null
  client_contact_name?: string | null; client_contact_email?: string | null; client_contact_phone?: string | null
}

/** Choisir un devis écrase le formulaire depuis le devis ; le désélectionner remet à vide. */
export function applyQuoteToForm(form: NewChantierForm, quoteId: string, quotes: LinkableQuote[]): NewChantierForm {
  const q = quotes.find(x => x.id === quoteId)
  if (!q) return { ...form, quoteId: '', title: '', clientId: '', budgetHt: '', addressLine1: '', postalCode: '', city: '', contactName: '', contactEmail: '', contactPhone: '' }
  return {
    ...form,
    quoteId,
    title: q.title || '',
    clientId: q.client_id || '',
    budgetHt: q.total_ht != null ? String(Math.round(q.total_ht)) : '',
    addressLine1: q.client_address_line1 || '',
    postalCode: q.client_postal_code || '',
    city: q.client_city || '',
    contactName: q.client_contact_name || '',
    contactEmail: q.client_contact_email || '',
    contactPhone: q.client_contact_phone || '',
  }
}
