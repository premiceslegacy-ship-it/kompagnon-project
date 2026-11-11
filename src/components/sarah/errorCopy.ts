export type SarahErrorCode =
  | 'module_disabled'
  | 'quota_exceeded'
  | 'openrouter_credits'
  | 'rate_limit'
  | 'server_error'
  | 'unauthenticated'
  | 'permission_denied'
  | 'network'

export type SarahErrorContent = { title: string; body: string; upgrade: boolean }

export function getSarahErrorContent(code: SarahErrorCode): SarahErrorContent {
  switch (code) {
    case 'module_disabled':
      return { title: 'Fonctionnalité non incluse', body: "Sarah est disponible à partir de l'abonnement Pro.", upgrade: true }
    case 'quota_exceeded':
      return { title: 'Quota mensuel atteint', body: 'Vous avez atteint la limite de messages IA ce mois-ci.', upgrade: true }
    case 'openrouter_credits':
      return { title: 'Service IA indisponible', body: "Vérifiez la configuration IA de votre organisation, puis réessayez.", upgrade: false }
    case 'rate_limit':
      return { title: 'Trop de requêtes', body: 'Attendez quelques secondes avant de réessayer.', upgrade: false }
    case 'unauthenticated':
      return { title: 'Session expirée', body: 'Rechargez la page pour vous reconnecter.', upgrade: false }
    case 'permission_denied':
      return { title: 'Accès non autorisé', body: "Votre rôle n'a pas accès aux assistants IA. Demandez à l'administrateur de vous attribuer la permission dans Paramètres > Rôles.", upgrade: false }
    case 'network':
      return { title: 'Problème réseau', body: 'Vérifiez votre connexion puis réessayez.', upgrade: false }
    default:
      return { title: 'Erreur inattendue', body: 'Si le problème persiste, contactez le support.', upgrade: false }
  }
}
