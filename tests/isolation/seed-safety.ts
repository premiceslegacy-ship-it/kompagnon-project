const LOOPBACK_HOSTS: Record<string, true> = {
  localhost: true,
  '127.0.0.1': true,
  '::1': true,
}

export function isLocalSupabaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.username === '' &&
      parsed.password === '' &&
      LOOPBACK_HOSTS[hostname] === true
    )
  } catch {
    return false
  }
}

export function seedOwnedOrganizationIds(
  memberships: readonly { organization_id: string; role_slug: string | null }[],
  protectedOrganizationIds: readonly string[] = [],
): string[] {
  const protectedIds = new Set(protectedOrganizationIds)
  const owned = new Set<string>()
  for (const membership of memberships) {
    if (membership.role_slug === 'owner' && !protectedIds.has(membership.organization_id)) {
      owned.add(membership.organization_id)
    }
  }
  return [...owned]
}
