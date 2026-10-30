'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembershipContext } from '@/lib/data/queries/membership'
import { getOperatorSigningSecret, signOperatorRequest, OPERATOR_TIMESTAMP_HEADER } from '@/lib/operator'
import {
  entitlementFromDb,
  isSellableTier,
  type EntitlementSyncPayload,
  type SellableTier,
} from '@/lib/subscription-access'
import { isSelfServiceMode } from '@/lib/data/queries/subscription-access'

type OperatorError = { error: string; reason?: string }

function operatorConfig(): { baseUrl: string; secret: string; sourceInstance: string } | null {
  const ingestUrl = process.env.OPERATOR_INGEST_URL?.trim()
  const sourceInstance = process.env.OPERATOR_SOURCE_INSTANCE?.trim()
  const secret = sourceInstance ? getOperatorSigningSecret(sourceInstance) : null
  if (!ingestUrl || !secret || !sourceInstance) return null
  return { baseUrl: new URL(ingestUrl).origin, secret, sourceInstance }
}

async function postOperator<T>(path: string, payload: Record<string, unknown>): Promise<T | OperatorError> {
  const config = operatorConfig()
  if (!config) return { error: 'Configuration opérateur manquante' }
  const body = JSON.stringify({ source_instance: config.sourceInstance, ...payload })
  const { signature, timestamp } = signOperatorRequest(body, config.secret)
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-operator-signature': signature, [OPERATOR_TIMESTAMP_HEADER]: timestamp },
      body,
      cache: 'no-store',
    })
    const data = await response.json().catch(() => ({})) as T & OperatorError
    if (!response.ok) return {
      error: data.error || `Erreur ${response.status}`,
      ...(typeof data.reason === 'string' ? { reason: data.reason } : {}),
    }
    return data
  } catch (error) {
    console.error(`[postOperator ${path}]`, error)
    return { error: 'Le service d’activation est momentanément indisponible' }
  }
}

async function requireOwnerContext() {
  const supabase = await createClient()
  const [{ data: { user } }, membership] = await Promise.all([
    supabase.auth.getUser(),
    getCurrentMembershipContext(),
  ])
  if (!user || !membership?.organizationId) return { ok: false as const, error: 'Session introuvable' }
  if (membership.roleSlug !== 'owner') return { ok: false as const, error: 'Action réservée au dirigeant du compte' }
  return { ok: true as const, supabase, user, organizationId: membership.organizationId }
}

export async function ensureLockedEntitlement(
  organizationId: string,
  preferredTier: SellableTier,
): Promise<{ error?: string }> {
  if (!isSelfServiceMode()) return {}
  const admin = createAdminClient()
  const { error } = await admin.from('organization_entitlements').upsert({
    organization_id: organizationId,
    access_status: 'locked',
    effective_tier: 'setup_only',
    preferred_tier: preferredTier,
    trial_started_at: null,
    trial_ends_at: null,
    access_ends_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id', ignoreDuplicates: true })
  return error ? { error: error.message } : {}
}

export async function registerPendingSelfServiceSignup(input: {
  userId: string
  organizationId?: string | null
  email: string
  fullName?: string | null
  preferredTier?: SellableTier
  signupSource?: string | null
}): Promise<{ ok: true } | OperatorError> {
  if (!isSelfServiceMode()) return { ok: true }
  const admin = createAdminClient()
  let organizationId = input.organizationId ?? null
  if (!organizationId) {
    const { data: membership, error } = await admin.from('memberships')
      .select('organization_id')
      .eq('user_id', input.userId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    if (error || !membership?.organization_id) return { error: error?.message ?? 'Organisation introuvable' }
    organizationId = membership.organization_id
  }

  return postOperator<{ ok: true }>('/api/operator/self-service/signup', {
    organization_id: organizationId,
    app_url: process.env.NEXT_PUBLIC_APP_URL,
    contact_email: input.email,
    full_name: input.fullName ?? null,
    preferred_tier: input.preferredTier ?? 'pro',
    signup_source: input.signupSource ?? 'direct',
  })
}

export async function registerSelfServiceOrganization(): Promise<{ ok: true } | OperatorError> {
  if (!isSelfServiceMode()) return { ok: true }
  const context = await requireOwnerContext()
  if (!context.ok) return { error: context.error }
  if (!context.user.email || !context.user.email_confirmed_at) return { error: 'Votre adresse email doit être vérifiée' }

  const admin = createAdminClient()
  const [{ data: organization }, { data: entitlement }] = await Promise.all([
    admin.from('organizations').select('name, siret').eq('id', context.organizationId).single(),
    admin.from('organization_entitlements').select('preferred_tier').eq('organization_id', context.organizationId).maybeSingle(),
  ])
  if (!organization?.siret) return { error: 'Le SIRET est obligatoire' }
  const preferredTier = isSellableTier(entitlement?.preferred_tier)
    ? entitlement.preferred_tier
    : isSellableTier(context.user.user_metadata?.pending_trial_tier)
      ? context.user.user_metadata.pending_trial_tier
      : 'pro'
  const result = await postOperator<{ ok: true }>('/api/operator/self-service/register', {
    organization_id: context.organizationId,
    app_url: process.env.NEXT_PUBLIC_APP_URL,
    company_name: organization.name,
    contact_email: context.user.email,
    siret: organization.siret,
    preferred_tier: preferredTier,
    signup_source: context.user.user_metadata?.signup_source ?? 'direct',
  })
  return 'error' in result ? result : { ok: true }
}

export async function activateTrialForCurrentOrganization(): Promise<{ ok: true } | OperatorError> {
  if (!isSelfServiceMode()) return { error: 'Essai indisponible sur cette instance' }
  const context = await requireOwnerContext()
  if (!context.ok) return { error: context.error }
  if (!context.user.email || !context.user.email_confirmed_at) {
    return { error: 'Votre adresse email doit être vérifiée' }
  }

  const admin = createAdminClient()
  const [{ data: organization }, { data: entitlementRow }] = await Promise.all([
    admin.from('organizations').select('name, email, siret').eq('id', context.organizationId).single(),
    admin.from('organization_entitlements').select('preferred_tier').eq('organization_id', context.organizationId).maybeSingle(),
  ])
  const preferredTier = isSellableTier(entitlementRow?.preferred_tier)
    ? entitlementRow.preferred_tier
    : isSellableTier(context.user.user_metadata?.pending_trial_tier)
      ? context.user.user_metadata.pending_trial_tier
      : 'pro'
  if (!organization?.siret) return { error: 'Le SIRET est obligatoire pour démarrer l’essai' }

  type TrialResponse = {
    entitlement: EntitlementSyncPayload
    modules: Record<string, boolean>
    quota_config: Record<string, number>
  }
  const result = await postOperator<TrialResponse>('/api/operator/self-service/trial', {
    organization_id: context.organizationId,
    app_url: process.env.NEXT_PUBLIC_APP_URL,
    company_name: organization.name,
    contact_email: context.user.email,
    siret: organization.siret,
    preferred_tier: preferredTier,
    signup_source: context.user.user_metadata?.signup_source ?? 'direct',
  })
  if ('error' in result) return result

  const [{ error: entitlementError }, { error: moduleError }] = await Promise.all([
    admin.from('organization_entitlements').upsert({
      organization_id: context.organizationId,
      ...result.entitlement,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id' }),
    admin.from('organization_modules').upsert({
      organization_id: context.organizationId,
      modules: result.modules,
      quota_config: result.quota_config,
      overflow_mode: 'block',
      ai_billing_mode: 'orsayn_shared',
      quota_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id' }),
  ])
  if (entitlementError || moduleError) {
    console.error('[activateTrial.local-sync]', entitlementError || moduleError)
    return { error: 'L’essai est créé, mais la synchronisation locale doit être relancée' }
  }
  return { ok: true }
}

export async function createSelfServiceCheckout(
  tier: SellableTier,
  returnUrl: string,
): Promise<{ url: string } | OperatorError> {
  if (!isSelfServiceMode() || !isSellableTier(tier)) return { error: 'Formule invalide' }
  const registration = await registerSelfServiceOrganization()
  if ('error' in registration) return registration
  const context = await requireOwnerContext()
  if (!context.ok) return { error: context.error }
  const appOrigin = new URL(process.env.NEXT_PUBLIC_APP_URL || returnUrl).origin
  const safeReturnUrl = new URL(returnUrl, appOrigin)
  if (safeReturnUrl.origin !== appOrigin) return { error: 'URL de retour invalide' }
  return postOperator<{ url: string }>('/api/stripe/checkout-session', {
    organization_id: context.organizationId,
    tier,
    return_url: safeReturnUrl.toString(),
  })
}

export async function requestSelfServiceCancellation(reason: string): Promise<{ ok: true; cancel_at: string } | OperatorError> {
  if (!isSelfServiceMode()) return { error: 'Résiliation indisponible sur cette instance' }
  const context = await requireOwnerContext()
  if (!context.ok) return { error: context.error }
  return postOperator<{ ok: true; cancel_at: string }>('/api/stripe/cancel-subscription', {
    organization_id: context.organizationId,
    reason: reason.trim().slice(0, 500),
  })
}

export async function readLocalEntitlementForCurrentOrganization() {
  const context = await requireOwnerContext()
  if (!context.ok) return null
  const { data } = await createAdminClient()
    .from('organization_entitlements')
    .select('*')
    .eq('organization_id', context.organizationId)
    .maybeSingle()
  return data ? entitlementFromDb(data as Record<string, unknown>) : null
}
