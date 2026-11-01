'use server'

import {
  buildHermesSetupHandoff,
  parseSetupIntakeDraft,
  SetupIntakeValidationError,
  SETUP_INTAKE_SOURCE,
  type SetupIntakeActionResult,
  type SetupIntakeDraft,
  type SetupIntakeLoadResult,
  type SetupIntakeRecord,
} from './setup-intake-domain'
import {
  getSetupIntakeForDetail,
  parseSetupIntakeDbRecord,
  requireSetupIntakeContext,
  setupIntakeDatabaseError,
  setupIntakeErrorMessage,
} from './setup-intake-data'
import type { SetupIntakeContext } from './setup-intake-data'

const TABLE = 'operator_setup_client_onboarding'
const CONFLICT_MESSAGE = 'Une autre personne a modifié ce dossier depuis son chargement. Vos valeurs restent dans le formulaire. Rechargez la version enregistrée avant de continuer.'

function actionTarget(input: unknown): { sourceInstance: unknown; organizationId: unknown } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { sourceInstance: undefined, organizationId: undefined }
  }
  const value = input as { sourceInstance?: unknown; organizationId?: unknown }
  return { sourceInstance: value.sourceInstance, organizationId: value.organizationId }
}

function isValidationError(error: unknown): error is SetupIntakeValidationError {
  return error instanceof SetupIntakeValidationError
}

function mutationFields(draft: SetupIntakeDraft, actorEmail: string) {
  return {
    first_value_goal: draft.firstValueGoal,
    first_value_acceptance: draft.firstValueAcceptance,
    scope_included: draft.scopeIncluded,
    scope_excluded: draft.scopeExcluded,
    decision_owner_role: draft.decisionOwnerRole,
    target_date: draft.targetDate,
    expected_materials: draft.expectedMaterials,
    blockers: draft.blockers,
    next_action: draft.nextAction,
    scope_validated: draft.scopeValidated,
    updated_by: actorEmail,
  }
}

export async function loadOperatorSetupIntake(sourceInstance: string, organizationId: string | null): Promise<SetupIntakeLoadResult> {
  return getSetupIntakeForDetail(sourceInstance, organizationId)
}

export async function saveOperatorSetupIntake(input: unknown): Promise<SetupIntakeActionResult<SetupIntakeRecord>> {
  const target = actionTarget(input)
  let context: SetupIntakeContext
  try {
    context = await requireSetupIntakeContext(target.sourceInstance, target.organizationId)
  } catch (error) {
    const result = setupIntakeErrorMessage(error)
    return { ok: false, reason: result.reason, message: result.message }
  }

  let draft: SetupIntakeDraft
  try {
    draft = parseSetupIntakeDraft(input)
  } catch (error) {
    return {
      ok: false,
      reason: 'validation',
      message: isValidationError(error) ? error.message : 'Les informations du dossier sont invalides.',
    }
  }

  const actorEmail = context.actorEmail
  if (actorEmail.length > 320) {
    return { ok: false, reason: 'error', message: 'L’adresse opérateur ne peut pas être enregistrée pour l’attribution de cette modification.' }
  }

  const values = mutationFields(draft, actorEmail)
  const query = draft.expectedRevision === 0
    ? context.operator.from(TABLE)
      .insert({
        source_instance: SETUP_INTAKE_SOURCE,
        organization_id: draft.organizationId,
        ...values,
        created_by: actorEmail,
      })
      .select('*')
      .maybeSingle()
    : context.operator.from(TABLE)
      .update(values)
      .eq('source_instance', SETUP_INTAKE_SOURCE)
      .eq('organization_id', draft.organizationId)
      .eq('revision', draft.expectedRevision)
      .select('*')
      .maybeSingle()

  const { data, error } = await query
  if (error) {
    if (error.code === '23505') return { ok: false, reason: 'conflict', message: CONFLICT_MESSAGE }
    const result = setupIntakeErrorMessage(setupIntakeDatabaseError(error))
    return { ok: false, reason: result.reason, message: result.message }
  }
  if (!data) return { ok: false, reason: 'conflict', message: CONFLICT_MESSAGE }

  try {
    return { ok: true, value: parseSetupIntakeDbRecord(data) }
  } catch {
    return { ok: false, reason: 'error', message: 'Le dossier a été enregistré, mais sa nouvelle version ne peut pas être relue. Rechargez la fiche avant de continuer.' }
  }
}

export async function createOperatorSetupHermesBrief(sourceInstance: string, organizationId: string | null): Promise<SetupIntakeActionResult<string>> {
  const result = await getSetupIntakeForDetail(sourceInstance, organizationId)
  if (result.status === 'unavailable') return { ok: false, reason: 'unavailable', message: result.message }
  if (result.status === 'error') return { ok: false, reason: 'error', message: result.message }
  if (!result.record) {
    return { ok: false, reason: 'validation', message: 'Enregistrez et validez le périmètre avant de préparer le brief Hermes.' }
  }

  try {
    return { ok: true, value: buildHermesSetupHandoff(result.record) }
  } catch (error) {
    return {
      ok: false,
      reason: 'validation',
      message: isValidationError(error) ? error.message : 'Le brief Hermes ne peut pas être préparé à partir de cette version.',
    }
  }
}
