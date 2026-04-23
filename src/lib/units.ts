export type UnitGroup = {
  label: string
  options: readonly { value: string; label: string }[]
}

export const BTP_UNIT_GROUPS: UnitGroup[] = [
  {
    label: 'Quantité',
    options: [
      { value: 'u', label: 'u — unité' },
      { value: 'pce', label: 'pce — pièce' },
      { value: 'lot', label: 'lot' },
      { value: 'ens', label: 'ens — ensemble' },
    ],
  },
  {
    label: 'Longueur',
    options: [
      { value: 'ml', label: 'ml — mètre linéaire' },
      { value: 'm', label: 'm — mètre' },
      { value: 'cm', label: 'cm — centimètre' },
    ],
  },
  {
    label: 'Surface',
    options: [
      { value: 'm²', label: 'm² — mètre carré' },
      { value: 'dm²', label: 'dm² — décimètre carré' },
    ],
  },
  {
    label: 'Volume',
    options: [
      { value: 'm³', label: 'm³ — mètre cube' },
      { value: 'L', label: 'L — litre' },
    ],
  },
  {
    label: 'Poids',
    options: [
      { value: 'kg', label: 'kg — kilogramme' },
      { value: 't', label: 't — tonne' },
    ],
  },
  {
    label: 'Temps',
    options: [
      { value: 'h', label: 'h — heure' },
      { value: 'j', label: 'j — jour' },
      { value: 'sem', label: 'sem — semaine' },
      { value: 'mois', label: 'mois' },
    ],
  },
  {
    label: 'Forfait',
    options: [
      { value: 'forfait', label: 'forfait' },
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

export function isBuiltInUnit(value: string | null | undefined): boolean {
  if (!value) return false
  return ALL_BTP_UNITS.includes(value)
}

export function getUnitLabel(value: string | null | undefined): string {
  if (!value) return 'u'
  for (const group of BTP_UNIT_GROUPS) {
    const match = group.options.find(o => o.value === value)
    if (match) return match.value
  }
  return value
}
