import { NextRequest, NextResponse } from 'next/server'
import { verifyOperatorSignature } from '@/lib/operator'
import { recordOperatorClientEvent } from '@/lib/operator/trial-lifecycle'
import { createOperatorAdminClient, isOperatorModeEnabled } from '@/lib/supabase/operator'

// Notification instance -> cockpit pour l'activation self-service de la
// facturation electronique (voir docs/atelier-facturation-electronique.md).
// L'instance a deja ecrit sa propre config localement avant d'appeler cet
// endpoint : celui-ci garde le cockpit a jour en lecture (suivi commercial),
// jamais dans le chemin critique -- l'appelant ignore la reponse (best-effort).
// Meme pattern que src/app/api/operator/self-service/register/route.ts.

type Payload = {
  source_instance: string
  organization_id: string
  app_url: string
  action: 'oauth_started' | 'emission_toggled' | 'reception_toggled'
  emission_enabled?: boolean
  reception_enabled?: boolean
}

function isValidPayload(value: unknown): value is Payload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return (
    typeof row.source_instance === 'string'
    && typeof row.organization_id === 'string'
    && typeof row.app_url === 'string'
    && (row.action === 'oauth_started' || row.action === 'emission_toggled' || row.action === 'reception_toggled')
    && (row.emission_enabled === undefined || typeof row.emission_enabled === 'boolean')
    && (row.reception_enabled === undefined || typeof row.reception_enabled === 'boolean')
  )
}

export async function POST(req: NextRequest) {
  if (!isOperatorModeEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const secret = process.env.OPERATOR_CONFIG_SYNC_SECRET?.trim()
    || process.env.OPERATOR_INGEST_SECRET?.trim()
  if (!secret) return NextResponse.json({ error: 'Operator secret missing' }, { status: 500 })

  const rawBody = await req.text()
  if (!verifyOperatorSignature(rawBody, secret, req.headers.get('x-operator-signature'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let payload: unknown
  try { payload = JSON.parse(rawBody) } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!isValidPayload(payload)) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const allowedSource = process.env.OPERATOR_SELF_SERVICE_SOURCE_INSTANCE?.trim() || 'atelier-app'
  if (payload.source_instance !== allowedSource) {
    return NextResponse.json({ error: 'Source instance not allowed' }, { status: 403 })
  }

  const operator = createOperatorAdminClient()
  const now = new Date().toISOString()

  if (payload.action === 'oauth_started') {
    // Filet de securite : garantit que les lignes existent avant que le
    // callback OAuth ne tente son upsert -- ne touche jamais aux colonnes
    // einvoicing_*, ecrites par le callback OAuth lui-meme juste apres.
    const { error: settingsError } = await operator.from('operator_client_settings').upsert({
      source_instance: payload.source_instance,
      organization_id: payload.organization_id,
      app_url: payload.app_url,
      is_active: true,
      updated_at: now,
    }, { onConflict: 'source_instance,organization_id' })
    if (settingsError) {
      console.error('[self-service/einvoicing-activate.settings]', settingsError)
      return NextResponse.json({ error: 'Unable to register organization' }, { status: 500 })
    }

    const { data: subscription } = await operator.from('operator_client_subscriptions')
      .select('source_instance')
      .eq('source_instance', payload.source_instance)
      .eq('organization_id', payload.organization_id)
      .maybeSingle()
    if (!subscription) {
      const { error: subscriptionError } = await operator.from('operator_client_subscriptions').insert({
        source_instance: payload.source_instance,
        organization_id: payload.organization_id,
        tier: 'setup_only',
        access_status: 'locked',
        mrr_ht: 0,
        is_active: true,
        updated_at: now,
      })
      if (subscriptionError) {
        console.error('[self-service/einvoicing-activate.subscription]', subscriptionError)
        return NextResponse.json({ error: 'Unable to register subscription' }, { status: 500 })
      }
    }

    return NextResponse.json({ ok: true })
  }

  if (payload.action === 'emission_toggled') {
    const { error: updateError } = await operator
      .from('operator_client_subscriptions')
      .update({ super_pdp_emission_enabled: payload.emission_enabled === true, updated_at: now })
      .eq('source_instance', payload.source_instance)
      .eq('organization_id', payload.organization_id)
    if (updateError) {
      console.error('[self-service/einvoicing-activate.emission]', updateError)
      return NextResponse.json({ error: 'Unable to update emission setting' }, { status: 500 })
    }

    await recordOperatorClientEvent({
      sourceInstance: payload.source_instance,
      organizationId: payload.organization_id,
      eventCategory: 'einvoicing',
      eventType: payload.emission_enabled ? 'emission_enabled' : 'emission_disabled',
      actorEmail: null,
    })

    return NextResponse.json({ ok: true })
  }

  // action === 'reception_toggled' -- desactivable par le client lui-meme (choix
  // produit assume malgre l'obligation legale de reception), le cockpit reste tenu
  // a jour en lecture pour que le polling (cron einvoicing-poll) et le suivi
  // commercial reagissent au bon etat.
  const { error: updateError } = await operator
    .from('operator_client_subscriptions')
    .update({ super_pdp_reception_enabled: payload.reception_enabled === true, updated_at: now })
    .eq('source_instance', payload.source_instance)
    .eq('organization_id', payload.organization_id)
  if (updateError) {
    console.error('[self-service/einvoicing-activate.reception]', updateError)
    return NextResponse.json({ error: 'Unable to update reception setting' }, { status: 500 })
  }

  await recordOperatorClientEvent({
    sourceInstance: payload.source_instance,
    organizationId: payload.organization_id,
    eventCategory: 'einvoicing',
    eventType: payload.reception_enabled ? 'reception_enabled' : 'reception_disabled',
    actorEmail: null,
  })

  return NextResponse.json({ ok: true })
}
