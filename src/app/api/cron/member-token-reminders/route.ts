import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCronSecret } from '@/lib/cron-auth'
import { sendMemberSpaceTokenReminder } from '@/lib/data/mutations/members'

export const dynamic = 'force-dynamic'

/**
 * Cron quotidien - envoie un rappel par email aux membres dont le lien magique
 * /mon-espace expire dans les 3 prochains jours. Un seul rappel par token
 * (member_space_tokens.reminder_sent_at sert de verrou anti-doublon).
 *
 * Le rappel génère un nouveau lien : le raw token original n'est jamais stocké
 * en clair, seul son hash l'est — impossible de renvoyer le même lien.
 */
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

async function runJob(): Promise<NextResponse> {
  const admin = createAdminClient()
  const now = new Date()
  const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

  const { data: tokens, error } = await admin
    .from('member_space_tokens')
    .select('id, member_id, expires_at')
    .is('reminder_sent_at', null)
    .is('last_used_at', null) // token déjà consommé = membre déjà connecté, rappel inutile
    .gte('expires_at', now.toISOString())
    .lte('expires_at', in3Days.toISOString())

  if (error) {
    console.error('[cron member-token-reminders] select', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let sent = 0
  const errors: { tokenId: string; error: string }[] = []

  for (const token of tokens ?? []) {
    const { error: sendError } = await sendMemberSpaceTokenReminder(token.id, token.member_id)
    if (sendError) errors.push({ tokenId: token.id, error: sendError })
    else sent++
  }

  return NextResponse.json({
    window: { from: now.toISOString(), to: in3Days.toISOString() },
    candidates: tokens?.length ?? 0,
    sent,
    errors,
  })
}
