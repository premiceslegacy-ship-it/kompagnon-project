import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCronSecret } from '@/lib/cron-auth'
import { todayParis } from '@/lib/utils'
import { generateChantierPeriodInvoiceForOrg } from '@/lib/data/mutations/chantiers'

export const dynamic = 'force-dynamic'

// POST /api/cron/chantier-period-invoices
// Génère les brouillons de factures de période pour les chantiers arrivés à échéance.
export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get('x-cron-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const today = todayParis()

  const { data: chantiers, error } = await admin
    .from('chantiers')
    .select('id, organization_id')
    .eq('is_archived', false)
    .neq('status', 'annule')
    .neq('periode_facturation', 'none')
    .not('montant_periode_ht', 'is', null)
    .gt('montant_periode_ht', 0)
    .not('prochaine_facturation', 'is', null)
    .lte('prochaine_facturation', today)

  if (error) {
    console.error('[cron/chantier-period-invoices] fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let created = 0
  let skipped = 0
  let errors = 0
  const invoiceIds: string[] = []

  for (const chantier of chantiers ?? []) {
    try {
      const result = await generateChantierPeriodInvoiceForOrg(
        admin,
        chantier.organization_id,
        chantier.id,
        null,
      )
      if (result.error || !result.invoiceId) {
        errors++
        console.error(`[cron/chantier-period-invoices] chantier ${chantier.id}:`, result.error)
        continue
      }
      invoiceIds.push(result.invoiceId)
      created++
    } catch (err) {
      errors++
      console.error(`[cron/chantier-period-invoices] chantier ${chantier.id}:`, err)
    }
  }

  console.log(`[cron/chantier-period-invoices] done: created=${created} skipped=${skipped} errors=${errors}`)
  return NextResponse.json({ created, skipped, errors, invoiceIds })
}

export async function GET(req: NextRequest) {
  return POST(req)
}
