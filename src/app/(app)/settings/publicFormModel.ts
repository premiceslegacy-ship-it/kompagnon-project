// @atelier-migrated
// Formulaire public : sélection des éléments du catalogue visibles par les prospects (outils purs).

export type PublicItemType = 'material' | 'labor' | 'prestation'
export type PublicItemRef = { id: string; item_type: PublicItemType }

export const isPublicItemSelected = (refs: PublicItemRef[], id: string, type: PublicItemType) =>
  refs.some(r => r.id === id && r.item_type === type)

/** Coche tous les éléments d'un type, sans toucher aux autres types. */
export function selectAllOfType(refs: PublicItemRef[], type: PublicItemType, ids: string[]): PublicItemRef[] {
  return [...refs.filter(r => r.item_type !== type), ...ids.map(id => ({ id, item_type: type }))]
}

export const clearType = (refs: PublicItemRef[], type: PublicItemType): PublicItemRef[] =>
  refs.filter(r => r.item_type !== type)

export const countOfType = (refs: PublicItemRef[], type: PublicItemType) => refs.filter(r => r.item_type === type).length

/** « 3 sur 12 », ou « Aucun » pour la description d'un groupe. */
export function selectionSummary(selected: number, total: number): string {
  return selected === 0 ? 'Aucun sélectionné' : `${selected} sur ${total}`
}
