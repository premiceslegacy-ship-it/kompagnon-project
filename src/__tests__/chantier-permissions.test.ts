import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(path, 'utf8')
}

function functionBody(src: string, name: string) {
  const start = src.indexOf(`export async function ${name}`)
  expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0)
  const next = src.indexOf('\nexport async function ', start + 1)
  return src.slice(start, next === -1 ? undefined : next)
}

describe('chantier server-action permission guards', () => {
  const chantiers = source('src/lib/data/mutations/chantiers.ts')
  const planning = source('src/lib/data/mutations/planning.ts')
  const members = source('src/lib/data/mutations/members.ts')
  const memberQueries = source('src/lib/data/queries/members.ts')
  const team = source('src/lib/data/mutations/team.ts')
  const expenses = source('src/lib/data/mutations/chantier-expenses.ts')
  const jalons = source('src/lib/data/mutations/chantier-jalons.ts')
  const maintenance = source('src/lib/data/mutations/maintenance.ts')
  const chantierQueries = source('src/lib/data/queries/chantiers.ts')

  it('blocks chantier edit surfaces when chantiers.edit is missing', () => {
    for (const fn of [
      'createTache',
      'updateTache',
      'reorderTaches',
      'deleteTache',
      'createChantierNote',
      'deleteChantierNote',
      'uploadChantierPhoto',
      'deleteChantierPhoto',
      'updateChantierPhotoCaption',
      'updateChantierPhotoTitle',
      'togglePhotoReportFlag',
      'createChantierPlanning',
      'deleteChantierPlanning',
    ]) {
      expect(functionBody(chantiers, fn)).toMatch(/chantiers\.edit/)
    }

    for (const fn of ['createJalon', 'updateJalon', 'deleteJalon', 'reorderJalons', 'assignTasksToJalon', 'completeJalon']) {
      expect(functionBody(jalons, fn)).toMatch(/chantiers\.edit/)
    }
  })

  it('keeps pointage permissions split between self and team management', () => {
    expect(functionBody(chantiers, 'createPointage')).toContain("hasPermission('chantiers.pointage')")
    expect(functionBody(chantiers, 'createPointage')).toContain('userCanPointOnChantier')
    for (const fn of ['createMemberPointageAdmin', 'updatePointage', 'deletePointage']) {
      expect(functionBody(chantiers, fn)).toContain("hasPermission('chantiers.manage_pointages')")
    }
  })

  it('protects planning tournee writes with the dedicated planning permission', () => {
    for (const fn of ['createPlanningSlot', 'createPlanningSlots', 'createAITournee', 'deletePlanningSlot', 'upsertTourneeSlot', 'reorderTournee', 'updateTourneeSlotTravelTimes', 'duplicateTournee', 'upsertTourneeRoute', 'planWeekWithAI']) {
      expect(functionBody(planning, fn)).toMatch(/chantiers\.planning/)
    }
  })

  it('keeps planning permission split from generic chantier editing', () => {
    for (const fn of ['createPlanningSlot', 'createPlanningSlots', 'createAITournee', 'deletePlanningSlot', 'upsertTourneeSlot', 'reorderTournee', 'updateTourneeSlotTravelTimes', 'duplicateTournee', 'upsertTourneeRoute', 'planWeekWithAI']) {
      expect(functionBody(planning, fn)).not.toMatch(/chantiers\.edit/)
    }
  })

  it('keeps labor rates admin-only and expenses permission-scoped', () => {
    expect(members).toContain('canManageLaborRates')
    expect(team).toContain('canManageLaborRates')
    expect(functionBody(expenses, 'createChantierExpense')).toContain("hasPermission('chantiers.expenses.create')")
    expect(functionBody(expenses, 'updateChantierExpense')).toContain("hasPermission('chantiers.expenses.edit')")
    expect(functionBody(expenses, 'deleteChantierExpense')).toContain("hasPermission('chantiers.expenses.delete')")
    expect(functionBody(expenses, 'getReceiptSignedUrl')).toContain("hasPermission('chantiers.expenses.view')")
  })

  it('protects global pointage visibility and member-space chantier scope', () => {
    expect(functionBody(chantierQueries, 'getAllPointagesGlobal')).toContain("hasPermission('chantiers.manage_pointages')")
    expect(memberQueries).toContain('getMemberAccessibleChantiers')
    expect(functionBody(members, 'createPointageAsMember')).toContain('getMemberAccessibleChantiers')
  })

  it('protects maintenance production writes with server-side permissions', () => {
    expect(functionBody(maintenance, 'createMaintenanceContract')).toContain("requirePermission('chantiers.create')")
    expect(functionBody(maintenance, 'updateMaintenanceContract')).toContain("requirePermission('chantiers.edit')")
    expect(functionBody(maintenance, 'deleteMaintenanceContract')).toContain("requirePermission('chantiers.delete')")
    for (const fn of ['createIntervention', 'updateIntervention', 'deleteIntervention']) {
      expect(functionBody(maintenance, fn)).toContain("requirePermission('chantiers.edit')")
    }
    expect(functionBody(maintenance, 'billMaintenanceIntervention')).toContain("requirePermission(invoiceId ? 'invoices.edit' : 'invoices.create')")
  })
})
