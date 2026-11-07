/** Petites règles des pages d'erreur (sans React). */

/** Lien de contact du support, ou null si aucune adresse n'est configurée. */
export function supportHref(email: string | undefined | null, subject = 'Un problème dans Atelier'): string | null {
  const address = email?.trim()
  if (!address) return null
  return `mailto:${address}?subject=${encodeURIComponent(subject)}`
}

/** Référence à communiquer au support : l'empreinte de l'erreur, mise en forme lisible. */
export function errorReference(digest: string | undefined | null): string | null {
  const value = digest?.trim()
  if (!value) return null
  return value.length > 8 ? `${value.slice(0, 4)}-${value.slice(4, 8)}` : value
}
