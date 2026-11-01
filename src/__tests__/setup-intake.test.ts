import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getOperatorUser: vi.fn(),
  createOperatorAdminClient: vi.fn(),
}))

vi.mock('@/lib/operator-auth', () => ({ getOperatorUser: h.getOperatorUser }))
vi.mock('@/lib/supabase/operator', () => ({ createOperatorAdminClient: h.createOperatorAdminClient }))

import { saveOperatorSetupIntake } from '@/app/(app)/orsayn/setup-intake-actions'
import {
  buildHermesSetupHandoff,
  parseSetupIntakeDraft,
  SetupIntakeValidationError,
  type SetupIntakeRecord,
} from '@/app/(app)/orsayn/setup-intake-domain'

const ORGANIZATION_ID = '2f7d9d81-80b4-4c32-a1f0-01452466bc51'

function validDraft(overrides: Record<string, unknown> = {}) {
  return {
    sourceInstance: 'atelier-app',
    organizationId: ORGANIZATION_ID,
    expectedRevision: 0,
    firstValueGoal: '',
    firstValueAcceptance: '',
    scopeIncluded: '',
    scopeExcluded: '',
    decisionOwnerRole: '',
    targetDate: null,
    expectedMaterials: [],
    blockers: '',
    nextAction: '',
    scopeValidated: false,
    ...overrides,
  }
}


beforeEach(() => {
  vi.clearAllMocks()
})

describe('setup intake input boundaries', () => {

  it('requires the exact shared Atelier source and a real non-sentinel UUID', () => {
    expect(() => parseSetupIntakeDraft(validDraft({ sourceInstance: 'other-app' }))).toThrow(SetupIntakeValidationError)
    expect(() => parseSetupIntakeDraft(validDraft({ organizationId: '00000000-0000-0000-0000-000000000000' }))).toThrow(SetupIntakeValidationError)
    expect(() => parseSetupIntakeDraft(validDraft({ organizationId: 'not-a-uuid' }))).toThrow(SetupIntakeValidationError)
  })

  it('rejects an incomplete human attestation and keeps draft storage bounded', () => {
    expect(() => parseSetupIntakeDraft(validDraft({ scopeValidated: true }))).toThrow(SetupIntakeValidationError)
    expect(() => parseSetupIntakeDraft(validDraft({ firstValueGoal: 'x'.repeat(601) }))).toThrow(SetupIntakeValidationError)
    expect(() => parseSetupIntakeDraft(validDraft({ targetDate: '2026-02-30' }))).toThrow(SetupIntakeValidationError)
    expect(() => parseSetupIntakeDraft(validDraft({ expectedMaterials: Array.from({ length: 13 }, () => ({})) }))).toThrow(SetupIntakeValidationError)
    expect(() => parseSetupIntakeDraft(validDraft({
      expectedMaterials: [{ label: '', category: 'document', count: 1, reference: '' }],
    }))).toThrow(SetupIntakeValidationError)
  })

  it('rejects URLs, credential material and NIR-shaped values in free text', () => {
    expect(() => parseSetupIntakeDraft(validDraft({ blockers: 'https://example.invalid/path?token=x' }))).toThrow(SetupIntakeValidationError)
    expect(() => parseSetupIntakeDraft(validDraft({ nextAction: 'api_key=exemple' }))).toThrow(SetupIntakeValidationError)
    expect(() => parseSetupIntakeDraft(validDraft({ decisionOwnerRole: '123456789012345' }))).toThrow(SetupIntakeValidationError)
    expect(() => parseSetupIntakeDraft(validDraft({ decisionOwnerRole: 'decision.owner@example.com' }))).toThrow(SetupIntakeValidationError)
    expect(() => parseSetupIntakeDraft(validDraft({
      expectedMaterials: [{ label: 'Document attendu', category: 'document', count: 1, reference: '/tmp/client.pdf' }],
    }))).toThrow(SetupIntakeValidationError)
  })
})

describe('setup intake server authority', () => {
  it('denies unauthenticated writes before creating a service-role client', async () => {
    h.getOperatorUser.mockResolvedValue(null)
    const result = await saveOperatorSetupIntake(validDraft())
    expect(result).toMatchObject({ ok: false, reason: 'error' })
    expect(h.createOperatorAdminClient).not.toHaveBeenCalled()
  })

})

describe('persisted Hermes handoff', () => {
  it('refuses drafts and incomplete human attestations for the Hermes brief', () => {
    const record: SetupIntakeRecord = {
      ...parseSetupIntakeDraft(validDraft({
        expectedRevision: 4,
        firstValueGoal: 'Préparer un devis de chantier à relire.',
        firstValueAcceptance: 'Le client valide le prix et les postes.',
        scopeIncluded: 'Un modèle de devis et un exemple relu.',
        scopeExcluded: 'Aucun envoi automatique au client.',
        expectedMaterials: [{ label: 'Photos de chantier', category: 'photo', count: 3, reference: 'chantier-2026-04' }],
        blockers: 'Aucune donnée source reçue.',
        nextAction: 'Confirmer le format du devis.',
        scopeValidated: true,
      })),
      revision: 4,
      scopeValidatedAt: '2026-10-31T12:00:00.000Z',
      scopeValidatedBy: 'operator@example.com',
      createdAt: '2026-10-30T12:00:00.000Z',
      createdBy: 'operator@example.com',
      updatedAt: '2026-10-31T12:00:00.000Z',
      updatedBy: 'operator@example.com',
    }

    expect(() => buildHermesSetupHandoff({ ...record, scopeValidated: false })).toThrow(SetupIntakeValidationError)
    expect(() => buildHermesSetupHandoff({ ...record, scopeValidatedBy: null })).toThrow(SetupIntakeValidationError)
    expect(() => buildHermesSetupHandoff({ ...record, scopeValidatedAt: null })).toThrow(SetupIntakeValidationError)
  })
})
