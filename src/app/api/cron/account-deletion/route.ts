import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCronSecret } from '@/lib/cron-auth'
import { logAuditEvent } from '@/lib/audit-log'

export const dynamic = 'force-dynamic'

/**
 * Cron quotidien — exécute la suppression RGPD (art. 17) promise à J+30 par
 * requestAccountDeletion(). Anonymise les PII (profils, clients, membres
 * d'équipe) et désactive tous les accès ; conserve intégralement les factures,
 * devis et paiements (obligation de conservation fiscale 10 ans, CGI).
 *
 * Idempotent : anonymize_organization_for_deletion() ne retraite jamais une
 * organisation déjà marquée anonymized_at (garde en base de données, pas
 * seulement applicative).
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

  const { data: dueOrgs, error } = await admin
    .from('organizations')
    .select('id, name')
    .not('deletion_scheduled_at', 'is', null)
    .lte('deletion_scheduled_at', new Date().toISOString())
    .is('anonymized_at', null)
    .limit(50) // borné : un cron sans LIMIT peut saturer la mémoire

  if (error) {
    console.error('[cron/account-deletion] select', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let processed = 0
  const errors: { orgId: string; error: string }[] = []

  for (const org of dueOrgs ?? []) {
    try {
      const { data, error: rpcError } = await admin.rpc('anonymize_organization_for_deletion', {
        p_org_id: org.id,
      })
      if (rpcError) {
        errors.push({ orgId: org.id, error: rpcError.message })
        continue
      }
      processed++
      const summary = Array.isArray(data) ? data[0] : data
      await logAuditEvent({
        organizationId: org.id,
        actorId: null,
        action: 'audit.organization.anonymized',
        entityType: 'organization',
        entityId: org.id,
        metadata: { org_name: org.name, ...summary },
      })
    } catch (err) {
      errors.push({ orgId: org.id, error: err instanceof Error ? err.message : 'unknown' })
    }
  }

  return NextResponse.json({ processed, errors })
}
