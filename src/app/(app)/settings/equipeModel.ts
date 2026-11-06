// @atelier-migrated
// Équipe et rôles : affichage des membres, droits de modification, regroupement des permissions (outils purs).

import type { Permission } from '@/lib/data/queries/roles'
import type { TeamMember } from '@/lib/data/queries/team'

export const memberName = (m: Pick<TeamMember, 'full_name' | 'email'>) => m.full_name?.trim() || m.email

/** Le propriétaire s'affiche « Propriétaire », quel que soit le nom stocké pour son rôle. */
export const roleDisplayName = (m: Pick<TeamMember, 'role_slug' | 'role_name'>) => (m.role_slug === 'owner' ? 'Propriétaire' : m.role_name)

/** « Chef d'équipe · alice@x.fr » : le poste quand il existe, puis l'email. */
export function memberDescription(m: Pick<TeamMember, 'job_title' | 'email' | 'full_name'>): string {
  return [m.job_title?.trim(), m.full_name ? m.email : null].filter(Boolean).join(' · ')
}

export type TeamAccess = { canEditRoles: boolean; canRemoveMembers: boolean }

/** Le propriétaire n'est jamais modifiable ni retirable. */
export const canChangeRole = (m: Pick<TeamMember, 'role_slug'>, a: TeamAccess) => a.canEditRoles && m.role_slug !== 'owner'
export const canRemove = (m: Pick<TeamMember, 'role_slug'>, a: TeamAccess) => a.canRemoveMembers && m.role_slug !== 'owner'

export type PermissionGroup = { category: string; perms: Permission[] }

/** Permissions regroupées par catégorie, dans l'ordre d'apparition. */
export function groupPermissions(all: Permission[]): PermissionGroup[] {
  const groups = new Map<string, Permission[]>()
  for (const p of all) groups.set(p.category, [...(groups.get(p.category) ?? []), p])
  return [...groups.entries()].map(([category, perms]) => ({ category, perms }))
}

export const enabledCount = (perms: Permission[], enabled: Record<string, boolean> | undefined) =>
  perms.filter(p => enabled?.[p.key]).length

export const permissionSummary = (perms: Permission[], enabled: Record<string, boolean> | undefined) =>
  `${enabledCount(perms, enabled)} sur ${perms.length}`

/** Vrai si les droits d'un rôle diffèrent de la version enregistrée (une clé absente vaut « désactivée »). */
export function permissionsChanged(saved: Record<string, boolean> | undefined, current: Record<string, boolean> | undefined): boolean {
  const keys = new Set([...Object.keys(saved ?? {}), ...Object.keys(current ?? {})])
  return [...keys].some(k => Boolean(saved?.[k]) !== Boolean(current?.[k]))
}

export const isValidInviteEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
