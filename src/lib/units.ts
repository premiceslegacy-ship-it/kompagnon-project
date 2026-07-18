export type UnitGroup = {
  label: string
  options: readonly { value: string; label: string }[]
}

export const BTP_UNIT_GROUPS: UnitGroup[] = [
  {
    label: 'Quantité',
    options: [
      { value: 'u', label: 'u - unité' },
      { value: 'pce', label: 'pce - pièce' },
      { value: 'lot', label: 'lot' },
      { value: 'ens', label: 'ens - ensemble' },
    ],
  },
  {
    label: 'Longueur',
    options: [
      { value: 'ml', label: 'ml - mètre linéaire' },
      { value: 'm', label: 'm - mètre' },
      { value: 'cm', label: 'cm - centimètre' },
    ],
  },
  {
    label: 'Surface',
    options: [
      { value: 'm²', label: 'm² - mètre carré' },
      { value: 'dm²', label: 'dm² - décimètre carré' },
    ],
  },
  {
    label: 'Volume',
    options: [
      { value: 'm³', label: 'm³ - mètre cube' },
      { value: 'L', label: 'L - litre' },
    ],
  },
  {
    label: 'Poids',
    options: [
      { value: 'kg', label: 'kg - kilogramme' },
      { value: 't', label: 't - tonne' },
    ],
  },
  {
    label: 'Temps',
    options: [
      { value: 'h', label: 'h - heure' },
      { value: 'j', label: 'j - jour' },
      { value: 'sem', label: 'sem - semaine' },
      { value: 'mois', label: 'mois' },
    ],
  },
  {
    label: 'Forfait / passage',
    options: [
      { value: 'forfait', label: 'forfait' },
      { value: 'passage', label: 'passage' },
    ],
  },
]

export const ALL_BTP_UNITS = BTP_UNIT_GROUPS.flatMap(g => g.options.map(o => o.value))

export function getUnitGroups(allowedUnits?: string[] | null): UnitGroup[] {
  if (!allowedUnits || allowedUnits.length === 0) return BTP_UNIT_GROUPS

  const allowed = new Set(allowedUnits)
  return BTP_UNIT_GROUPS
    .map(group => ({
      ...group,
      options: group.options.filter(option => allowed.has(option.value)),
    }))
    .filter(group => group.options.length > 0)
}

// Variantes ASCII / casse courantes saisies à la main ou venues du formulaire
// public, ramenées vers l'unité canonique du référentiel.
const UNIT_ALIASES: Record<string, string> = {
  'm2': 'm²', 'M2': 'm²', 'm^2': 'm²', 'M²': 'm²',
  'dm2': 'dm²', 'DM2': 'dm²',
  'm3': 'm³', 'M3': 'm³', 'm^3': 'm³', 'M³': 'm³',
  'l': 'L', 'litre': 'L', 'litres': 'L',
  'U': 'u', 'unité': 'u', 'unite': 'u',
  'ML': 'ml', 'Ml': 'ml',
  'H': 'h', 'heure': 'h', 'heures': 'h',
  'J': 'j', 'jour': 'j', 'jours': 'j',
  'KG': 'kg', 'Kg': 'kg',
  'T': 't',
  'pc': 'pce', 'pcs': 'pce', 'pièce': 'pce', 'piece': 'pce',
  'Forfait': 'forfait', 'FORFAIT': 'forfait',
}

/** Ramène une unité saisie librement vers l'unité canonique si une variante connue existe. */
export function normalizeUnit(value: string | null | undefined): string {
  const trimmed = value?.trim()
  if (!trimmed) return 'u'
  if (ALL_BTP_UNITS.includes(trimmed)) return trimmed
  return UNIT_ALIASES[trimmed] ?? trimmed
}

export function isBuiltInUnit(value: string | null | undefined): boolean {
  if (!value) return false
  return ALL_BTP_UNITS.includes(normalizeUnit(value))
}

export function getUnitLabel(value: string | null | undefined): string {
  if (!value) return 'u'
  for (const group of BTP_UNIT_GROUPS) {
    const match = group.options.find(o => o.value === value)
    if (match) return match.value
  }
  return value
}
