/**
 * La colonne `organizations.certifications` est un tableau de texte, alors que
 * l'écran Réglages la saisit comme une seule ligne (« RGE, Qualibat 7131 »).
 * Ces deux fonctions font la conversion aux frontières de la base.
 */
export function certificationsToArray(value: string | null | undefined): string[] | null {
  if (typeof value !== 'string') return null
  const items = value.split(/[,;\n]/).map(item => item.trim()).filter(Boolean)
  return items.length > 0 ? items : null
}

export function certificationsToText(value: string | string[] | null | undefined): string | null {
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : null
  return typeof value === 'string' && value.trim() ? value : null
}
