import { createHmac } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Flux de paiement de bout en bout : le vrai code du webhook Stripe, avec une
 * base cockpit en mémoire, des événements signés comme Stripe les signe et une
 * API Stripe simulée. Ce test vérifie ce que le cockpit enregistre (formule,
 * MRR, statut, renouvellement), ce que l'instance reçoit et quels emails partent.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  sendAuthEmail: vi.fn(async (_input: { to: string; subject: string; html: string }) => ({ error: null as string | null })),
  syncClientQuotaConfig: vi.fn(async (..._args: unknown[]) => ({ status: 'synced' as const, error: null })),
  initializeQuotasForTier: vi.fn(async (..._args: unknown[]) => undefined),
  recordOperatorClientEvent: vi.fn(async (..._args: unknown[]) => undefined),
  stripeSubscriptions: {} as Record<string, Row>,
}))

function table(name: string): Row[] {
  return (h.tables[name] ||= [])
}

const CONFLICT: Record<string, string[]> = {
  operator_client_subscriptions: ['source_instance', 'organization_id'],
  operator_client_settings: ['source_instance', 'organization_id'],
}

function from(name: string) {
  const filters: Array<[string, unknown]> = []
  let patch: Row | null = null
  const matching = () => table(name).filter((row) => filters.every(([col, value]) => row[col] === value))
  const query: any = {
    select: () => query,
    eq: (col: string, value: unknown) => { filters.push([col, value]); return query },
    order: () => query,
    limit: () => query,
    update: (values: Row) => { patch = values; return query },
    maybeSingle: async () => ({ data: matching()[0] ? { ...matching()[0] } : null, error: null }),
    then: (resolve: (value: unknown) => unknown) => {
      if (patch) matching().forEach((row) => Object.assign(row, patch))
      return resolve({ data: patch ? null : matching().map((row) => ({ ...row })), error: null })
    },
  }
  return {
    select: () => query.select(),
    update: (values: Row) => query.update(values),
    insert: async (row: Row) => {
      if (name === 'webhook_events' && table(name).some((r) => r.provider === row.provider && r.source_id === row.source_id)) {
        return { error: { code: '23505' } }
      }
      table(name).push({ ...row })
      return { error: null }
    },
    upsert: async (row: Row) => {
      const keys = CONFLICT[name] ?? ['id']
      const existing = table(name).find((r) => keys.every((key) => r[key] === row[key]))
      if (existing) Object.assign(existing, row)
      else table(name).push({ ...row })
      return { error: null }
    },
  }
}

vi.mock('@/lib/supabase/operator', () => ({
  createOperatorAdminClient: () => ({ from }),
  isOperatorModeEnabled: () => true,
}))
vi.mock('@/lib/email', () => ({ sendAuthEmail: h.sendAuthEmail }))
vi.mock('@/lib/operator/trial-lifecycle', () => ({
  UNRESOLVED_ORGANIZATION_ID: '00000000-0000-0000-0000-000000000000',
  initializeQuotasForTier: h.initializeQuotasForTier,
  recordOperatorClientEvent: h.recordOperatorClientEvent,
  syncClientQuotaConfig: h.syncClientQuotaConfig,
}))

const SECRET = 'whsec_test'
const APP = 'https://app.atelier-btp.fr'
const ORG = '11111111-1111-1111-1111-111111111111'
const SUB = 'sub_123'
const NOW = Math.floor(Date.now() / 1000)
const NEXT_PERIOD_END = NOW + 30 * 24 * 3600

process.env.OPERATOR_MODE = 'true'
process.env.STRIPE_WEBHOOK_SECRET = SECRET
process.env.STRIPE_SECRET_KEY = 'sk_test_x'
process.env.STRIPE_PRICE_PRO = 'price_pro'
process.env.STRIPE_PRICE_EXPERT = 'price_expert'
process.env.OPERATOR_SELF_SERVICE_SOURCE_INSTANCE = 'atelier-app'
delete process.env.OPERATOR_ALERT_EMAIL

const { POST } = await import('@/app/api/webhooks/stripe/route')

let eventCounter = 0

function stripeSubscription(overrides: Row = {}): Row {
  return {
    object: 'subscription',
    id: SUB,
    customer: 'cus_123',
    status: 'active',
    cancel_at: null,
    metadata: { source_instance: 'atelier-app', organization_id: ORG, tier: 'pro' },
    // API récente : la fin de période est portée par la ligne d'abonnement.
    items: { data: [{ price: { id: 'price_pro' }, current_period_end: NEXT_PERIOD_END }] },
    ...overrides,
  }
}

async function send(type: string, object: Row, eventId = `evt_${++eventCounter}`, signatureSecret = SECRET) {
  const body = JSON.stringify({ id: eventId, type, data: { object } })
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = createHmac('sha256', signatureSecret).update(`${timestamp}.${body}`).digest('hex')
  const request = new NextRequest('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` },
    body,
  })
  return POST(request)
}

const invoice = (billingReason: string, overrides: Row = {}) => ({
  object: 'invoice',
  id: `in_${eventCounter}`,
  subscription: SUB,
  billing_reason: billingReason,
  metadata: {},
  ...overrides,
})

const subscriptionRow = () => table('operator_client_subscriptions').find((r) => r.organization_id === ORG)!
const emails = () => h.sendAuthEmail.mock.calls.map(([input]) => input)

beforeEach(() => {
  eventCounter = 0
  for (const key of Object.keys(h.tables)) delete h.tables[key]
  h.sendAuthEmail.mockClear()
  h.syncClientQuotaConfig.mockClear()
  h.initializeQuotasForTier.mockClear()
  h.stripeSubscriptions[SUB] = stripeSubscription()
  table('operator_client_settings').push({ source_instance: 'atelier-app', organization_id: ORG, app_url: APP, contact_email: 'paul@weber.fr' })
  // Un essai Pro en cours, non converti : l'état de départ d'un client qui paie pendant l'essai.
  table('operator_client_subscriptions').push({
    source_instance: 'atelier-app',
    organization_id: ORG,
    tier: 'setup_only',
    preferred_tier: 'pro',
    access_status: 'trialing',
    trial_tier: 'pro',
    trial_started_at: new Date().toISOString(),
    trial_ends_at: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
    trial_converted: false,
    trial_reminders_sent: ['j-4'],
  })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const id = decodeURIComponent(String(url).split('/subscriptions/')[1] ?? '')
    const subscription = h.stripeSubscriptions[id]
    return subscription
      ? { ok: true, json: async () => subscription }
      : { ok: false, json: async () => ({}) }
  }))
})

describe('webhook Stripe : sécurité', () => {
  it('refuse une signature invalide', async () => {
    const response = await send('invoice.paid', invoice('subscription_create'), 'evt_bad', 'autre_secret')
    expect(response.status).toBe(400)
    expect(subscriptionRow().access_status).toBe('trialing')
  })

  it('traite un événement une seule fois (rejeu Stripe)', async () => {
    await send('invoice.paid', invoice('subscription_create'), 'evt_same')
    const second = await send('invoice.paid', invoice('subscription_create'), 'evt_same')
    expect(await second.json()).toMatchObject({ duplicate: true })
    expect(emails()).toHaveLength(1)
  })
})

describe('premier paiement : un client Pro paie pendant son essai', () => {
  it('enregistre la bonne formule, le MRR, les identifiants Stripe et le renouvellement dans le cockpit', async () => {
    expect((await send('checkout.session.completed', { object: 'checkout.session', id: 'cs_1', subscription: SUB, metadata: { source_instance: 'atelier-app', organization_id: ORG, tier: 'pro' } })).status).toBe(200)
    expect((await send('invoice.paid', invoice('subscription_create'))).status).toBe(200)

    expect(subscriptionRow()).toMatchObject({
      tier: 'pro',
      preferred_tier: 'pro',
      access_status: 'active',
      stripe_status: 'active',
      stripe_customer_id: 'cus_123',
      stripe_subscription_id: SUB,
      mrr_ht: 69,
      is_active: true,
      trial_converted: true,
      payment_failed_at: null,
    })
    expect(subscriptionRow().renews_at).toBe(new Date(NEXT_PERIOD_END * 1000).toISOString())
  })

  it('ouvre l’accès sur l’instance avec la bonne formule et les bons quotas', async () => {
    await send('invoice.paid', invoice('subscription_create'))

    expect(h.initializeQuotasForTier).toHaveBeenCalledWith('atelier-app', ORG, 'pro')
    const args = h.syncClientQuotaConfig.mock.calls.at(-1)!
    expect(args[0]).toBe('atelier-app')
    expect(args[1]).toBe(ORG)
    expect(args[2]).toBe(APP)
    expect(args[3]).toBe('pro')
    expect(args[7]).toMatchObject({ access_status: 'active', effective_tier: 'pro', preferred_tier: 'pro' })
  })

  it('envoie un seul email « formule active », avec montant et prochain prélèvement', async () => {
    await send('checkout.session.completed', { object: 'checkout.session', id: 'cs_1', subscription: SUB, metadata: { source_instance: 'atelier-app', organization_id: ORG } })
    await send('invoice.paid', invoice('subscription_create'))

    expect(emails()).toHaveLength(1)
    expect(emails()[0].to).toBe('paul@weber.fr')
    expect(emails()[0].subject).toBe('Votre formule Pro est active')
    expect(emails()[0].html).toContain('69 € HT/mois')
    expect(emails()[0].html).toContain('Prochain prélèvement')
  })

  it('envoie quand même l’email d’activation si la facture arrive avant la fin du checkout', async () => {
    await send('invoice.paid', invoice('subscription_create'))
    await send('checkout.session.completed', { object: 'checkout.session', id: 'cs_1', subscription: SUB, metadata: { source_instance: 'atelier-app', organization_id: ORG } })
    expect(emails().map((e) => e.subject)).toEqual(['Votre formule Pro est active'])
  })

  it('reconnaît la formule Expert par son prix', async () => {
    h.stripeSubscriptions[SUB] = stripeSubscription({
      metadata: { source_instance: 'atelier-app', organization_id: ORG, tier: 'expert' },
      items: { data: [{ price: { id: 'price_expert' }, current_period_end: NEXT_PERIOD_END }] },
    })
    await send('invoice.paid', invoice('subscription_create'))

    expect(subscriptionRow()).toMatchObject({ tier: 'expert', mrr_ht: 169, access_status: 'active' })
    expect(h.initializeQuotasForTier).toHaveBeenCalledWith('atelier-app', ORG, 'expert')
    expect(emails()[0].subject).toBe('Votre formule Expert est active')
  })
})

describe('paiement mensuel automatique', () => {
  beforeEach(async () => {
    await send('invoice.paid', invoice('subscription_create'))
    h.sendAuthEmail.mockClear()
  })

  it('un renouvellement garde l’abonnement actif, met à jour la date et n’envoie aucun email', async () => {
    const later = NEXT_PERIOD_END + 30 * 24 * 3600
    h.stripeSubscriptions[SUB] = stripeSubscription({ items: { data: [{ price: { id: 'price_pro' }, current_period_end: later }] } })
    const response = await send('invoice.paid', invoice('subscription_cycle'))

    expect(response.status).toBe(200)
    expect(subscriptionRow()).toMatchObject({ tier: 'pro', access_status: 'active', mrr_ht: 69 })
    expect(subscriptionRow().renews_at).toBe(new Date(later * 1000).toISOString())
    expect(emails()).toHaveLength(0)
  })

  it('un paiement refusé passe en impayé, garde l’accès et envoie un email avec le bouton de mise à jour', async () => {
    h.stripeSubscriptions[SUB] = stripeSubscription({ status: 'past_due' })
    await send('invoice.payment_failed', invoice('subscription_cycle'))

    expect(subscriptionRow()).toMatchObject({ access_status: 'past_due', is_active: true, trial_converted: true })
    expect(subscriptionRow().payment_failed_at).toBeTruthy()
    expect(h.syncClientQuotaConfig.mock.calls.at(-1)![7]).toMatchObject({ access_status: 'past_due', effective_tier: 'pro' })
    expect(emails()).toHaveLength(1)
    expect(emails()[0].subject).toBe('Votre paiement Atelier n’a pas abouti')
    expect(emails()[0].html).toContain(`${APP}/settings?tab=abonnement`)
  })

  it('un paiement régularisé rétablit l’accès et prévient le client', async () => {
    h.stripeSubscriptions[SUB] = stripeSubscription({ status: 'past_due' })
    await send('invoice.payment_failed', invoice('subscription_cycle'))
    h.sendAuthEmail.mockClear()

    h.stripeSubscriptions[SUB] = stripeSubscription({ status: 'active' })
    await send('invoice.paid', invoice('subscription_cycle'))

    expect(subscriptionRow()).toMatchObject({ access_status: 'active', payment_failed_at: null })
    expect(emails().map((e) => e.subject)).toEqual(['Paiement reçu, votre accès est maintenu'])
  })

  it('un abonnement impayé verrouille l’accès', async () => {
    h.stripeSubscriptions[SUB] = stripeSubscription({ status: 'unpaid' })
    await send('invoice.payment_failed', invoice('subscription_cycle'))
    expect(subscriptionRow().access_status).toBe('unpaid')
    expect(h.syncClientQuotaConfig.mock.calls.at(-1)![7]).toMatchObject({ access_status: 'unpaid' })
  })
})

describe('changement de formule et fin d’abonnement', () => {
  beforeEach(async () => {
    await send('invoice.paid', invoice('subscription_create'))
    h.sendAuthEmail.mockClear()
  })

  it('un passage de Pro à Expert met à jour la formule, le MRR et les quotas', async () => {
    h.stripeSubscriptions[SUB] = stripeSubscription({ items: { data: [{ price: { id: 'price_expert' }, current_period_end: NEXT_PERIOD_END }] } })
    await send('customer.subscription.updated', stripeSubscription({ items: { data: [{ price: { id: 'price_expert' }, current_period_end: NEXT_PERIOD_END }] } }))

    expect(subscriptionRow()).toMatchObject({ tier: 'expert', mrr_ht: 169, access_status: 'active' })
    expect(h.initializeQuotasForTier).toHaveBeenLastCalledWith('atelier-app', ORG, 'expert')
    expect(emails()).toHaveLength(0)
  })

  it('une résiliation programmée garde l’accès jusqu’à la date de fin', async () => {
    const cancelAt = NOW + 30 * 24 * 3600
    await send('customer.subscription.updated', stripeSubscription({ cancel_at: cancelAt }))
    expect(subscriptionRow()).toMatchObject({ access_status: 'canceling', is_active: true, trial_converted: true })
    expect(subscriptionRow().access_ends_at).toBe(new Date(cancelAt * 1000).toISOString())
  })

  it('la fin de l’abonnement coupe l’accès, remet le MRR à zéro et prévient le client', async () => {
    await send('customer.subscription.deleted', stripeSubscription({ status: 'canceled' }))

    expect(subscriptionRow()).toMatchObject({ access_status: 'expired', mrr_ht: 0, is_active: false })
    expect(h.syncClientQuotaConfig.mock.calls.at(-1)![7]).toMatchObject({ access_status: 'expired' })
    expect(emails().map((e) => e.subject)).toEqual(['Votre abonnement Atelier est terminé'])
  })

  it('un client qui a payé n’est JAMAIS retraité comme un essai non converti après résiliation ou impayé', async () => {
    await send('customer.subscription.deleted', stripeSubscription({ status: 'canceled' }))
    // Sans ce verrou, le cron d'expiration d'essai (trial_tier + trial_ends_at passé + non converti)
    // enverrait « Votre essai est terminé, aucun prélèvement n'a été effectué » à un abonné résilié.
    expect(subscriptionRow().trial_converted).toBe(true)

    await send('invoice.payment_failed', invoice('subscription_cycle'), undefined)
    expect(subscriptionRow().trial_converted).toBe(true)
  })
})

describe('paiement orphelin', () => {
  it('enregistre un paiement dont l’organisation est introuvable au lieu de le perdre', async () => {
    const orphan = stripeSubscription({ id: 'sub_unknown', metadata: {} })
    h.stripeSubscriptions.sub_unknown = orphan
    const response = await send('invoice.paid', { object: 'invoice', id: 'in_x', subscription: 'sub_unknown', billing_reason: 'subscription_create', metadata: {} })

    expect(response.status).toBe(200)
    expect(table('operator_client_events').some((e) => e.event_type === 'orphan_payment')).toBe(true)
    expect(subscriptionRow().access_status).toBe('trialing')
  })
})
