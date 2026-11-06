import { describe, expect, it } from 'vitest'
import {
  filterPointages, getPersonKey, groupByChantier, groupByPerson, periodRange, reportEntries, reportRange, slotDefaultHours, slotWho, getWeekStart, toLocalDateStr,
} from '@/app/(app)/chantiers/heures/heuresModel'
import type { GlobalPointage, MissingPointageSlot } from '@/lib/data/queries/chantiers'

const pt = (over: Partial<GlobalPointage>) => ({
  id: 'p', chantier_id: 'c1', chantier_title: 'Salle de bain', user_id: 'u1', member_id: null, member_profile_id: null, user_name: 'Samuel', date: '2026-11-02', hours: 4, description: null, tache_title: null, ...over,
}) as GlobalPointage

describe('heures pointées', () => {
  it('borne la semaine, le mois et la plage libre', () => {
    const monday = getWeekStart(new Date(2026, 10, 5))
    expect(toLocalDateStr(monday)).toBe('2026-11-02')
    expect(periodRange('week', monday, 10, 2026, '', '')).toEqual({ fromStr: '2026-11-02', toStr: '2026-11-08' })
    expect(periodRange('month', monday, 1, 2028, '', '')).toEqual({ fromStr: '2028-02-01', toStr: '2028-02-29' })
    expect(periodRange('custom', monday, 0, 2026, '2026-10-01', '2026-10-15')).toEqual({ fromStr: '2026-10-01', toStr: '2026-10-15' })
  })

  it('identifie une personne par compte ou par membre', () => {
    expect(getPersonKey({ user_id: 'u1', member_id: 'm1' })).toBe('u1')
    expect(getPersonKey({ user_id: null, member_id: 'm1' })).toBe('member_m1')
  })

  it('filtre par période, chantier et personne', () => {
    const list = [pt({ id: 'a' }), pt({ id: 'b', date: '2026-11-20' }), pt({ id: 'c', chantier_id: 'c2' }), pt({ id: 'd', user_id: null, member_id: 'm1' })]
    expect(filterPointages(list, '2026-11-01', '2026-11-08', '', '').map(p => p.id)).toEqual(['a', 'c', 'd'])
    expect(filterPointages(list, '2026-11-01', '2026-11-08', 'c2', '').map(p => p.id)).toEqual(['c'])
    expect(filterPointages(list, '2026-11-01', '2026-11-08', '', 'member_m1').map(p => p.id)).toEqual(['d'])
  })

  it('regroupe par personne et par chantier, du plus chargé au moins chargé', () => {
    const list = [pt({ id: 'a', hours: 2 }), pt({ id: 'b', hours: 6, chantier_id: 'c2', chantier_title: 'Terrasse' }), pt({ id: 'c', user_id: 'u2', user_name: 'Léa', hours: 3 })]
    const persons = groupByPerson(list)
    expect(persons.map(p => [p.name, p.hours, p.chantierIds.size])).toEqual([['Samuel', 8, 2], ['Léa', 3, 1]])
    expect(groupByChantier(list).map(c => [c.title, c.hours, c.memberKeys.size])).toEqual([['Terrasse', 6, 1], ['Salle de bain', 5, 2]])
  })

  it('propose les heures d’un créneau à régulariser', () => {
    const slot = (over: Partial<MissingPointageSlot>) => ({ id: 's', start_time: null, end_time: null, duration_min: null, label: null, member_name: null, equipe_name: null, team_size: null, ...over }) as MissingPointageSlot
    expect(slotDefaultHours(slot({ start_time: '08:00', end_time: '12:30' }))).toBe(4.5)
    expect(slotDefaultHours(slot({ duration_min: 90 }))).toBe(1.5)
    expect(slotDefaultHours(slot({}))).toBe(7)
    expect(slotWho(slot({ member_name: 'Karim' }))).toBe('Karim')
    expect(slotWho(slot({ equipe_name: 'A' }))).toBe('Équipe A')
    expect(slotWho(slot({ team_size: 2 }))).toBe('2 personnes')
    expect(slotWho(slot({}))).toBe('Intervenant non renseigné')
  })

  it('dédoublonne un membre lié à un compte dans les rapports', () => {
    const list = [pt({ id: 'a', user_id: 'u1', user_name: 'Samuel' }), pt({ id: 'b', user_id: null, member_id: 'm1', member_profile_id: 'u1', user_name: 'Samuel (membre)' }), pt({ id: 'c', user_id: null, member_id: 'm2', user_name: 'Karim' })]
    expect(reportEntries(list, []).map(e => [e.id, e.idType])).toEqual([['m2', 'member'], ['u1', 'user']])
  })

  it('borne un rapport au mois ou à l’année', () => {
    expect(reportRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' })
    expect(reportRange('2026')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })
})
