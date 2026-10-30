import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createOperatorAdminClient } from '@/lib/supabase/operator'
import { ATELIER_SENDER_NAME } from '@/lib/brand'
import { verifyCronSecret } from '@/lib/cron-auth'
import { expireTrialForInstance } from '@/lib/operator/trial-lifecycle'
import {
  buildAtelierPostTrialReminderEmail,
  buildAtelierTrialEndedEmail,
  buildAtelierTrialReminderEmail,
} from '@/lib/email/commercial'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 500

async function collectPages<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}

type BuiltEmail = { subject: string; html: string }

async function recordCommercialEmail(input: {
  sourceInstance: string
  organizationId: string
  recipientEmail: string
  eventType: string
  template: string
  email: BuiltEmail
  delivery: { status: 'sent' | 'failed' | 'skipped'; error: string | null }
}) {
  const operator = createOperatorAdminClient()
  const { error } = await operator.from('operator_commercial_events').insert({
    source_instance: input.sourceInstance,
    organization_id: input.organizationId,
    event_type: input.eventType,
    tier_context: 'pro',
    sent_by: 'operator_cron',
    email_template: input.template,
    subject_preview: input.email.subject,
    recipient_email: input.recipientEmail,
    delivery_status: input.delivery.status === 'sent' ? 'sent' : 'failed',
    notes: input.delivery.error,
    metadata: {},
  })
  if (error) console.error('[operator/cron/quota-alerts.commercial-event]', error)
}

async function deliverEmail(to: string, built: BuiltEmail): Promise<{ status: 'sent' | 'failed' | 'skipped'; error: string | null }> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const fromAddress = process.env.RESEND_FROM_ADDRESS?.trim()
  const fromName = ATELIER_SENDER_NAME
  if (!apiKey || !fromAddress) return { status: 'skipped', error: 'RESEND non configuré' }

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: `${fromName} <${fromAddress}>`,
    to,
    subject: built.subject,
    html: built.html,
    replyTo: process.env.RESEND_REPLY_TO_ADDRESS?.trim() || 'contact@orsayn.fr',
  })
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

  // ── 0. Expirer automatiquement les essais dépassés ────────────────────────────
  // Un essai non converti garde ses droits indéfiniment si personne ne clique
  // manuellement sur "Terminer essai" dans le cockpit — cette section ferme ce trou.

  const expiredTrials = await collectPages<{ source_instance: string; organization_id: string; trial_tier: string | null }>((from, to) => operator
    .from('operator_client_subscriptions')
    .select('source_instance, organization_id, trial_tier')
    .not('trial_tier', 'is', null)
    .not('trial_ends_at', 'is', null)
    .eq('trial_converted', false)
    .is('stripe_subscription_id', null)
    .lt('trial_ends_at', now.toISOString())
    .range(from, to))

  let trialsExpired = 0
  let trialsFailed = 0

  for (const row of expiredTrials) {
    try {
      const result = await expireTrialForInstance({
        sourceInstance: row.source_instance,
        organizationId: row.organization_id,
        targetTier: 'setup_only',
        actorEmail: 'cron@orsayn',
        eventType: 'trial_ended_auto',
      })
      if (result.status === 'expired') {
        trialsExpired++
        const { data: setting } = await operator.from('operator_client_settings')
          .select('contact_email, app_url')
          .eq('source_instance', row.source_instance)
          .eq('organization_id', row.organization_id)
          .maybeSingle()
        if (setting?.contact_email) {
          const email = buildAtelierTrialEndedEmail({ appUrl: setting.app_url ?? '' })
          const delivery = await deliverEmail(setting.contact_email, email)
          await recordCommercialEmail({
            sourceInstance: row.source_instance,
            organizationId: row.organization_id,
            recipientEmail: setting.contact_email,
            eventType: 'trial_expired',
            template: 'trial_ended',
            email,
            delivery,
          })
        }
      }
    } catch (error) {
      trialsFailed++
      console.error('[operator/cron/quota-alerts.expireTrial]', row.source_instance, error)
    }
  }

  // Rappels uniques à J-7 et J-2. Les marqueurs sont conservés en base pour
  // rendre le cron idempotent, y compris après un redéploiement.
  const activeTrials = await collectPages<{
    source_instance: string
    organization_id: string
    trial_ends_at: string
    trial_tier: string | null
    preferred_tier: string | null
    trial_reminders_sent: string[] | null
  }>((from, to) => operator.from('operator_client_subscriptions')
    .select('source_instance, organization_id, trial_ends_at, trial_tier, preferred_tier, trial_reminders_sent')
    .not('trial_tier', 'is', null)
    .eq('trial_converted', false)
    .is('stripe_subscription_id', null)
    .gt('trial_ends_at', now.toISOString())
    .range(from, to))
  let trialRemindersSent = 0
  for (const trial of activeTrials) {
    const daysLeft = Math.ceil((new Date(trial.trial_ends_at).getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
    const marker = daysLeft <= 2 ? 'j-2' : daysLeft <= 4 ? 'j-4' : null
    if (!marker || trial.trial_reminders_sent?.includes(marker)) continue
    const { data: setting } = await operator.from('operator_client_settings')
      .select('contact_email, app_url')
      .eq('source_instance', trial.source_instance)
      .eq('organization_id', trial.organization_id)
      .maybeSingle()
    if (!setting?.contact_email) continue
    const email = buildAtelierTrialReminderEmail({
      appUrl: setting.app_url ?? '',
      daysLeft,
      trialEndsAt: trial.trial_ends_at,
      preferredTier: trial.preferred_tier,
    })
    const delivery = await deliverEmail(setting.contact_email, email)
    await recordCommercialEmail({
      sourceInstance: trial.source_instance,
      organizationId: trial.organization_id,
      recipientEmail: setting.contact_email,
      eventType: marker === 'j-2' ? 'trial_expiry_2d' : 'trial_expiry_4d',
      template: marker,
      email,
      delivery,
    })
    if (delivery.status === 'sent') {
      const reminders = [...(trial.trial_reminders_sent ?? []), marker]
      await operator.from('operator_client_subscriptions').update({ trial_reminders_sent: reminders }).eq('source_instance', trial.source_instance).eq('organization_id', trial.organization_id)
      trialRemindersSent++
    }
  }

  // Deux suivis après l'essai (J+3 puis J+10). Ils sont distincts de l'email
  // envoyé au moment exact de l'expiration et restent idempotents grâce au même
  // tableau de marqueurs que les rappels pré-essai.
  const postTrialCandidates = await collectPages<{
    source_instance: string
    organization_id: string
    trial_ends_at: string
    trial_reminders_sent: string[] | null
  }>((from, to) => operator.from('operator_client_subscriptions')
    .select('source_instance, organization_id, trial_ends_at, trial_reminders_sent')
    .eq('access_status', 'expired')
    .eq('trial_converted', false)
    .is('stripe_subscription_id', null)
    .not('trial_ends_at', 'is', null)
    .lte('trial_ends_at', now.toISOString())
    .gte('trial_ends_at', new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString())
    .range(from, to))

  let postTrialRemindersSent = 0
  for (const trial of postTrialCandidates) {
    const daysSinceEnd = Math.floor((now.getTime() - new Date(trial.trial_ends_at).getTime()) / (24 * 60 * 60 * 1000))
    const marker = daysSinceEnd >= 10 ? 'post-10' : daysSinceEnd >= 3 ? 'post-3' : null
    if (!marker || trial.trial_reminders_sent?.includes(marker)) continue
    const { data: setting } = await operator.from('operator_client_settings')
      .select('contact_email, app_url')
      .eq('source_instance', trial.source_instance)
      .eq('organization_id', trial.organization_id)
      .maybeSingle()
    if (!setting?.contact_email) continue
    const stage = marker === 'post-10' ? 'final' : 'first'
    const email = buildAtelierPostTrialReminderEmail({ appUrl: setting.app_url ?? '', stage })
    const delivery = await deliverEmail(setting.contact_email, email)
    await recordCommercialEmail({
      sourceInstance: trial.source_instance,
      organizationId: trial.organization_id,
      recipientEmail: setting.contact_email,
      eventType: marker === 'post-10' ? 'trial_post_expiry_10d' : 'trial_post_expiry_3d',
      template: marker,
      email,
      delivery,
    })
    if (delivery.status === 'sent') {
      await operator.from('operator_client_subscriptions')
        .update({ trial_reminders_sent: [...(trial.trial_reminders_sent ?? []), marker] })
        .eq('source_instance', trial.source_instance)
        .eq('organization_id', trial.organization_id)
      postTrialRemindersSent++
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

  // Les alertes de quotas IA ne sont pas activées automatiquement. Le suivi
  // reste disponible dans le cockpit et pourra être réintroduit avec une
  // adresse destinataire et une décision commerciale explicite.
  const created = 0
  const autoSent = 0
  const autoFailed = 0

  console.log(`[operator/cron/quota-alerts] trials_expired=${trialsExpired} trials_failed=${trialsFailed} trial_reminders=${trialRemindersSent} post_trial_reminders=${postTrialRemindersSent} pending_manual=${pendingManualCount ?? 0} quota_alerts=disabled`)
  return NextResponse.json({
    trials_expired: trialsExpired,
    trials_failed: trialsFailed,
    trial_reminders_sent: trialRemindersSent,
    post_trial_reminders_sent: postTrialRemindersSent,
    pending_manual: pendingManualCount ?? 0,
    created,
    auto_sent: autoSent,
    auto_failed: autoFailed,
  })
}
