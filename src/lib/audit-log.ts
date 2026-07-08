import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Journal d'audit append-only pour les actions sensibles (facturation, paiement,
 * suppression, permissions). Réutilise activity_log avec le préfixe `audit.` :
 * le cron de rétention (data-retention) exclut ce préfixe de sa purge à 180 jours
 * — ces entrées sont conservées durablement, contrairement au feed d'activité
 * générique (chantier_task.completed, etc.) qui reste éphémère.
 *
 * Écriture uniquement (aucune policy RLS UPDATE/DELETE pour authenticated sur
 * activity_log) : une fois écrite, une entrée n'est jamais modifiée.
 */
export async function logAuditEvent(input: {
  organizationId: string
  actorId: string | null
  action: string // ex: 'audit.invoice.paid', 'audit.member.role_changed'
  entityType: string
  entityId: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.from('activity_log').insert({
    organization_id: input.organizationId,
    user_id: input.actorId,
    action: input.action.startsWith('audit.') ? input.action : `audit.${input.action}`,
    entity_type: input.entityType,
    entity_id: input.entityId,
    metadata: input.metadata ?? null,
  })
  if (error) console.error('[logAuditEvent]', input.action, error.message)
}
