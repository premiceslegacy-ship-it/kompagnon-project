import { NextRequest, NextResponse } from 'next/server'
import { isOperatorModeEnabled, createOperatorAdminClient } from '@/lib/supabase/operator'
import { verifyOauthState } from '@/lib/super-pdp/oauth-state'
import { encryptSecret } from '@/lib/crypto/secrets'
import { isSuperPdpTokenResponse, isSuperPdpCompany, type SuperPdpTokenResponse, type SuperPdpCompany } from '@/lib/super-pdp/types'
import { getOperatorClientContext, syncClientQuotaConfig } from '@/lib/operator/trial-lifecycle'
import { normalizeEinvoicingConfig } from '@/lib/einvoicing-config'

export const dynamic = 'force-dynamic'

// Callback OAuth Super PDP (authorization_code, multi-tenant) : deploye sur toutes
// les instances via le meme build, mais actif uniquement en mode cockpit — c'est
// le cockpit qui detient et rafraichit les tokens (voir docs/atelier-facturation-electronique.md
// §7.2/§7.3). Une instance cliente reçoit 404 sur cette route.
function redirectWithStatus(baseUrl: string, status: 'success' | 'error', detail?: string) {
  const url = new URL('/settings', baseUrl)
  url.searchParams.set('tab', 'facturation')
  url.searchParams.set('oauth', status)
  if (detail) url.searchParams.set('oauth_detail', detail)
  return NextResponse.redirect(url)
}

export async function GET(req: NextRequest) {
  if (!isOperatorModeEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const searchParams = req.nextUrl.searchParams
  const oauthError = searchParams.get('error')
  const code = searchParams.get('code')
  const state = verifyOauthState(searchParams.get('state'))

  if (!state) {
    return NextResponse.json({ error: 'State invalide ou expiré' }, { status: 400 })
  }

  const operator = createOperatorAdminClient()
  const context = await getOperatorClientContext(state.source_instance, state.organization_id)
  console.log('[oauth/callback DEBUG]', JSON.stringify({
    stateSourceInstance: state.source_instance,
    stateOrgId: state.organization_id,
    einvoicingConfig: context.subscription.einvoicingConfig,
    appUrl: context.appUrl,
  }))
  if (context.subscription.einvoicingConfig.mode !== 'super_pdp') {
    return NextResponse.json({ error: 'Facturation électronique non activée pour cette organisation' }, { status: 403 })
  }
  const { appUrl } = context

  if (!appUrl) {
    return NextResponse.json({ error: 'Instance cliente introuvable pour ce state' }, { status: 404 })
  }

  if (oauthError || !code) {
    return redirectWithStatus(appUrl, 'error', oauthError ?? 'missing_code')
  }

  const endpoint = process.env.SUPER_PDP_API_ENDPOINT?.trim()
  const clientId = process.env.SUPER_PDP_CLIENT_ID?.trim()
  const clientSecret = process.env.SUPER_PDP_CLIENT_SECRET?.trim()
  const redirectUri = process.env.SUPER_PDP_REDIRECT_URL?.trim()
  const encryptionKey = process.env.SUPER_PDP_ENCRYPTION_KEY?.trim()
  // Le cockpit ne porte qu'une paire de credentials à la fois (une app OAuth = un
  // environnement) : la bascule sandbox/production se fait en redéployant le cockpit
  // avec l'autre .env, pas dynamiquement par requête. Cohérent tant qu'un seul
  // cockpit sert tous les clients en sandbox (état actuel, Phase 1).
  const environment = process.env.SUPER_PDP_ENV?.trim() === 'production' ? 'production' : 'sandbox'

  if (!endpoint || !clientId || !clientSecret || !redirectUri || !encryptionKey) {
    return NextResponse.json({ error: 'Configuration Super PDP incomplète côté cockpit' }, { status: 500 })
  }

  let tokenResponse: SuperPdpTokenResponse
  try {
    const resp = await fetch(`${endpoint}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    })
    const body: unknown = await resp.json()
    if (!resp.ok || !isSuperPdpTokenResponse(body)) {
      return redirectWithStatus(appUrl, 'error', 'token_exchange_failed')
    }
    tokenResponse = body
  } catch {
    return redirectWithStatus(appUrl, 'error', 'token_exchange_failed')
  }

  let company: SuperPdpCompany
  try {
    const resp = await fetch(`${endpoint}/v1.beta/companies/me`, {
      headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
    })
    const body: unknown = await resp.json()
    if (!resp.ok || !isSuperPdpCompany(body)) {
      return redirectWithStatus(appUrl, 'error', 'company_lookup_failed')
    }
    company = body
  } catch {
    return redirectWithStatus(appUrl, 'error', 'company_lookup_failed')
  }

  const [accessTokenEncrypted, refreshTokenEncrypted] = await Promise.all([
    encryptSecret(tokenResponse.access_token, encryptionKey),
    encryptSecret(tokenResponse.refresh_token, encryptionKey),
  ])

  const { error: upsertError } = await operator
    .from('super_pdp_oauth_credentials')
    .upsert({
      source_instance: state.source_instance,
      organization_id: state.organization_id,
      access_token_encrypted: accessTokenEncrypted,
      refresh_token_encrypted: refreshTokenEncrypted,
      token_expires_at: new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString(),
      scopes: tokenResponse.scope ? tokenResponse.scope.split(' ').filter(Boolean) : [],
      environment,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'source_instance,organization_id' })

  if (upsertError) {
    return redirectWithStatus(appUrl, 'error', 'credentials_store_failed')
  }

  const updatedEinvoicingConfig = normalizeEinvoicingConfig({
    ...context.subscription.einvoicingConfig,
    mode: 'super_pdp',
    oauth_status: 'connected',
    oauth_connected_at: new Date().toISOString(),
    super_pdp_connection_id: String(company.id),
  })

  await operator
    .from('operator_client_subscriptions')
    .update({
      einvoicing_mode: updatedEinvoicingConfig.mode,
      einvoicing_provider: updatedEinvoicingConfig.provider,
      oauth_status: updatedEinvoicingConfig.oauth_status,
      oauth_connected_at: updatedEinvoicingConfig.oauth_connected_at,
      super_pdp_connection_id: updatedEinvoicingConfig.super_pdp_connection_id,
      updated_at: new Date().toISOString(),
    })
    .eq('source_instance', state.source_instance)
    .eq('organization_id', state.organization_id)

  const syncResult = await syncClientQuotaConfig(
    state.source_instance,
    state.organization_id,
    appUrl,
    context.subscription.tier,
    context.subscription.overflowMode,
    context.subscription.aiBillingMode,
    updatedEinvoicingConfig,
  )

  if (syncResult.status !== 'synced') {
    return redirectWithStatus(appUrl, 'error', 'config_sync_failed')
  }

  return redirectWithStatus(appUrl, 'success')
}
