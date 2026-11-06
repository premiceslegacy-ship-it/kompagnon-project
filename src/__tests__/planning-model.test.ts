import { describe, expect, it } from 'vitest'
import { filterPlannings, groupByDay, slotColor, slotDuration, slotHours, slotWhere, weekStats, getMonday, getLocalDateStr } from '@/app/(app)/chantiers/planning/planningModel'
import { addMinutesToTime, durationFromTimes, fmtMin, routeEnd } from '@/app/(app)/chantiers/planning/tourneeModel'
import type { GlobalPlanning } from '@/lib/data/queries/chantiers'

const slot = (over: Partial<GlobalPlanning>) => ({
  id: 'p', chantier_id: 'c1', event_type: 'chantier', title: null, planned_date: '2026-11-02', start_time: '08:00', end_time: '12:00',
  label: 'Équipe A', team_size: 2, chantier_title: 'Salle de bain', chantier_status: 'en_cours', chantier_color_idx: 3, ...over,
}) as GlobalPlanning

describe('planning global', () => {
  it('formate horaires et durées', () => {
    expect(slotHours(slot({}))).toBe('08h00 – 12h00')
    expect(slotHours(slot({ end_time: null }))).toBe('08h00')
    expect(slotHours(slot({ start_time: null, end_time: null }))).toBe('Journée')
    expect(slotDuration(slot({}))).toBe(4)
    expect(slotDuration(slot({ end_time: null }))).toBe(0)
    expect(slotDuration(slot({ start_time: '09:30', end_time: '11:00' }))).toBe(1.5)
  })

  it('nomme chantier, entretien et événement libre', () => {
    expect(slotWhere(slot({}))).toBe('Salle de bain')
    expect(slotWhere(slot({ source: 'maintenance' }))).toBe('Entretien · Salle de bain')
    expect(slotWhere(slot({ chantier_id: null, title: 'Visite M. Roux' }))).toBe('Visite M. Roux')
    expect(slotWhere(slot({ chantier_id: null, title: null, event_type: 'rdv_commercial' }))).toBe('RDV commercial')
  })

  it('donne une couleur de série stable, grise sans chantier', () => {
    expect(slotColor(slot({ chantier_color_idx: 7 }))).toBe('var(--at-s3)')
    expect(slotColor(slot({ chantier_id: null }))).toBe('var(--at-encre-3)')
  })

  it('filtre par chantier et statut, groupe par jour et trie par heure', () => {
    const list = [slot({ id: 'a', chantier_id: 'c1', start_time: '13:00' }), slot({ id: 'b', chantier_id: 'c2', chantier_status: 'termine' }), slot({ id: 'c', chantier_id: 'c1', start_time: '08:00' })]
    expect(filterPlannings(list, 'c1', 'tous').map(p => p.id)).toEqual(['a', 'c'])
    expect(filterPlannings(list, 'tous', 'termine').map(p => p.id)).toEqual(['b'])
    expect(groupByDay(filterPlannings(list, 'c1', 'tous'))['2026-11-02'].map(p => p.id)).toEqual(['c', 'a'])
  })

  it('résume la semaine', () => {
    const stats = weekStats([slot({ id: 'a', team_size: 2 }), slot({ id: 'b', chantier_id: 'c2', team_size: 1, planned_date: '2026-11-03' }), slot({ id: 'c', team_size: 3 })])
    expect(stats.chantiersActifs).toBe(2)
    expect(stats.totalPersonnes).toBe(6)
    expect(stats.jourLePlusCharge?.[0]).toBe('2026-11-02')
  })

  it('trouve le lundi de la semaine', () => {
    expect(getLocalDateStr(getMonday(new Date(2026, 10, 8)))).toBe('2026-11-02')
    expect(getLocalDateStr(getMonday(new Date(2026, 10, 2)))).toBe('2026-11-02')
  })
})

describe('tournée', () => {
  it('formate les minutes', () => {
    expect(fmtMin(45)).toBe('45min')
    expect(fmtMin(120)).toBe('2h')
    expect(fmtMin(95)).toBe('1h35')
  })

  it('ajoute des minutes à une heure', () => {
    expect(addMinutesToTime('08:30', 90)).toBe('10:00')
    expect(addMinutesToTime(null, 60)).toBe('09:00')
  })

  it('déduit la durée de deux heures, ou prend une valeur par défaut', () => {
    expect(durationFromTimes('08:00', '09:30')).toBe(90)
    expect(durationFromTimes(null, null)).toBe(60)
  })

  it('estime la fin de tournée', () => {
    expect(routeEnd('08:00', 120, 30)).toBe('10:30')
    expect(routeEnd(null, 120, 30)).toBeNull()
  })
})
