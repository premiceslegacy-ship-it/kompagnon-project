import { NextRequest, NextResponse } from 'next/server'
import { verifyCronSecret } from '@/lib/cron-auth'
import { registerPendingSelfServiceSignup } from '@/lib/data/mutations/subscription-self-service'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

async function runJob() {
  const admin = createAdminClient()
  const { data: profiles, error } = await admin.from('profiles')
    .select('id, email, full_name, created_at')
    .eq('onboarding_done', false)
    .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const userIds = (profiles ?? []).map((profile) => profile.id)
  const { data: memberships, error: membershipError } = userIds.length > 0
    ? await admin.from('memberships').select('user_id, organization_id').in('user_id', userIds).eq('is_active', true)
    : { data: [], error: null }
  if (membershipError) return NextResponse.json({ error: membershipError.message }, { status: 500 })
  const organizationByUser = new Map((memberships ?? []).map((row) => [row.user_id, row.organization_id]))

  let synced = 0
  const errors: Array<{ userId: string; error: string }> = []
  for (const profile of profiles ?? []) {
    const organizationId = organizationByUser.get(profile.id)
    if (!organizationId) {
      errors.push({ userId: profile.id, error: 'organization_not_found' })
      continue
    }
    const result = await registerPendingSelfServiceSignup({
      userId: profile.id,
      organizationId,
      email: profile.email,
      fullName: profile.full_name,
    })
    if ('error' in result) errors.push({ userId: profile.id, error: result.error })
    else synced++
  }
  return NextResponse.json({ candidates: profiles?.length ?? 0, synced, errors })
}

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get('x-cron-secret'))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return runJob()
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get('x-cron-secret'))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return runJob()
}
