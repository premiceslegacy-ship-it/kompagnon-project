import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(path, 'utf8')
}

function switchCaseBody(src: string, caseName: string) {
  const start = src.indexOf(`case '${caseName}':`)
  expect(start, `case '${caseName}' should exist in executeProposalSideEffect`).toBeGreaterThanOrEqual(0)
  // Le prochain "case '" ou la fin de la fonction délimite le bloc.
  const next = src.indexOf(`\n    case '`, start + 1)
  return src.slice(start, next === -1 ? undefined : next)
}

describe('Sarah planning capabilities - guardrails', () => {
  const actions = source('src/lib/sarah/actions.ts')
  const route = source('src/app/api/ai/sarah-secretary/route.ts')
  const planning = source('src/lib/data/mutations/planning.ts')
  const planningAgent = source('src/lib/data/mutations/planning-agent.ts')
  const absences = source('src/lib/data/mutations/absences.ts')

  it('never writes a replacement or absence outside the propose/confirm flow', () => {
    // Toute action sensible passe par confirmSarahAction (réservation atomique pending -> executed)
    // avant d'appeler executeProposalSideEffect : on vérifie que les nouveaux types sont bien
    // gérés dans ce switch, et non appelés directement ailleurs dans la route de chat.
    expect(switchCaseBody(actions, 'absence_declare')).toContain('declareMemberAbsence(')
    expect(switchCaseBody(actions, 'planning_replacement_suggest')).toMatch(/updatePlanningSlot|createPlanningSlot/)
    expect(route).not.toContain('declareMemberAbsence(')
    expect(route).not.toContain('createPlanningSlot(')
  })

  it('prepares pointage reminders through push notifications without direct DB writes', () => {
    const body = switchCaseBody(actions, 'pointage_reminder_prepare')
    expect(body).toContain('getPlanningRecipientUserIds')
    expect(body).toContain('sendPushToPlanningRecipients')
    expect(body).not.toMatch(/\.from\('chantier_pointages'\)/)
  })

  it('read-only planning-agent tools require the planning permission and never mutate data', () => {
    for (const fn of ['findPlanningConflicts', 'findReplacementCandidates', 'findMissingPointages']) {
      const start = planningAgent.indexOf(`export async function ${fn}`)
      expect(start).toBeGreaterThanOrEqual(0)
      const next = planningAgent.indexOf('\nexport async function ', start + 1)
      const body = planningAgent.slice(start, next === -1 ? undefined : next)
      expect(body).toContain("hasPermission('chantiers.planning')")
      expect(body).not.toMatch(/\.insert\(|\.update\(|\.delete\(/)
    }
  })

  it('never infers a real absence from a missing pointage', () => {
    const start = planningAgent.indexOf('export async function findMissingPointages')
    const body = planningAgent.slice(start)
    expect(body.toLowerCase()).not.toContain('absent')
  })

  it('blocks generic unassigned planning placeholders', () => {
    expect(planning).toContain('GENERIC_UNASSIGNED_PLANNING_LABELS')
    expect(planning).toContain("'equipe'")
    expect(planning).toContain('validatePlanningAssigneeLabel(data)')
    expect(planning).toContain('validatePlanningAssigneeLabel(slot)')
    expect(planning).toContain('Choisissez un membre, une équipe existante, ou saisissez un libellé précis')
  })

  it('keeps the member self-declared absence path session-scoped and separate from manager writes', () => {
    expect(absences).toContain('declareMyAbsenceFromSpace')
    expect(absences).toContain('declareMemberAbsence')
    const selfDeclareStart = absences.indexOf('export async function declareMyAbsenceFromSpace')
    const selfDeclareBody = absences.slice(selfDeclareStart, absences.indexOf('\nexport async function', selfDeclareStart + 1))
    expect(selfDeclareBody).toContain('getMemberSession')
  })

  it('exposes the new planning-intelligence tools to Sarah and never lets her act without proposeSarahAction', () => {
    for (const tool of ['find_replacement_candidates', 'check_planning_conflicts', 'check_missing_pointages', 'check_member_absences']) {
      expect(route).toContain(`name: '${tool}'`)
    }
    // La route de chat construit toujours une proposition persistée avant toute écriture sensible.
    expect(route).toContain('attachPersistentProposal')
  })
})
