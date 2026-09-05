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
