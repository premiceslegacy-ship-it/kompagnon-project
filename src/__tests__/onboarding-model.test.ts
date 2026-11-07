import { describe, expect, it } from 'vitest'
import {
  addInviteRow,
  einvoicingIntent,
  hasErrors,
  hasInvalidInviteEmail,
  initialStepForError,
  removeInviteRow,
  stepProgress,
  updateInviteRow,
  validateCompany,
  validateContact,
  welcomeTitle,
  PRIORITY_FAMILIES,
  ONBOARDING_ERRORS,
} from '@/app/onboarding/onboardingModel'

describe('onboardingModel', () => {
  it("rouvre l'étape concernée après un refus du serveur", () => {
    expect(initialStepForError(null)).toBe(0)
    expect(initialStepForError('inconnue')).toBe(0)
    expect(initialStepForError('invalid_code')).toBe('join')
    expect(initialStepForError('join_failed')).toBe('join')
    expect(initialStepForError('siret_required')).toBe(1)
    expect(initialStepForError('org_update_failed')).toBe(1)
  })

  it('compte quatre points pour le parcours dirigeant seulement', () => {
    expect(stepProgress(0)).toBeUndefined()
    expect(stepProgress('launch')).toBeUndefined()
    expect(stepProgress('join')).toBeUndefined()
    expect(stepProgress(1)).toEqual({ current: 0, total: 4 })
    expect(stepProgress(2)).toEqual({ current: 1, total: 4 })
    expect(stepProgress(3)).toEqual({ current: 2, total: 4 })
    expect(stepProgress(4)).toEqual({ current: 3, total: 4 })
  })

  it("exige un nom et une activité", () => {
    expect(validateCompany({ companyName: '', activity: '' }).name).toBe("Le nom de l'entreprise est obligatoire.")
    expect(validateCompany({ companyName: 'Dupont', activity: '' }).name).toBe('Choisissez une activité de référence.')
    expect(hasErrors(validateCompany({ companyName: 'Dupont', activity: 'renovation' }))).toBe(false)
  })

  it("exige un email valide et, en essai, un SIRET de 14 chiffres", () => {
    expect(validateContact({ email: '', siret: '', selfService: false }).email).toBeTruthy()
    expect(validateContact({ email: 'pas-un-email', siret: '', selfService: false }).email).toBeTruthy()
    expect(validateContact({ email: 'a@b.fr', siret: '', selfService: true }).siret).toBe('Le SIRET est obligatoire pour activer votre essai.')
    expect(validateContact({ email: 'a@b.fr', siret: '123', selfService: true }).siret).toBeTruthy()
    expect(hasErrors(validateContact({ email: 'a@b.fr', siret: '', selfService: false }))).toBe(false)
    expect(hasErrors(validateContact({ email: 'a@b.fr', siret: '123 456 789 00012', selfService: true }))).toBe(false)
  })

  it("active la facturation électronique dès qu'un des deux choix l'est", () => {
    expect(einvoicingIntent(true, false)).toBe('activate')
    expect(einvoicingIntent(false, true)).toBe('activate')
    expect(einvoicingIntent(false, false)).toBe('later')
  })

  it("gère les lignes d'invitation", () => {
    let rows = [{ email: '', roleId: 'r1' }]
    rows = addInviteRow(rows, 'r1')
    expect(rows).toHaveLength(2)
    rows = updateInviteRow(rows, 1, 'email', 'lea@x.fr')
    expect(rows[1].email).toBe('lea@x.fr')
    expect(hasInvalidInviteEmail(rows)).toBe(false)
    rows = updateInviteRow(rows, 0, 'email', 'oups')
    expect(hasInvalidInviteEmail(rows)).toBe(true)
    rows = removeInviteRow(rows, 0)
    expect(rows).toEqual([{ email: 'lea@x.fr', roleId: 'r1' }])
  })

  it("salue par le prénom quand on le connaît", () => {
    expect(welcomeTitle('Jean')).toBe('Bienvenue, Jean')
    expect(welcomeTitle(null)).toBe('Bienvenue')
  })

  it('garde cinq familles prioritaires et des messages pour chaque erreur', () => {
    expect(PRIORITY_FAMILIES).toHaveLength(5)
    expect(Object.keys(ONBOARDING_ERRORS)).toContain('invalid_code')
  })
})
