import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

import { getOperatorUser } from '@/lib/operator-auth'
import { createOperatorAdminClient } from '@/lib/supabase/operator'
import {
  isSetupIntakeTarget,
  parseSetupIntakeDraft,
  SETUP_INTAKE_MIGRATION,
  SETUP_INTAKE_SOURCE,
  type SetupIntakeLoadResult,
  type SetupIntakeRecord,
} from './setup-intake-domain'

const TABLE = 'operator_setup_client_onboarding'
const OFFICIAL_ATELIER_URL = 'https://app.atelier-btp.fr'
const MIGRATION_ERROR = `Le dossier n’est pas disponible. Faites appliquer la migration opérateur ${SETUP_INTAKE_MIGRATION} à la base cockpit ciblée par un opérateur habilité, puis rechargez la fiche. Aucun dossier n’a été enregistré.`
const UNAVAILABLE_ERROR = 'Ce dossier exige l’organisation exacte de l’application partagée Atelier, son URL officielle et un achat setup enregistré. Vérifiez le rattachement dans la fiche client.'
const ACCESS_ERROR = 'Accès opérateur requis.'
const STORAGE_ERROR = 'La base opérateur n’a pas répondu. Rechargez la fiche avant de réessayer.'

export type SetupIntakeContext = {
  operator: SupabaseClient
  actorEmail: string
}

export class SetupIntakeAccessError extends Error {
  readonly kind: 'unauthorized' | 'unavailable' | 'schema' | 'storage'

  constructor(kind: SetupIntakeAccessError['kind']) {
    super(kind === 'unauthorized' ? ACCESS_ERROR : kind === 'unavailable' ? UNAVAILABLE_ERROR : kind === 'schema' ? MIGRATION_ERROR : STORAGE_ERROR)
    this.name = 'SetupIntakeAccessError'
    this.kind = kind
  }
}

type OnboardingRow = {
  source_instance: unknown
  organization_id: unknown
  revision: unknown
  first_value_goal: unknown
  first_value_acceptance: unknown
  scope_included: unknown
  scope_excluded: unknown
  decision_owner_role: unknown
  target_date: unknown
  expected_materials: unknown
  blockers: unknown
  next_action: unknown
  scope_validated: unknown
  scope_validated_at: unknown
  scope_validated_by: unknown
  created_at: unknown
  created_by: unknown
  updated_at: unknown
  updated_by: unknown
}

function isMissingOnboardingTable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  return error.code === '42P01' || error.code === 'PGRST205'
}

export function parseSetupIntakeDbRecord(value: unknown): SetupIntakeRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SetupIntakeAccessError('storage')
  const row = value as OnboardingRow

  try {
    const draft = parseSetupIntakeDraft({
      sourceInstance: row.source_instance,
      organizationId: row.organization_id,
      expectedRevision: row.revision,
      firstValueGoal: row.first_value_goal,
      firstValueAcceptance: row.first_value_acceptance,
      scopeIncluded: row.scope_included,
      scopeExcluded: row.scope_excluded,
      decisionOwnerRole: row.decision_owner_role,
      targetDate: row.target_date,
      expectedMaterials: row.expected_materials,
      blockers: row.blockers,
      nextAction: row.next_action,
      scopeValidated: row.scope_validated,
    })

    if (
      typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 1
      || (row.scope_validated_at !== null && typeof row.scope_validated_at !== 'string')
      || (row.scope_validated_by !== null && typeof row.scope_validated_by !== 'string')
      || typeof row.created_at !== 'string' || typeof row.created_by !== 'string'
      || typeof row.updated_at !== 'string' || typeof row.updated_by !== 'string'
      || (draft.scopeValidated && (!row.scope_validated_at || !row.scope_validated_by))
      || (!draft.scopeValidated && (row.scope_validated_at !== null || row.scope_validated_by !== null))
    ) {
      throw new SetupIntakeAccessError('storage')
    }

    const { expectedRevision: revision, ...fields } = draft
    return {
      ...fields,
      revision,
      scopeValidatedAt: row.scope_validated_at,
      scopeValidatedBy: row.scope_validated_by,
      createdAt: row.created_at,
      createdBy: row.created_by,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    }
  } catch (error) {
    if (error instanceof SetupIntakeAccessError) throw error
    throw new SetupIntakeAccessError('storage')
  }
}


export async function requireSetupIntakeContext(sourceInstance: unknown, organizationId: unknown): Promise<SetupIntakeContext> {
  const user = await getOperatorUser()
  if (!user?.email) throw new SetupIntakeAccessError('unauthorized')
  if (!isSetupIntakeTarget(sourceInstance, organizationId)) throw new SetupIntakeAccessError('unavailable')

  const operator = createOperatorAdminClient()
  const [clientResult, settingsResult, subscriptionResult] = await Promise.all([
    operator.from('operator_clients')
      .select('organization_id')
      .eq('source_instance', SETUP_INTAKE_SOURCE)
      .eq('organization_id', organizationId)
      .maybeSingle(),
    operator.from('operator_client_settings')
      .select('app_url')
      .eq('source_instance', SETUP_INTAKE_SOURCE)
      .eq('organization_id', organizationId)
      .maybeSingle(),
    operator.from('operator_client_subscriptions')
      .select('billing_model')
      .eq('source_instance', SETUP_INTAKE_SOURCE)
      .eq('organization_id', organizationId)
      .maybeSingle(),
  ])

  if (clientResult.error || settingsResult.error || subscriptionResult.error) throw new SetupIntakeAccessError('storage')
  const officialUrl = typeof settingsResult.data?.app_url === 'string'
    && settingsResult.data.app_url.replace(/\/+$/u, '') === OFFICIAL_ATELIER_URL
  if (!clientResult.data || !officialUrl || subscriptionResult.data?.billing_model !== 'setup') {
    throw new SetupIntakeAccessError('unavailable')
  }

  return { operator, actorEmail: user.email }
}

export async function getSetupIntakeForDetail(sourceInstance: string, organizationId: string | null): Promise<SetupIntakeLoadResult> {
  try {
    const { operator } = await requireSetupIntakeContext(sourceInstance, organizationId)
    const { data, error } = await operator.from(TABLE)
      .select('*')
      .eq('source_instance', SETUP_INTAKE_SOURCE)
      .eq('organization_id', organizationId)
      .maybeSingle()

    if (error) {
      if (isMissingOnboardingTable(error)) throw new SetupIntakeAccessError('schema')
      throw new SetupIntakeAccessError('storage')
    }
    return { status: 'ready', record: data ? parseSetupIntakeDbRecord(data) : null }
  } catch (error) {
    if (error instanceof SetupIntakeAccessError) {
      if (error.kind === 'unavailable') return { status: 'unavailable', message: error.message }
      return { status: 'error', message: error.message }
    }
    return { status: 'error', message: STORAGE_ERROR }
  }
}

export function setupIntakeErrorMessage(error: unknown): { reason: 'unavailable' | 'error'; message: string } {
  if (error instanceof SetupIntakeAccessError) {
    if (error.kind === 'unavailable') return { reason: 'unavailable', message: error.message }
    return { reason: 'error', message: error.message }
  }
  return { reason: 'error', message: STORAGE_ERROR }
}

export function setupIntakeDatabaseError(error: unknown): SetupIntakeAccessError {
  return new SetupIntakeAccessError(isMissingOnboardingTable(error) ? 'schema' : 'storage')
}
