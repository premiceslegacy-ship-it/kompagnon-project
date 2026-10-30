import { NextRequest, NextResponse } from 'next/server'
import { verifyCronSecret } from '@/lib/cron-auth'
import { sendAuthEmail } from '@/lib/email'
import {
  buildAtelierOnboardingReminderEmail,
  type OnboardingReminderStage,
} from '@/lib/email/commercial'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const MAX_CANDIDATES = 200
const FIRST_DELAY_MS = 2 * 60 * 60 * 1000
const SECOND_DELAY_MS = 22 * 60 * 60 * 1000
const FINAL_DELAY_MS = 48 * 60 * 60 * 1000
const MAX_ACCOUNT_AGE_MS = 14 * 24 * 60 * 60 * 1000

type Candidate = {
  id: string
  email: string
  full_name: string | null
  created_at: string
}

type ReminderEvent = {
  entity_id: string | null
  metadata: { stage?: OnboardingReminderStage } | null
  created_at: string
}

function nextStage(candidate: Candidate, events: ReminderEvent[], now: number): OnboardingReminderStage | null {
  const age = now - new Date(candidate.created_at).getTime()
  const sent = events
    .filter((event) => event.entity_id === candidate.id)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  if (sent.length === 0) return age >= FIRST_DELAY_MS ? 'first' : null

  const latest = sent.at(-1)
  const latestStage = latest?.metadata?.stage
  const sinceLatest = latest ? now - new Date(latest.created_at).getTime() : 0
  if (latestStage === 'first' && sinceLatest >= SECOND_DELAY_MS) return 'second'
  if (latestStage === 'second' && sinceLatest >= FINAL_DELAY_MS) return 'final'
  return null
}

async function runJob() {
  const admin = createAdminClient()
  const now = Date.now()
  const oldestAllowed = new Date(now - MAX_ACCOUNT_AGE_MS).toISOString()
  const firstEligible = new Date(now - FIRST_DELAY_MS).toISOString()
  const { data, error } = await admin
    .from('profiles')
    .select('id, email, full_name, created_at')
    .eq('onboarding_done', false)
    .gte('created_at', oldestAllowed)
    .lte('created_at', firstEligible)
    .order('created_at', { ascending: true })
    .limit(MAX_CANDIDATES)

  if (error) {
    console.error('[cron onboarding-reminders] profiles', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const candidates = (data ?? []) as Candidate[]
  if (candidates.length === 0) {
    return NextResponse.json({ candidates: 0, eligible: 0, sent: 0, errors: [] })
  }

  const userIds = candidates.map((candidate) => candidate.id)
  const [{ data: memberships, error: membershipError }, { data: reminderRows, error: reminderError }] = await Promise.all([
    admin
      .from('memberships')
      .select('user_id, organization_id')
      .in('user_id', userIds)
      .eq('is_active', true),
    admin
      .from('activity_log')
      .select('entity_id, metadata, created_at')
      .eq('action', 'onboarding.reminder.sent')
      .in('entity_id', userIds),
  ])

  if (membershipError || reminderError) {
    const message = membershipError?.message ?? reminderError?.message ?? 'Unable to load reminder state'
    console.error('[cron onboarding-reminders] state', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const organizationByUser = new Map(
    (memberships ?? []).map((membership) => [membership.user_id as string, membership.organization_id as string]),
  )
  const reminderEvents = (reminderRows ?? []) as ReminderEvent[]
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
  if (!appUrl) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL missing' }, { status: 500 })
  }

  let eligible = 0
  let sent = 0
  const errors: Array<{ userId: string; error: string }> = []

  for (const candidate of candidates) {
    const stage = nextStage(candidate, reminderEvents, now)
    if (!stage) continue
    eligible += 1

    const organizationId = organizationByUser.get(candidate.id)
    if (!organizationId) {
      errors.push({ userId: candidate.id, error: 'organization_not_found' })
      continue
    }

    // Les profils sont créés au signup, avant confirmation : ne relancer que
    // les comptes dont l'adresse a réellement été confirmée.
    const { data: authUser, error: authError } = await admin.auth.admin.getUserById(candidate.id)
    if (authError || !authUser.user?.email_confirmed_at || authUser.user.is_anonymous) continue

    const email = buildAtelierOnboardingReminderEmail({
      appUrl,
      firstName: candidate.full_name?.split(/\s+/)[0] ?? null,
      stage,
    })
    const result = await sendAuthEmail({ to: candidate.email, subject: email.subject, html: email.html })
    if (result.error) {
      errors.push({ userId: candidate.id, error: result.error })
      continue
    }

    const { error: logError } = await admin.from('activity_log').insert({
      organization_id: organizationId,
      user_id: candidate.id,
      action: 'onboarding.reminder.sent',
      entity_type: 'profile',
      entity_id: candidate.id,
      metadata: { stage },
    })
    if (logError) {
      // L'email est déjà parti : signaler l'échec de déduplication afin qu'il
      // soit visible, au lieu de prétendre que l'exécution est complète.
      errors.push({ userId: candidate.id, error: `log_failed: ${logError.message}` })
      continue
    }
    sent += 1
  }

  return NextResponse.json({ candidates: candidates.length, eligible, sent, errors })
}

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get('x-cron-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runJob()
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get('x-cron-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runJob()
}
