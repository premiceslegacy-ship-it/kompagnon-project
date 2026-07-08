import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createOperatorAdminClient } from '@/lib/supabase/operator'
import { QUOTA_DEFINITIONS } from '@/lib/quota-catalog'
import { verifyCronSecret } from '@/lib/cron-auth'

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

  // ── 1. Créer des alertes pour les clients qui dépassent le seuil ──────────────

  const { data: quotas } = await operator
    .from('operator_client_quotas')
    .select('source_instance, quota_feature, quota_monthly, current_quantity')
    .eq('period_start', monthStart)

  const { data: subscriptions } = await operator
    .from('operator_client_subscriptions')
    .select('source_instance, tier')

  const { data: settings } = await operator
    .from('operator_client_settings')
    .select('source_instance, label')

  const tierBySource = new Map((subscriptions ?? []).map((s) => [s.source_instance, s.tier]))
  const labelBySource = new Map((settings ?? []).map((s) => [s.source_instance, s.label ?? s.source_instance]))

  // Quota le plus chargé par client
  type AlertCandidate = { sourceInstance: string; feature: string; pct: number; featureLabel: string }
  const candidatesBySource = new Map<string, AlertCandidate>()

  for (const quota of quotas ?? []) {
    const monthly = Number(quota.quota_monthly)
    const current = Number(quota.current_quantity)
    if (monthly <= 0) continue
    const pct = current / monthly
    if (pct < ALERT_THRESHOLD) continue
    const tier = tierBySource.get(quota.source_instance)
    if (tier === 'expert') continue // illimité en pratique

    const existing = candidatesBySource.get(quota.source_instance)
    if (!existing || pct > existing.pct) {
      candidatesBySource.set(quota.source_instance, {
        sourceInstance: quota.source_instance,
        feature: quota.quota_feature,
        pct,
        featureLabel: QUOTA_DEFINITIONS[quota.quota_feature as keyof typeof QUOTA_DEFINITIONS]?.label ?? quota.quota_feature,
      })
    }
  }

  // Ne pas créer de doublon si une alerte pending_review existe déjà ce mois
  const { data: existingAlerts } = await operator
    .from('operator_commercial_events')
    .select('source_instance')
    .eq('delivery_status', 'pending_review')
    .eq('event_type', 'quota_alert_auto')
    .gte('sent_at', `${monthStart}T00:00:00Z`)

  const alreadyAlerted = new Set((existingAlerts ?? []).map((e) => e.source_instance))

  let created = 0
  for (const candidate of candidatesBySource.values()) {
    if (alreadyAlerted.has(candidate.sourceInstance)) continue
    const tier = tierBySource.get(candidate.sourceInstance) ?? 'setup_only'
    const label = labelBySource.get(candidate.sourceInstance) ?? candidate.sourceInstance
    const pctLabel = `${Math.round(candidate.pct * 100)}%`
    const autoSendAfter = new Date(now.getTime() + AUTO_SEND_DELAY_DAYS * 24 * 60 * 60 * 1000).toISOString()

    await operator.from('operator_commercial_events').insert({
      source_instance: candidate.sourceInstance,
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

  console.log(`[operator/cron/quota-alerts] created=${created} auto_sent=${autoSent} auto_failed=${autoFailed}`)
  return NextResponse.json({ created, auto_sent: autoSent, auto_failed: autoFailed })
}
