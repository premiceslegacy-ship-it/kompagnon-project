import {
  organizationEmailBrand,
  renderEmailShell,
  type EmailBrand,
} from './layout'

export function renderOrganizationEmail(input: {
  subject: string
  orgName: string
  bodyHtml: string
  logoUrl?: string | null
  primaryColor?: string | null
  replyTo?: string | null
  signature?: string | null
  includeSignature?: boolean
}): string {
  const brand: EmailBrand = organizationEmailBrand({
    name: input.orgName,
    logoUrl: input.logoUrl,
    primaryColor: input.primaryColor,
    replyTo: input.replyTo,
    signature: input.signature,
  })

  return renderEmailShell({
    title: input.subject,
    headerName: input.orgName,
    bodyHtml: input.bodyHtml,
    brand,
    includeSignature: input.includeSignature ?? Boolean(input.signature),
  })
}
