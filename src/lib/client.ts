type ClientLike = {
  type?: string | null
  company_name?: string | null
  contact_name?: string | null
  first_name?: string | null
  last_name?: string | null
  email?: string | null
}

function joinName(firstName?: string | null, lastName?: string | null): string {
  return [firstName, lastName].filter(Boolean).join(' ').trim()
}

function getCompanyContactName(client: ClientLike): string | null {
  return client.contact_name?.trim()
    || joinName(client.first_name, client.last_name)
    || null
}

function getQuoteIntroGreetingName(client: ClientLike): string | null {
  if (client.type === 'company') {
    return getCompanyContactName(client)
  }

  return joinName(client.first_name, client.last_name)
    || client.contact_name?.trim()
    || null
}

function buildQuoteIntroBody(): string {
  return 'Veuillez trouver ci-joint notre proposition commerciale.'
}

function buildLegacyQuoteIntroVariants(client: ClientLike): string[] {
  const companyName = client.company_name?.trim()
  const companyContactName = getCompanyContactName(client)
  const greetingName = getClientGreetingName(client)
  const variants = new Set<string>()

  variants.add(`Bonjour ${greetingName},\n\nSuite à notre visite sur site, nous vous prions de bien vouloir trouver ci-joint notre proposition commerciale.`)
  variants.add('Suite à notre visite sur site, nous vous prions de bien vouloir trouver ci-joint notre proposition commerciale.')

  if (client.type === 'company' && companyName) {
    variants.add(`Bonjour,\n\nSuite à notre visite sur site pour l'entreprise ${companyName}, nous vous prions de bien vouloir trouver ci-joint notre proposition commerciale.`)
    variants.add(`Bonjour ${greetingName},\n\nSuite à notre visite sur site chez ${companyName}, nous vous prions de bien vouloir trouver ci-joint notre proposition commerciale.`)
    variants.add(`Bonjour ${greetingName},\n\nSuite à notre visite sur site pour l'entreprise ${companyName}, nous vous prions de bien vouloir trouver ci-joint notre proposition commerciale.`)

    if (companyContactName) {
      variants.add(`Bonjour ${companyContactName},\n\nSuite à notre visite sur site pour l'entreprise ${companyName}, nous vous prions de bien vouloir trouver ci-joint notre proposition commerciale.`)
      variants.add(`Bonjour ${companyContactName},\n\nSuite à notre visite sur site chez ${companyName}, nous vous prions de bien vouloir trouver ci-joint notre proposition commerciale.`)
    }
  }

  return Array.from(variants)
}

export function getClientDisplayName(client: ClientLike): string {
  return client.company_name?.trim()
    || client.contact_name?.trim()
    || joinName(client.first_name, client.last_name)
    || client.email?.trim()
    || 'Client sans nom'
}

export function getClientGreetingName(client: ClientLike): string {
  if (client.type === 'company') {
    return client.contact_name?.trim()
      || joinName(client.first_name, client.last_name)
      || client.company_name?.trim()
      || client.email?.trim()
      || 'Client'
  }

  return joinName(client.first_name, client.last_name)
    || client.contact_name?.trim()
    || client.company_name?.trim()
    || client.email?.trim()
    || 'Client'
}

export function buildPersonalizedQuoteIntro(client: ClientLike): string {
  const greetingName = getQuoteIntroGreetingName(client)
  const greetingLine = greetingName ? `Bonjour ${greetingName},` : 'Bonjour,'

  return `${greetingLine}\n\n${buildQuoteIntroBody()}`
}

export function isLegacyAutoQuoteIntro(client: ClientLike, intro: string | null | undefined): boolean {
  const normalizedIntro = intro?.trim()
  if (!normalizedIntro) return false

  return buildLegacyQuoteIntroVariants(client).includes(normalizedIntro)
}
