import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { expect, test as base } from '@playwright/test'
import { isLocalSupabaseUrl } from '../tests/isolation/seed-safety'

const DEFAULT_SINK_URL = 'http://127.0.0.1:43127/v1'
const FIXTURE_PREFIX = 'qualification'

type MemberAccess = {
  memberId: string
  chantierId: string
  chantierTitle: string
  date: string
  tokenId: string
  rawToken: string
}

export type QualificationTenant = {
  admin: SupabaseClient
  baseUrl: string
  orgId: string
  userId: string
  email: string
  password: string
  companyName: string
  orgEmail: string
  clientId: string
  clientName: string
  clientEmail: string
  createMemberAccess: () => Promise<MemberAccess>
}

type PartialTenant = {
  admin?: SupabaseClient
  userId?: string
  orgId?: string
}

type CapturedEmail = {
  id: string
  to?: string | string[]
  subject?: string
  html?: string
  text?: string
  attachments?: Array<{
    filename?: string
    content?: string | { type?: string; data?: number[] }
    content_type?: string
  }>
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required for local E2E qualification.`)
  return value
}

function qualificationBaseUrl(): URL {
  const value = requiredEnv('E2E_BASE_URL')
  if (!isLocalSupabaseUrl(value)) throw new Error('E2E_BASE_URL must be an explicit loopback URL.')
  const url = new URL(value)
  if (url.protocol !== 'http:' || !url.port || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('E2E_BASE_URL must be a loopback HTTP origin with an explicit port.')
  }
  return url
}

function localSupabaseSettings() {
  const url = requiredEnv('SUPABASE_URL')
  const anonKey = requiredEnv('SUPABASE_ANON_KEY')
  const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
  if (!isLocalSupabaseUrl(url) || new URL(url).protocol !== 'http:') {
    throw new Error('SUPABASE_URL must point to the explicitly local Supabase stack.')
  }
  return { url: new URL(url).origin, anonKey, serviceRoleKey }
}

function createAdminClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
}

async function assertNoError(error: unknown, stage: string): Promise<void> {
  if (error) throw new Error(`Qualification fixture failed while ${stage}.`)
}

async function ownerOrganization(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data: memberships, error } = await admin
    .from('memberships')
    .select('organization_id, role_id, is_active')
    .eq('user_id', userId)
    .eq('is_active', true)
  await assertNoError(error, 'reading the generated owner membership')
  for (const membership of memberships ?? []) {
    const { data: role, error: roleError } = await admin
      .from('roles')
      .select('slug')
      .eq('id', membership.role_id)
      .maybeSingle()
    await assertNoError(roleError, 'verifying the generated owner role')
    if (role?.slug === 'owner') return membership.organization_id
  }
  return null
}

async function deleteQualificationTenant(partial: PartialTenant): Promise<void> {
  const { admin, userId } = partial
  if (!admin) return
  let orgId = partial.orgId
  if (!orgId && userId) {
    try {
      orgId = await ownerOrganization(admin, userId) ?? undefined
    } catch {
      // Do not guess an organization ID or delete a tenant that was not proven to belong to this fixture user.
    }
  }

  let failed = false
  let deleteUser = true
  if (orgId) {
    const { error } = await admin.from('organizations').delete().eq('id', orgId)
    if (error) {
      failed = true
      deleteUser = false
    }
  }
  if (userId && deleteUser) {
    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) failed = true
  }
  if (failed) throw new Error('Qualification fixture cleanup failed for its generated local tenant.')
}

async function provisionQualificationTenant(): Promise<QualificationTenant> {
  const partial: PartialTenant = {}
  let stage = 'validating explicit local configuration'
  try {
    const baseUrl = qualificationBaseUrl().origin
    const { url, serviceRoleKey } = localSupabaseSettings()
    const admin = createAdminClient(url, serviceRoleKey)
    partial.admin = admin

    const id = randomUUID().replaceAll('-', '')

    const email = `${FIXTURE_PREFIX}-owner-${id}@atelier.test`
    const password = `Qualification-${randomUUID()}-A9!`
    const companyName = `Atelier Qualification ${id.slice(0, 8)}`
    const orgEmail = `${FIXTURE_PREFIX}-office-${id}@atelier.test`
    const clientName = `Client de qualification ${id.slice(0, 8)}`
    const clientEmail = `${FIXTURE_PREFIX}-recipient-${id}@atelier.test`

    stage = 'creating a disposable owner account'
    const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: companyName },
    })
    await assertNoError(createUserError, stage)
    if (!createdUser.user) throw new Error(`Qualification fixture failed while ${stage}.`)
    const userId = createdUser.user.id
    partial.userId = userId

    stage = 'waiting for the local auth trigger to create an owner organization'
    let orgId: string | null = null
    for (let attempt = 0; attempt < 40 && !orgId; attempt++) {
      orgId = await ownerOrganization(admin, userId)
      if (!orgId) {
        const delay = Promise.withResolvers<void>()
        setTimeout(delay.resolve, 150)
        await delay.promise
      }
    }
    if (!orgId) throw new Error(`Qualification fixture failed while ${stage}.`)
    partial.orgId = orgId

    stage = 'configuring the generated organization for qualification'
    const { error: profileError } = await admin
      .from('profiles')
      .update({ full_name: companyName, onboarding_done: true })
      .eq('id', userId)
    await assertNoError(profileError, stage)

    const { error: orgError } = await admin
      .from('organizations')
      .update({
        name: companyName,
        email: orgEmail,
        address_line1: '1 rue de la Qualification',
        postal_code: '75001',
        city: 'Paris',
        country: 'FR',
        default_vat_rate: 20,
        is_vat_subject: true,
        default_hourly_rate: 48,
        email_from_name: 'Atelier Qualification',
        email_from_address: `qualification-${id}@atelier.test`,
      })
      .eq('id', orgId)
    await assertNoError(orgError, stage)

    stage = 'disabling any local electronic-invoicing integration'
    const { data: einvoicingConfig, error: configReadError } = await admin
      .from('organization_einvoicing_config')
      .select('organization_id')
      .eq('organization_id', orgId)
      .maybeSingle()
    await assertNoError(configReadError, stage)
    if (einvoicingConfig) {
      const { error: configUpdateError } = await admin
        .from('organization_einvoicing_config')
        .update({
          mode: 'off',
          provider: null,
          oauth_status: 'not_connected',
          oauth_connected_at: null,
          super_pdp_connection_id: null,
          super_pdp_emission_enabled: false,
          super_pdp_reception_enabled: false,
        })
        .eq('organization_id', orgId)
      await assertNoError(configUpdateError, stage)
    }

    stage = 'creating the disposable qualification client'
    const { data: client, error: clientError } = await admin
      .from('clients')
      .insert({
        organization_id: orgId,
        type: 'company',
        company_name: clientName,
        contact_name: 'Contact Qualification',
        email: clientEmail,
        address_line1: '2 rue de la Qualification',
        postal_code: '75002',
        city: 'Paris',
        country: 'FR',
        status: 'active',
        source: 'direct',
        payment_terms_days: 30,
        currency: 'EUR',
        created_by: userId,
      })
      .select('id')
      .single()
    await assertNoError(clientError, stage)
    if (!client) throw new Error(`Qualification fixture failed while ${stage}.`)

    const tenant: QualificationTenant = {
      admin,
      baseUrl,
      orgId,
      userId,
      email,
      password,
      companyName,
      orgEmail,
      clientId: client.id,
      clientName,
      clientEmail,
      createMemberAccess: async () => {
        const today = new Date().toISOString().slice(0, 10)
        const chantierTitle = `Chantier Qualification ${id.slice(0, 8)}`
        const memberEmail = `${FIXTURE_PREFIX}-intervenant-${id}@atelier.test`
        const { data: chantier, error: chantierError } = await admin
          .from('chantiers')
          .insert({
            organization_id: orgId,
            client_id: client.id,
            title: chantierTitle,
            status: 'en_cours',
            start_date: today,
            created_by: userId,
          })
          .select('id')
          .single()
        await assertNoError(chantierError, 'creating the disposable assigned chantier')
        if (!chantier) throw new Error('Qualification fixture failed while creating the disposable assigned chantier.')

        const { data: member, error: memberError } = await admin
          .from('chantier_equipe_membres')
          .insert({
            organization_id: orgId,
            equipe_id: null,
            name: 'Martin',
            prenom: 'Alex',
            email: memberEmail,
            role_label: 'Intervenant',
          })
          .select('id')
          .single()
        await assertNoError(memberError, 'creating the disposable member')
        if (!member) throw new Error('Qualification fixture failed while creating the disposable member.')

        const { error: assignmentError } = await admin
          .from('chantier_individual_members')
          .insert({ chantier_id: chantier.id, member_id: member.id })
        await assertNoError(assignmentError, 'assigning the disposable member to its chantier')

        const rawToken = randomBytes(32).toString('base64url')
        const tokenHash = createHash('sha256').update(rawToken).digest('hex')
        const { data: token, error: tokenError } = await admin
          .from('member_space_tokens')
          .insert({
            member_id: member.id,
            token_hash: tokenHash,
            expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          })
          .select('id')
          .single()
        await assertNoError(tokenError, 'creating a fresh single-use local member token')
        if (!token) throw new Error('Qualification fixture failed while creating a fresh single-use local member token.')
        return {
          memberId: member.id,
          chantierId: chantier.id,
          chantierTitle,
          date: today,
          tokenId: token.id,
          rawToken,
        }
      },
    }
    return tenant
  } catch {
    try {
      await deleteQualificationTenant(partial)
    } catch {
      throw new Error(`Local qualification setup and cleanup failed while ${stage}.`)
    }
    throw new Error(`Local qualification fixture setup failed while ${stage}.`)
  }
}

function localEmailSinkControlUrl(): URL {
  const value = process.env.E2E_EMAIL_SINK_URL ?? DEFAULT_SINK_URL
  if (!isLocalSupabaseUrl(value) || new URL(value).protocol !== 'http:') {
    throw new Error('E2E_EMAIL_SINK_URL must point to the local qualification sink.')
  }
  const url = new URL(value)
  if (!url.port || Number(url.port) === 0 || url.pathname !== '/v1' || url.search || url.hash) {
    throw new Error('E2E_EMAIL_SINK_URL must be a loopback HTTP URL with a nonzero port ending in /v1.')
  }
  return url
}

async function clearQualificationEmails(): Promise<void> {
  const url = new URL('/__e2e/messages', localEmailSinkControlUrl().origin)
  const response = await fetch(url, { method: 'DELETE' }).catch(() => null)
  if (!response?.ok) throw new Error('The local qualification email sink is unavailable.')
}

export async function capturedQualificationEmails(): Promise<CapturedEmail[]> {
  const url = new URL('/__e2e/messages', localEmailSinkControlUrl().origin)
  const response = await fetch(url).catch(() => null)
  if (!response?.ok) throw new Error('The local qualification email sink is unavailable.')
  const result = await response.json().catch(() => null) as { messages?: CapturedEmail[] } | null
  if (!Array.isArray(result?.messages)) throw new Error('The local qualification email sink returned an invalid capture.')
  return result.messages
}

export async function waitForEmailCount(count: number): Promise<CapturedEmail[]> {
  let captured: CapturedEmail[] = []
  await expect.poll(async () => {
    captured = await capturedQualificationEmails()
    return captured.length
  }, { timeout: 20_000, intervals: [100, 250, 500, 1000] }).toBe(count)
  return captured
}

export function emailRecipients(email: CapturedEmail): string[] {
  const recipients = Array.isArray(email.to) ? email.to : [email.to]
  return recipients.filter((recipient): recipient is string => typeof recipient === 'string')
}

export function emailHasPdfAttachment(email: CapturedEmail): boolean {
  return (email.attachments ?? []).some((attachment) => {
    if (!attachment.filename?.toLowerCase().endsWith('.pdf')) return false
    const content = attachment.content
    let bytes: Buffer | null = null
    if (typeof content === 'string') bytes = Buffer.from(content, 'base64')
    else if (content && typeof content === 'object' && Array.isArray(content.data)) bytes = Buffer.from(content.data)
    return Boolean(bytes && bytes.subarray(0, 4).toString('ascii') === '%PDF')
  })
}

export function extractSignatureLink(email: CapturedEmail, baseUrl: string): string | null {
  const body = `${email.html ?? ''}\n${email.text ?? ''}`
  const links = [...body.matchAll(/(?:href\s*=\s*["']|\b)(https?:\/\/[^\s"'<>]+)/gi)].map((match) => match[1])
  for (const rawLink of links) {
    const link = rawLink.replaceAll('&amp;', '&')
    try {
      const parsed = new URL(link, baseUrl)
      if (parsed.origin === new URL(baseUrl).origin && /^\/sign\/[^/]+$/.test(parsed.pathname)) return parsed.toString()
    } catch {
      // Invalid email links are ignored; the assertion below reports only a boolean result.
    }
  }
  return null
}

export function signatureLinkIsLocal(link: string | null, baseUrl: string): boolean {
  if (!link) return false
  try {
    const parsed = new URL(link)
    return parsed.origin === new URL(baseUrl).origin && /^\/sign\/[^/]+$/.test(parsed.pathname)
  } catch {
    return false
  }
}

type QualificationFixtures = { qualification: QualificationTenant }

export const test = base.extend<QualificationFixtures>({
  qualification: async ({ page }, provideTenant) => {
    const tenant = await provisionQualificationTenant()
    const allowedOrigins = new Set([
      new URL(tenant.baseUrl).origin,
      new URL(localSupabaseSettings().url).origin,
    ])
    const socketUrlIsAllowed = (socketUrl: URL): boolean => {
      if (!['ws:', 'wss:'].includes(socketUrl.protocol) || socketUrl.username || socketUrl.password) return false
      const httpUrl = new URL(socketUrl)
      httpUrl.protocol = socketUrl.protocol === 'wss:' ? 'https:' : 'http:'
      return allowedOrigins.has(httpUrl.origin)
    }
    try {
      await page.context().routeWebSocket(
        (socketUrl) => !socketUrlIsAllowed(socketUrl),
        async (socket) => {
          await socket.close({ code: 1008, reason: 'Local qualification only.' })
        },
      )
      await clearQualificationEmails()
      await page.route('**/*', async (route) => {
        let requestUrl: URL
        try {
          requestUrl = new URL(route.request().url())
        } catch {
          await route.abort('blockedbyclient')
          return
        }
        if (requestUrl.protocol === 'http:' && allowedOrigins.has(requestUrl.origin)) {
          await route.continue()
        } else {
          await route.abort('blockedbyclient')
        }
      })
      await provideTenant(tenant)
    } finally {
      await clearQualificationEmails().catch(() => {})
      await deleteQualificationTenant(tenant)
    }
  },
})

export { expect }
