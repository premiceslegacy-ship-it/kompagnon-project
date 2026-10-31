import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as portalPost } from '@/app/api/stripe/portal-session/route'
import { POST as cancelPost } from '@/app/api/stripe/cancel-subscription/route'
import { POST as trialPost } from '@/app/api/operator/self-service/trial/route'
import { POST as quotaAlertsPost } from '@/app/api/operator/cron/quota-alerts/route'

type Row = Record<string, unknown>
type QueryResult = { data: Row[]; error: null; count: number }
type Query = PromiseLike<QueryResult> & {
  select(columns?: string, options?: { count?: string; head?: boolean }): Query
  eq(column: string, value: unknown): Query
  not(column: string, operator: string, value: unknown): Query
  is(column: string, value: unknown): Query
  lt(column: string, value: unknown): Query
  gt(column: string, value: unknown): Query
  lte(column: string, value: unknown): Query
  gte(column: string, value: unknown): Query
  order(column: string, options?: Record<string, unknown>): Query
  limit(count: number): Query
  range(from: number, to: number): Query
  maybeSingle(): Promise<{ data: Row | null; error: null }>
  update(values: Row): Query
  upsert(values: Row, options?: { onConflict?: string }): Promise<{ error: null }>
  insert(values: Row): Promise<{ error: null }>
  delete(): Query
}

const h = vi.hoisted(() => ({
  requestBody: {} as Record<string, unknown>,
  subscriptions: [] as Row[],
  settings: [] as Row[],
  writes: [] as string[],
  fetch: vi.fn(),
  initializeQuotasForTier: vi.fn(),
  recordOperatorClientEvent: vi.fn(),
  syncClientQuotaConfig: vi.fn(),
  expireTrialForInstance: vi.fn(async () => ({ status: 'expired' as const })),
  sendAuthEmail: vi.fn(),
  resendSend: vi.fn(),
}))

const ORG = '11111111-1111-4111-8111-111111111111'
const SOURCE = 'atelier-app'

function tableRows(table: string): Row[] {
  if (table === 'operator_client_subscriptions') return h.subscriptions
  if (table === 'operator_client_settings') return h.settings
  return []
}

function compareDate(left: unknown, right: unknown): number {
  return new Date(String(left)).getTime() - new Date(String(right)).getTime()
}

function makeQuery(table: string) {
  const filters: Array<[string, string, unknown]> = []
  let range: [number, number] | null = null
  const query: Query = {
    select: () => query,
    eq: (column: string, value: unknown) => { filters.push(['eq', column, value]); return query },
    not: (column: string, _operator: string, value: unknown) => { filters.push(['not', column, value]); return query },
    is: (column: string, value: unknown) => { filters.push(['is', column, value]); return query },
    lt: (column: string, value: unknown) => { filters.push(['lt', column, value]); return query },
    gt: (column: string, value: unknown) => { filters.push(['gt', column, value]); return query },
    lte: (column: string, value: unknown) => { filters.push(['lte', column, value]); return query },
    gte: (column: string, value: unknown) => { filters.push(['gte', column, value]); return query },
    order: () => query,
    limit: () => query,
    range: (from: number, to: number) => { range = [from, to]; return query },
    maybeSingle: async () => ({ data: matching()[0] ? { ...matching()[0] } : null, error: null }),
    update: () => { h.writes.push(`${table}:update`); return query },
    upsert: async () => { h.writes.push(`${table}:upsert`); return { error: null } },
    insert: async () => { h.writes.push(`${table}:insert`); return { error: null } },
    delete: () => { h.writes.push(`${table}:delete`); return query },
    then<TResult1 = QueryResult, TResult2 = never>(
      onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      let rows = matching()
      if (range) rows = rows.slice(range[0], range[1] + 1)
      const result: QueryResult = { data: rows.map((row) => ({ ...row })), error: null, count: rows.length }
      return Promise.resolve(result).then(onfulfilled, onrejected)
    },
  }
  function matching(): Row[] {
    return tableRows(table).filter((row) => filters.every(([operator, column, value]) => {
      const actual = row[column]
      if (operator === 'eq') return actual === value
      if (operator === 'not') return value === null ? actual !== null && actual !== undefined : actual !== value
      if (operator === 'is') return value === null ? actual === null || actual === undefined : actual === value
      if (operator === 'lt') return compareDate(actual, value) < 0
      if (operator === 'gt') return compareDate(actual, value) > 0
      if (operator === 'lte') return compareDate(actual, value) <= 0
      return compareDate(actual, value) >= 0
    }))
  }
  return query
}

vi.mock('@/lib/supabase/operator', () => ({
  createOperatorAdminClient: () => ({ from: (table: string) => makeQuery(table) }),
  isOperatorModeEnabled: () => true,
}))

vi.mock('@/lib/operator', () => ({
  OPERATOR_TIMESTAMP_HEADER: 'x-operator-timestamp',
  hasOperatorMasterSecret: () => true,
  getOperatorFingerprintSecret: () => 'fingerprint-test-secret',
  readOperatorRequest: () => ({ ok: true, body: h.requestBody }),
}))

vi.mock('@/lib/operator/trial-lifecycle', () => ({
  TRIAL_DURATION_DAYS: 7,
  initializeQuotasForTier: h.initializeQuotasForTier,
  recordOperatorClientEvent: h.recordOperatorClientEvent,
  syncClientQuotaConfig: h.syncClientQuotaConfig,
  expireTrialForInstance: h.expireTrialForInstance,
}))

vi.mock('@/lib/cron-auth', () => ({ verifyCronSecret: () => true }))
vi.mock('@/lib/email', () => ({ sendAuthEmail: h.sendAuthEmail }))
vi.mock('@/lib/brand', () => ({ ATELIER_SENDER_NAME: 'Atelier' }))
vi.mock('@/lib/email/commercial', () => ({
  buildAtelierExistingCompanyEmail: () => ({ subject: 'existing', html: 'existing' }),
  buildAtelierNotificationEmail: () => ({ subject: 'notification', html: 'notification' }),
  buildAtelierSubscriptionEmail: () => ({ subject: 'subscription', html: 'subscription' }),
  buildAtelierTrialStartedEmail: () => ({ subject: 'trial', html: 'trial' }),
  buildAtelierPostTrialReminderEmail: () => ({ subject: 'post-trial', html: 'post-trial' }),
  buildAtelierTrialEndedEmail: () => ({ subject: 'trial-ended', html: 'trial-ended' }),
  buildAtelierTrialReminderEmail: () => ({ subject: 'reminder', html: 'reminder' }),
}))
vi.mock('resend', () => ({ Resend: class { emails = { send: h.resendSend } } }))

function request(path: string): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-operator-timestamp': String(Date.now()) },
    body: '{}',
  })
}

function setupSubscription(overrides: Row = {}): Row {
  return {
    source_instance: SOURCE,
    organization_id: ORG,
    billing_model: 'setup',
    tier: 'setup_only',
    preferred_tier: 'pro',
    access_status: 'active',
    stripe_status: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    trial_tier: null,
    trial_ends_at: null,
    trial_converted: true,
    mrr_ht: 0,
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubEnv('OPERATOR_MODE', 'true')
  vi.stubEnv('OPERATOR_MASTER_SECRET', 'd'.repeat(64))
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_local_only')
  vi.stubEnv('STRIPE_SELF_SERVICE_PORTAL_CONFIGURATION_ID', 'bpc_test')
  vi.stubEnv('OPERATOR_SELF_SERVICE_SOURCE_INSTANCE', SOURCE)
  h.requestBody = {}
  // Le tier vendable est volontairement contradictoire : seul billing_model décide.
  h.subscriptions = [setupSubscription({ tier: 'pro', stripe_customer_id: 'cus_setup', stripe_subscription_id: 'sub_setup' })]
  h.settings = [{ source_instance: SOURCE, organization_id: ORG, app_url: 'https://atelier-test.example', contact_email: 'owner@example.test' }]
  h.writes.length = 0
  h.fetch.mockReset()
  h.initializeQuotasForTier.mockReset()
  h.recordOperatorClientEvent.mockReset()
  h.syncClientQuotaConfig.mockReset()
  h.expireTrialForInstance.mockClear()
  h.sendAuthEmail.mockReset()
  h.resendSend.mockReset()
  vi.stubGlobal('fetch', h.fetch)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('offre setup manuelle : routes consommateurs', () => {
  it('refuse le portail Stripe sans appel fournisseur ni écriture', async () => {
    h.requestBody = { source_instance: SOURCE, organization_id: ORG, return_url: 'https://atelier-test.example/settings' }

    const response = await portalPost(request('/api/stripe/portal-session'))

    expect(response.status).toBe(409)
    expect(h.fetch).not.toHaveBeenCalled()
    expect(h.writes).toEqual([])
  })

  it('refuse la résiliation Stripe sans appel fournisseur ni écriture', async () => {
    h.requestBody = { source_instance: SOURCE, organization_id: ORG, reason: 'demande client' }

    const response = await cancelPost(request('/api/stripe/cancel-subscription'))

    expect(response.status).toBe(409)
    expect(h.fetch).not.toHaveBeenCalled()
    expect(h.writes).toEqual([])
  })

  it('conserve le portail et la résiliation Stripe pour une vraie subscription', async () => {
    h.subscriptions = [setupSubscription({
      billing_model: 'subscription',
      tier: 'pro',
      stripe_status: 'active',
      stripe_customer_id: 'cus_subscription',
      stripe_subscription_id: 'sub_subscription',
    })]
    h.fetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ url: 'https://stripe.example/session' }),
    }))

    h.requestBody = { source_instance: SOURCE, organization_id: ORG, return_url: 'https://atelier-test.example/settings' }
    const portalResponse = await portalPost(request('/api/stripe/portal-session'))
    h.requestBody = { source_instance: SOURCE, organization_id: ORG, reason: 'demande client' }
    const cancelResponse = await cancelPost(request('/api/stripe/cancel-subscription'))

    expect(portalResponse.status).toBe(200)
    expect(cancelResponse.status).toBe(200)
    expect(h.fetch).toHaveBeenCalledTimes(2)
    expect(h.writes).toContain('operator_client_subscriptions:update')
  })

  it('refuse un essai setup avant settings et claim email', async () => {
    h.requestBody = {
      source_instance: SOURCE,
      organization_id: ORG,
      app_url: 'https://atelier-test.example',
      company_name: 'Atelier test',
      contact_email: 'owner@example.test',
      siret: '12345678901234',
      preferred_tier: 'pro',
    }

    const response = await trialPost(request('/api/operator/self-service/trial'))

    expect(response.status).toBe(409)
    expect(h.writes).toEqual([])
    expect(h.sendAuthEmail).not.toHaveBeenCalled()
  })

  it('exclut setup des expirations et relances de cron', async () => {
    const now = Date.now()
    h.subscriptions = [
      setupSubscription({
        organization_id: 'expired-setup',
        trial_tier: 'pro',
        trial_ends_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
        trial_converted: false,
        stripe_subscription_id: null,
      }),
      setupSubscription({
        organization_id: 'active-setup',
        trial_tier: 'pro',
        trial_ends_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
        trial_converted: false,
        stripe_subscription_id: null,
      }),
      setupSubscription({
        organization_id: 'post-trial-setup',
        access_status: 'expired',
        trial_tier: 'pro',
        trial_ends_at: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
        trial_converted: false,
        stripe_subscription_id: null,
      }),
    ]
    h.settings = h.subscriptions.map((row) => ({
      source_instance: SOURCE,
      organization_id: row.organization_id,
      app_url: 'https://atelier-test.example',
      contact_email: 'owner@example.test',
    }))

    const response = await quotaAlertsPost(request('/api/operator/cron/quota-alerts'))

    expect(response.status).toBe(200)
    expect(h.expireTrialForInstance).not.toHaveBeenCalled()
    expect(h.resendSend).not.toHaveBeenCalled()
    expect(h.writes).toEqual([])
    expect(await response.json()).toMatchObject({ trials_expired: 0, trial_reminders_sent: 0, post_trial_reminders_sent: 0 })
  })
})
