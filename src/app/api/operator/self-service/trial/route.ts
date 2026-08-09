import { createHmac } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { verifyOperatorSignature } from '@/lib/operator'
import { createOperatorAdminClient, isOperatorModeEnabled } from '@/lib/supabase/operator'
import {
  initializeQuotasForTier,
  recordOperatorClientEvent,
  syncClientQuotaConfig,
} from '@/lib/operator/trial-lifecycle'
import { getModulesForTier, getQuotaConfigForTier } from '@/lib/quota-catalog'
import { DEFAULT_EINVOICING_CONFIG } from '@/lib/einvoicing-config'
import { isSellableTier, type EntitlementSyncPayload, type SellableTier } from '@/lib/subscription-access'
import { sendAuthEmail } from '@/lib/email'

type TrialRequest = {
  source_instance: string
  organization_id: string
  app_url: string
  company_name: string
  contact_email: string
  siret: string
  preferred_tier: SellableTier
  signup_source?: string
}

function fingerprint(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value.trim().toLowerCase()).digest('hex')
}

function isValidRequest(value: unknown): value is TrialRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return (
    typeof row.source_instance === 'string'
    && typeof row.organization_id === 'string'
    && typeof row.app_url === 'string'
    && typeof row.company_name === 'string'
    && typeof row.contact_email === 'string'
    && typeof row.siret === 'string'
    && isSellableTier(row.preferred_tier)
    && (row.signup_source === undefined || typeof row.signup_source === 'string')
  )
}

function entitlementFromSubscription(row: Record<string, unknown>): EntitlementSyncPayload {
  const status = typeof row.access_status === 'string' ? row.access_status : 'locked'
  const preferred = isSellableTier(row.preferred_tier) ? row.preferred_tier : 'pro'
  return {
    access_status: status as EntitlementSyncPayload['access_status'],
    effective_tier: status === 'trialing' ? 'expert' : (isSellableTier(row.tier) ? row.tier : 'setup_only'),
    preferred_tier: preferred,
    trial_started_at: typeof row.trial_started_at === 'string' ? row.trial_started_at : null,
    trial_ends_at: typeof row.trial_ends_at === 'string' ? row.trial_ends_at : null,
    access_ends_at: typeof row.access_ends_at === 'string' ? row.access_ends_at : null,
  }
}

export async function POST(req: NextRequest) {
  if (!isOperatorModeEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const signatureSecret = process.env.OPERATOR_CONFIG_SYNC_SECRET?.trim()
    || process.env.OPERATOR_INGEST_SECRET?.trim()
  const fingerprintSecret = process.env.OPERATOR_TRIAL_FINGERPRINT_SECRET?.trim() || signatureSecret
  if (!signatureSecret || !fingerprintSecret) {
    return NextResponse.json({ error: 'Operator secrets missing' }, { status: 500 })
  }

  const rawBody = await req.text()
  if (!verifyOperatorSignature(rawBody, signatureSecret, req.headers.get('x-operator-signature'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!isValidRequest(payload)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const allowedSource = process.env.OPERATOR_SELF_SERVICE_SOURCE_INSTANCE?.trim() || 'atelier-app'
  if (payload.source_instance !== allowedSource) {
    return NextResponse.json({ error: 'Source instance not allowed' }, { status: 403 })
  }
  if (!/^\d{14}$/.test(payload.siret.replace(/\s/g, ''))) {
    return NextResponse.json({ error: 'SIRET required' }, { status: 400 })
  }

  const operator = createOperatorAdminClient()
  const now = new Date()
  const trialEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
  const email = payload.contact_email.trim().toLowerCase()
  const siret = payload.siret.replace(/\s/g, '')

  const { error: settingsError } = await operator
    .from('operator_client_settings')
    .upsert({
      source_instance: payload.source_instance,
      organization_id: payload.organization_id,
      label: payload.company_name.trim(),
      app_url: payload.app_url,
      contact_email: email,
      company_siret: siret,
      signup_source: payload.signup_source ?? 'direct',
      monthly_fee_ht: 0,
      is_active: true,
      updated_at: now.toISOString(),
    }, { onConflict: 'source_instance,organization_id' })
  if (settingsError) {
    console.error('[self-service/trial.settings]', settingsError)
    return NextResponse.json({ error: 'Unable to register organization' }, { status: 500 })
  }

  const { data: existingClaim } = await operator
    .from('operator_trial_claims')
    .select('source_instance, organization_id')
    .eq('source_instance', payload.source_instance)
    .eq('organization_id', payload.organization_id)
    .maybeSingle()

  if (existingClaim) {
    const { data: existingSubscription } = await operator
      .from('operator_client_subscriptions')
      .select('tier, preferred_tier, access_status, trial_started_at, trial_ends_at, access_ends_at')
      .eq('source_instance', payload.source_instance)
      .eq('organization_id', payload.organization_id)
      .maybeSingle()
    if (!existingSubscription) {
      return NextResponse.json({ error: 'Trial claim is already consumed' }, { status: 409 })
    }
    const entitlement = entitlementFromSubscription(existingSubscription as Record<string, unknown>)
    return NextResponse.json({
      ok: true,
      idempotent: true,
      entitlement,
      modules: getModulesForTier(entitlement.effective_tier),
      quota_config: getQuotaConfigForTier(entitlement.effective_tier),
    })
  }

  const { error: claimError } = await operator.from('operator_trial_claims').insert({
    source_instance: payload.source_instance,
    organization_id: payload.organization_id,
    email_fingerprint: fingerprint(email, fingerprintSecret),
    siret_fingerprint: fingerprint(siret, fingerprintSecret),
    metadata: { signup_source: payload.signup_source ?? 'direct', preferred_tier: payload.preferred_tier },
  })
  if (claimError) {
    const alreadyUsed = claimError.code === '23505'
    return NextResponse.json(
      { error: alreadyUsed ? 'trial_already_used' : 'Unable to claim trial' },
      { status: alreadyUsed ? 409 : 500 },
    )
  }

  const entitlement: EntitlementSyncPayload = {
    access_status: 'trialing',
    effective_tier: 'expert',
    preferred_tier: payload.preferred_tier,
    trial_started_at: now.toISOString(),
    trial_ends_at: trialEnd.toISOString(),
    access_ends_at: trialEnd.toISOString(),
  }
  const { error: subscriptionError } = await operator
    .from('operator_client_subscriptions')
    .upsert({
      source_instance: payload.source_instance,
      organization_id: payload.organization_id,
      tier: 'setup_only',
      preferred_tier: payload.preferred_tier,
      access_status: 'trialing',
      trial_tier: 'expert',
      trial_started_at: now.toISOString(),
      trial_ends_at: trialEnd.toISOString(),
      access_ends_at: trialEnd.toISOString(),
      trial_converted: false,
      mrr_ht: 0,
      stripe_status: null,
      is_active: true,
      updated_at: now.toISOString(),
    }, { onConflict: 'source_instance,organization_id' })
  if (subscriptionError) {
    console.error('[self-service/trial.subscription]', subscriptionError)
    // La revendication et l'abonnement ne peuvent pas être créés dans une
    // transaction Supabase unique depuis cette route. Si la deuxième écriture
    // échoue, on libère donc l'empreinte de cette organisation : l'utilisateur
    // pourra relancer l'activation au lieu de perdre son essai sans l'avoir eu.
    const { error: rollbackError } = await operator
      .from('operator_trial_claims')
      .delete()
      .eq('source_instance', payload.source_instance)
      .eq('organization_id', payload.organization_id)
    if (rollbackError) console.error('[self-service/trial.claim-rollback]', rollbackError)
    return NextResponse.json({ error: 'Unable to start trial' }, { status: 500 })
  }

  await initializeQuotasForTier(payload.source_instance, payload.organization_id, 'expert')
  const sync = await syncClientQuotaConfig(
    payload.source_instance,
    payload.organization_id,
    payload.app_url,
    'expert',
    'block',
    'orsayn_shared',
    DEFAULT_EINVOICING_CONFIG,
    entitlement,
  )
  await recordOperatorClientEvent({
    sourceInstance: payload.source_instance,
    organizationId: payload.organization_id,
    eventCategory: 'trial',
    eventType: 'trial_started',
    actorEmail: email,
    metadata: { preferred_tier: payload.preferred_tier, trial_ends_at: trialEnd.toISOString(), sync_status: sync.status },
  })
  const appUrl = payload.app_url.replace(/\/$/, '')
  await Promise.allSettled([
    sendAuthEmail({
      to: email,
      subject: 'Bienvenue dans Atelier — vos 14 jours Expert commencent maintenant',
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h1>Votre Atelier est prêt.</h1><p style="line-height:1.6">Pendant 14 jours, vous avez accès à la formule Expert : devis, factures, chantiers, marge et assistants métier.</p><p><a href="${appUrl}/dashboard" style="display:inline-block;background:#ff9f1c;color:#111;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:bold">Ouvrir Atelier</a></p><p style="color:#666;font-size:13px">Aucune carte n’a été demandée et aucun prélèvement ne sera lancé automatiquement à la fin.</p></div>`,
    }),
    ...(process.env.OPERATOR_ALERT_EMAIL ? [sendAuthEmail({
      to: process.env.OPERATOR_ALERT_EMAIL,
      subject: `[Atelier] Nouvel essai — ${payload.company_name}`,
      html: `<p><strong>${payload.company_name}</strong> vient de démarrer un essai Expert de 14 jours.</p><p>Préférence de conversion : ${payload.preferred_tier}. Source : ${payload.signup_source ?? 'direct'}.</p>`,
    })] : []),
  ])

  return NextResponse.json({
    ok: true,
    entitlement,
    modules: getModulesForTier('expert'),
    quota_config: getQuotaConfigForTier('expert'),
  })
}
