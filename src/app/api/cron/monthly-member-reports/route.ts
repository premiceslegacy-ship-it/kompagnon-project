import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCronSecret } from '@/lib/cron-auth'
import { sendMemberHoursReport } from '@/lib/data/mutations/members'

export const dynamic = 'force-dynamic'

/**
 * Cron mensuel — envoie le rapport d'heures du mois précédent à chaque membre individuel
 * ayant un email, pour chaque organisation avec auto_send_member_reports = true.
 *
 * Programmé dans vercel.json : "0 6 1 * *" (1er du mois à 6h UTC).
 */
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get('x-cron-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runJob()
}

// Permet le déclenchement manuel depuis Vercel Cron (GET)
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get('x-cron-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runJob()
}

async function runJob(): Promise<NextResponse> {
  const admin = createAdminClient()

  // Bornes du mois précédent
  const now = new Date()
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const firstOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastOfPrevMonth  = new Date(now.getFullYear(), now.getMonth(),     0)
  const dateFrom = firstOfPrevMonth.toISOString().slice(0, 10)
  const dateTo   = lastOfPrevMonth.toISOString().slice(0, 10)

  void firstOfThisMonth

  // Orgs ayant activé l'envoi automatique
  const { data: orgs, error: orgErr } = await admin
    .from('organizations')
    .select('id, name, auto_send_member_reports')
    .eq('auto_send_member_reports', true)

  if (orgErr) {
    console.error('[cron monthly-member-reports] orgs', orgErr)
    return NextResponse.json({ error: orgErr.message }, { status: 500 })
  }

  let totalMembers = 0
  let sent = 0
  const errors: { memberId: string; error: string }[] = []

  for (const org of orgs ?? []) {
    const { data: members } = await admin
      .from('chantier_equipe_membres')
      .select('id, email')
      .eq('organization_id', org.id)
      .not('email', 'is', null)

    for (const m of members ?? []) {
      totalMembers++
      const { error } = await sendMemberHoursReport(m.id, dateFrom, dateTo, { useAdmin: true })
      if (error) errors.push({ memberId: m.id, error })
      else sent++
    }
  }

  return NextResponse.json({
    period: { dateFrom, dateTo },
    orgs: orgs?.length ?? 0,
    totalMembers,
    sent,
    errors,
  })
}
