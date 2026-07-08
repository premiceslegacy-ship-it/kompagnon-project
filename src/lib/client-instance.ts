/**
 * Identifiant du client déployé, dérivé du host de NEXT_PUBLIC_APP_URL
 * (ex: atelier-weber.workers.dev). Utilisé pour étiqueter les événements
 * Sentry/PostHog dans le compte Orsayn partagé (un seul projet pour tous
 * les clients per-client — voir DEPLOIEMENT_CLIENT.md).
 *
 * Miroir client-side de getOperatorSourceInstance() (src/lib/operator.ts),
 * qui lit OPERATOR_SOURCE_INSTANCE côté serveur — non exposée au navigateur
 * sans préfixe NEXT_PUBLIC_, donc on dérive la même valeur depuis l'URL
 * publique de l'app plutôt que de dupliquer une variable.
 */
export function getClientInstanceLabel(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!appUrl) return 'unknown-instance'
  try {
    return new URL(appUrl).host
  } catch {
    return appUrl
  }
}
