// Équipes : noms, initiales, palette par défaut et membres disponibles. Sans React.
import type { Equipe, EquipeMembre } from '@/lib/data/queries/chantiers'
import type { IndividualMember } from '@/lib/data/queries/members'

export function fullName(m: { prenom?: string | null; name: string }): string {
  return [m.prenom, m.name].filter(Boolean).join(' ')
}

export function initials(m: { prenom?: string | null; name: string }): string {
  const f = m.prenom?.[0] ?? ''
  const l = m.name?.[0] ?? ''
  return (f + l).toUpperCase() || '?'
}

export const EQUIPE_COLORS = [
  '#6366f1', '#3b82f6', '#10b981', '#f59e0b',
  '#a855f7', '#f43f5e', '#14b8a6', '#f97316',
  '#0ea5e9', '#84cc16', '#ec4899', '#06b6d4',
]

export type Dispo = (IndividualMember | EquipeMembre) & { equipe_name?: string }

/** Intervenants qu'on peut ajouter à une équipe : solos et membres d'autres équipes. */
export function membresDispoForEquipe(equipes: Equipe[], solo: IndividualMember[], equipeId: string): Dispo[] {
  const inThis = new Set(equipes.find(e => e.id === equipeId)?.membres.map(m => m.id) ?? [])
  const soloOk = solo.filter(m => !inThis.has(m.id))
  const autres = equipes
    .filter(e => e.id !== equipeId)
    .flatMap(e => e.membres.map(m => ({ ...m, equipe_name: e.name })))
    .filter(m => !inThis.has(m.id))
  return [...soloOk, ...autres]
}
