// @atelier-migrated
// Réglages : liste groupée, visibilité selon les droits, état « modifié » des champs.

export type SettingsTab =
  | 'profil' | 'securite' | 'entreprise' | 'legal' | 'paiement' | 'devis' | 'emails' | 'formulaire' | 'integration'
  | 'equipe' | 'roles' | 'abonnement' | 'facturation' | 'confidentialite'

export const SETTINGS_TABS: readonly SettingsTab[] = [
  'profil', 'securite', 'entreprise', 'legal', 'paiement', 'devis', 'emails', 'formulaire', 'integration',
  'equipe', 'roles', 'abonnement', 'facturation', 'confidentialite',
]

export type SettingsEntry = { tab: SettingsTab; title: string; description: string; icon: 'user' | 'lock' | 'building' | 'insurance' | 'wallet' | 'document' | 'mail' | 'message' | 'link' | 'users' | 'key' | 'star' | 'invoice' | 'shield' }
export type SettingsGroup = { title: string; entries: SettingsEntry[] }

export type SettingsAccess = {
  canEditOrg: boolean
  canEditRoles: boolean
  canConfigureEinvoicing: boolean
  isOwner: boolean
}

export type SettingsCounts = { members: number; roles: number }

export function isSettingsTab(value: string | null | undefined): value is SettingsTab {
  return !!value && (SETTINGS_TABS as readonly string[]).includes(value)
}

/** Liste groupée des réglages ; chaque entrée n'apparaît que si l'utilisateur a le droit de l'ouvrir. */
export function settingsGroups(access: SettingsAccess, counts: SettingsCounts): SettingsGroup[] {
  const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`
  const groups: SettingsGroup[] = [
    { title: 'Compte', entries: [
      { tab: 'profil', title: 'Mon profil', description: 'Nom, email, mot de passe', icon: 'user' },
      { tab: 'securite', title: 'Sécurité', description: 'Sessions actives', icon: 'lock' },
    ] },
    { title: 'Entreprise', entries: access.canEditOrg ? [
      { tab: 'entreprise', title: 'Identité et coordonnées', description: 'Logo, SIRET, activité, adresse', icon: 'building' },
      { tab: 'legal', title: 'Mentions légales et assurances', description: 'Décennale, tribunal, signature', icon: 'insurance' },
      { tab: 'paiement', title: 'TVA et paiement', description: 'Régime, IBAN, pénalités de retard', icon: 'wallet' },
    ] : [] },
    { title: 'Documents et relances', entries: [
      ...(access.canEditOrg ? [{ tab: 'devis' as const, title: 'Devis', description: 'Validité, clauses, prix matières', icon: 'document' as const }] : []),
      { tab: 'emails', title: 'Relances et emails', description: 'Relances automatiques, modèles d’email', icon: 'mail' },
      { tab: 'formulaire', title: 'Formulaire public', description: 'Demandes de devis de vos prospects', icon: 'message' },
      { tab: 'integration', title: 'Intégration', description: 'Lien, iframe et bouton pour votre site', icon: 'link' },
    ] },
    { title: 'Équipe et rôles', entries: [
      { tab: 'equipe', title: 'Équipe', description: `${plural(counts.members, 'membre', 'membres')}, invitations`, icon: 'users' },
      ...(access.canEditRoles ? [{ tab: 'roles' as const, title: 'Rôles et permissions', description: plural(counts.roles, 'rôle', 'rôles'), icon: 'key' as const }] : []),
    ] },
    { title: 'Abonnement', entries: [
      ...(access.isOwner ? [{ tab: 'abonnement' as const, title: 'Abonnement', description: 'Formule, résiliation, clé de l’assistante', icon: 'star' as const }] : []),
      ...(access.canConfigureEinvoicing ? [{ tab: 'facturation' as const, title: 'Facturation électronique', description: 'Réception et transmission des factures', icon: 'invoice' as const }] : []),
    ] },
    { title: 'Données', entries: [
      { tab: 'confidentialite', title: 'Données et confidentialité', description: 'Export comptable, sauvegarde, fermeture du compte', icon: 'shield' },
    ] },
  ]
  return groups.filter(g => g.entries.length > 0)
}

/** Un écran n'est ouvert que si son entrée est visible pour l'utilisateur. */
export function canOpenTab(tab: SettingsTab, access: SettingsAccess, counts: SettingsCounts): boolean {
  return settingsGroups(access, counts).some(g => g.entries.some(e => e.tab === tab))
}

export function groupTitleOf(tab: SettingsTab, access: SettingsAccess, counts: SettingsCounts): string {
  return settingsGroups(access, counts).find(g => g.entries.some(e => e.tab === tab))?.title ?? 'Réglages'
}

export type ProfileFields = { first_name: string; last_name: string; email: string }

export function profileDirty(saved: ProfileFields, current: ProfileFields): boolean {
  return saved.first_name !== current.first_name || saved.last_name !== current.last_name || saved.email !== current.email
}

export function profileInitials(f: ProfileFields): string {
  const letters = [f.first_name, f.last_name].filter(Boolean).map(n => n[0].toUpperCase()).join('')
  return letters || (f.email[0]?.toUpperCase() ?? '?')
}

export const fullName = (f: ProfileFields) => [f.first_name, f.last_name].filter(Boolean).join(' ')
