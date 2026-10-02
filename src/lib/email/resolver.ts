export function resolveOrganizationFromAddress(input: {
  organizationAddress?: string | null
  slug?: string | null
  sharedDomain?: string | null
  deploymentAddress?: string | null
}): string | null {
  const organizationAddress = input.organizationAddress?.trim()
  if (organizationAddress) return organizationAddress
  const domain = input.sharedDomain?.trim().replace(/^@/, '')
  const slug = input.slug?.trim().toLowerCase()
  if (slug && domain) return `${slug}@${domain}`
  return input.deploymentAddress?.trim() || null
}

export const MISSING_ORGANIZATION_EMAIL_ERROR =
  "Renseignez l'email de contact de votre entreprise (Paramètres > Entreprise) avant d'envoyer des emails à vos clients."

/**
 * Adresse qui reçoit la réponse d'un client final : celle fixée pour cet envoi,
 * sinon l'email de contact de l'entreprise. Jamais l'adresse d'Atelier, sinon la
 * réponse d'un client partirait chez Atelier au lieu de l'artisan. `null` =
 * l'envoi doit être bloqué.
 */
export function resolveClientFacingReplyTo(input: {
  explicitReplyTo?: string | null
  organizationEmail?: string | null
}): string | null {
  return input.explicitReplyTo?.trim() || input.organizationEmail?.trim() || null
}

export function resolveOrganizationReplyTo(input: {
  explicitReplyTo?: string | null
  organizationEmail?: string | null
  atelierReplyTo?: string | null
}): string | null {
  return input.explicitReplyTo?.trim()
    || input.organizationEmail?.trim()
    || input.atelierReplyTo?.trim()
    || null
}
