import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createOperatorAdminClient } from '@/lib/supabase/operator'
import { QUOTA_DEFINITIONS } from '@/lib/quota-catalog'
import { verifyCronSecret } from '@/lib/cron-auth'
import { expireTrialForInstance } from '@/lib/operator/trial-lifecycle'

export const dynamic = 'force-dynamic'

// Seuil d'alerte : 85% du quota mensuel
const ALERT_THRESHOLD = 0.85
// Délai avant envoi automatique si pas d'action : 2 jours
const AUTO_SEND_DELAY_DAYS = 2

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function sendEmail(to: string, subject: string, bodyLines: string[]): Promise<{ status: 'sent' | 'failed' | 'skipped'; error: string | null }> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const fromAddress = process.env.RESEND_FROM_ADDRESS?.trim()
  const fromName = process.env.RESEND_FROM_NAME?.trim() || 'Orsayn'
  if (!apiKey || !fromAddress) return { status: 'skipped', error: 'RESEND non configuré' }

  const resend = new Resend(apiKey)
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
    ${bodyLines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
    <p style="margin-top:24px;color:#6b7280;font-size:13px">Orsayn</p>
  </div>`
  const { error } = await resend.emails.send({ from: `${fromName} <${fromAddress}>`, to, subject, html })
  if (error) return { status: 'failed', error: error.message }
  return { status: 'sent', error: null }
}

export async function POST(req: NextRequest) {
  if (process.env.OPERATOR_MODE !== 'true') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 })
  }
  if (!verifyCronSecret(req.headers.get('x-cron-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const operator = createOperatorAdminClient()
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]

  // ── 0. Expirer automatiquement les essais dépassés ────────────────────────────
  // Un essai non converti garde ses droits Expert indéfiniment si personne ne clique
  // manuellement sur "Terminer essai" dans le cockpit — cette section ferme ce trou.

  const { data: expiredTrials } = await operator
    .from('operator_client_subscriptions')
    .select('source_instance, organization_id')
    .not('trial_tier', 'is', null)
    .not('trial_ends_at', 'is', null)
    .eq('trial_converted', false)
    .lt('trial_ends_at', now.toISOString())

  let trialsExpired = 0
  let trialsFailed = 0

  for (const row of expiredTrials ?? []) {
    try {
      const result = await expireTrialForInstance({
        sourceInstance: row.source_instance,
        organizationId: row.organization_id,
        targetTier: 'setup_only',
        actorEmail: 'cron@orsayn',
        eventType: 'trial_ended_auto',
      })
      if (result.status === 'expired') trialsExpired++
    } catch (error) {
      trialsFailed++
      console.error('[operator/cron/quota-alerts.expireTrial]', row.source_instance, error)
    }
  }

  // ── 0bis. Compter les instances en configuration bloquée ──────────────────────
  // pending_manual signifie qu'un changement de tier/module n'a jamais atteint
  // l'instance cliente (app_url ou organization_id manquant) — visible aussi en
  // bandeau dans le cockpit, journalisé ici pour garder une trace dans les logs cron.

  const { count: pendingManualCount } = await operator
    .from('operator_client_settings')
    .select('source_instance', { count: 'exact', head: true })
    .eq('config_sync_status', 'pending_manual')

  // ── 1. Créer des alertes pour les clients qui dépassent le seuil ──────────────

  const { data: quotas } = await operator
    .from('operator_client_quotas')
    .select('source_instance, organization_id, quota_feature, quota_monthly, current_quantity')
    .eq('period_start', monthStart)

  const { data: subscriptions } = await operator
    .from('operator_client_subscriptions')
    .select('source_instance, organization_id, tier')

  const { data: settings } = await operator
    .from('operator_client_settings')
    .select('source_instance, organization_id, label')

  // Clé composite : une instance mutualisée porte plusieurs organisations, chacune
  // avec son propre tier/label/quotas — une clé source_instance seule les fusionnerait.
  const orgKey = (sourceInstance: string, organizationId: string) => `${sourceInstance}::${organizationId}`

  const tierByOrg = new Map((subscriptions ?? []).map((s) => [orgKey(s.source_instance, s.organization_id), s.tier]))
  const labelByOrg = new Map((settings ?? []).map((s) => [orgKey(s.source_instance, s.organization_id), s.label ?? s.source_instance]))

  // Quota le plus chargé par organisation
  type AlertCandidate = { sourceInstance: string; organizationId: string; feature: string; pct: number; featureLabel: string }
  const candidatesByOrg = new Map<string, AlertCandidate>()

  for (const quota of quotas ?? []) {
    const monthly = Number(quota.quota_monthly)
    const current = Number(quota.current_quantity)
    if (monthly <= 0) continue
    const pct = current / monthly
    if (pct < ALERT_THRESHOLD) continue
    const key = orgKey(quota.source_instance, quota.organization_id)
    const tier = tierByOrg.get(key)
    if (tier === 'expert') continue // illimité en pratique

    const existing = candidatesByOrg.get(key)
    if (!existing || pct > existing.pct) {
      candidatesByOrg.set(key, {
        sourceInstance: quota.source_instance,
        organizationId: quota.organization_id,
        feature: quota.quota_feature,
        pct,
        featureLabel: QUOTA_DEFINITIONS[quota.quota_feature as keyof typeof QUOTA_DEFINITIONS]?.label ?? quota.quota_feature,
      })
    }
  }

  // Ne pas créer de doublon si une alerte pending_review existe déjà ce mois
  const { data: existingAlerts } = await operator
    .from('operator_commercial_events')
    .select('source_instance, organization_id')
    .eq('delivery_status', 'pending_review')
    .eq('event_type', 'quota_alert_auto')
    .gte('sent_at', `${monthStart}T00:00:00Z`)

  const alreadyAlerted = new Set((existingAlerts ?? []).map((e) => orgKey(e.source_instance, e.organization_id ?? '')))

  let created = 0
  for (const candidate of candidatesByOrg.values()) {
    const key = orgKey(candidate.sourceInstance, candidate.organizationId)
    if (alreadyAlerted.has(key)) continue
    const tier = tierByOrg.get(key) ?? 'setup_only'
    const label = labelByOrg.get(key) ?? candidate.sourceInstance
    const pctLabel = `${Math.round(candidate.pct * 100)}%`
    const autoSendAfter = new Date(now.getTime() + AUTO_SEND_DELAY_DAYS * 24 * 60 * 60 * 1000).toISOString()

    await operator.from('operator_commercial_events').insert({
      source_instance: candidate.sourceInstance,
      organization_id: candidate.organizationId,
      event_type: 'quota_alert_auto',
      tier_context: tier,
      sent_by: 'cron_auto',
      actor_email: 'cron@orsayn',
      delivery_status: 'pending_review',
      auto_send_after: autoSendAfter,
      email_template: 'quota-alert',
      subject_preview: `Atelier : quota ${candidate.featureLabel} atteint ${pctLabel} — ${label}`,
      body_text: [
        `Bonjour,`,
        `Je vous contacte car l'usage de ${label} sur la fonctionnalité "${candidate.featureLabel}" approche de la limite mensuelle (${pctLabel} consomme actuellement).`,
        `Votre offre actuelle est ${tier}. Pour continuer à utiliser cette fonctionnalité sans interruption, un passage au palier supérieur peut être utile.`,
        `Je reste disponible pour en discuter et ajuster votre offre si besoin.`,
      ].join('\n'),
      notes: `Alerte automatique — ${pctLabel} de "${candidate.featureLabel}" consomme`,
      metadata: { quota_feature: candidate.feature, pct: Math.round(candidate.pct * 100), client_label: label },
    })
    created++
  }

  // ── 2. Envoyer les alertes qui ont dépassé auto_send_after ───────────────────

  const { data: pendingAlerts } = await operator
    .from('operator_commercial_events')
    .select('id, source_instance, subject_preview, body_text, metadata')
    .eq('delivery_status', 'pending_review')
    .lt('auto_send_after', now.toISOString())

  let autoSent = 0
  let autoFailed = 0

  for (const alert of pendingAlerts ?? []) {
    const meta = (alert.metadata ?? {}) as Record<string, unknown>
    const recipientEmail = meta.recipient_email as string | undefined

    let deliveryStatus: 'sent' | 'failed' | 'skipped' = 'skipped'
    let deliveryError: string | null = null

    if (recipientEmail && alert.body_text && alert.subject_preview) {
      const bodyLines = alert.body_text.split('\n').filter(Boolean)
      const result = await sendEmail(recipientEmail, alert.subject_preview, bodyLines)
      deliveryStatus = result.status
      deliveryError = result.error
    }

    await operator
      .from('operator_commercial_events')
      .update({
        delivery_status: deliveryStatus === 'sent' ? 'sent' : 'failed',
        sent_at: now.toISOString(),
        metadata: { ...(meta as object), delivery_status: deliveryStatus, delivery_error: deliveryError, auto_sent: true },
      })
      .eq('id', alert.id)

    if (deliveryStatus === 'sent') autoSent++
    else autoFailed++
  }

  console.log(`[operator/cron/quota-alerts] trials_expired=${trialsExpired} trials_failed=${trialsFailed} pending_manual=${pendingManualCount ?? 0} created=${created} auto_sent=${autoSent} auto_failed=${autoFailed}`)
  return NextResponse.json({
    trials_expired: trialsExpired,
    trials_failed: trialsFailed,
    pending_manual: pendingManualCount ?? 0,
    created,
    auto_sent: autoSent,
    auto_failed: autoFailed,
  })
}
