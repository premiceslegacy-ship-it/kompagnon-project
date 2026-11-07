import { describe, expect, it } from 'vitest'
import {
  ANNUAL_STANDARD_OPTS, MONTHLY_STANDARD_OPTS, canGoNext, delta, deltaText, entriesToObjectives, fmt, fmtH, fmtPct, hasMaintenanceData, isFuturePeriod,
  formatProgress, marginTone, maintenanceFigures, objectiveProgress, membersWithoutRateTitle, nextEntry, nextPeriod, objectivesEmpty, objectivesToEntries, pdfHref, periodLabel, periodShort, previousPeriod,
  progressPct, progressTone, weightedMargin, type ObjEntry, type Period,
} from '@/app/(app)/rapports/rapportsModel'
import type { AnnualObjectives, MaintenanceReport, MonthlyObjectives } from '@/lib/data/queries/reporting'

const nov: Period = { vue: 'mois', year: 2026, month: 11 }

describe('rapports : formats', () => {
  it('formate les montants, les pourcentages et les heures', () => {
    expect(fmt(12345.6)).toBe('12 346 €')
    expect(fmt(-980)).toBe('-980 €')
    expect(fmtPct(0.2346)).toBe('23.5 %')
    expect(fmtH(7.5)).toBe('7:30')
    expect(fmtH(8)).toBe('8:00')
    expect(fmtH(7.999)).toBe('8:00')
  })
})

describe('rapports : période', () => {
  it('navigue d’un mois à l’autre en passant l’année', () => {
    expect(previousPeriod({ ...nov, month: 1 })).toEqual({ vue: 'mois', year: 2025, month: 12 })
    expect(nextPeriod({ ...nov, month: 12 })).toEqual({ vue: 'mois', year: 2027, month: 1 })
    expect(nextPeriod({ vue: 'annee', year: 2026, month: 3 }).year).toBe(2027)
  })

  it('n’autorise pas la période suivante au-delà de la période en cours', () => {
    const now = new Date(2026, 10, 6)
    expect(canGoNext(nov, now)).toBe(false)
    expect(canGoNext({ ...nov, month: 10 }, now)).toBe(true)
    expect(canGoNext({ vue: 'annee', year: 2026, month: 1 }, now)).toBe(false)
    expect(canGoNext({ vue: 'annee', year: 2025, month: 1 }, now)).toBe(true)
    expect(isFuturePeriod({ ...nov, month: 12 }, now)).toBe(true)
  })

  it('libelle la période et construit le lien du PDF', () => {
    expect(periodLabel(nov)).toBe('Novembre 2026')
    expect(periodShort(nov)).toBe('Nov. 2026')
    expect(periodLabel({ vue: 'annee', year: 2026, month: 1 })).toBe('Année 2026')
    expect(pdfHref({ ...nov, month: 3 })).toBe('/api/exports/rapport-pdf?vue=mois&periode=2026-03')
    expect(pdfHref({ vue: 'annee', year: 2026, month: 1 })).toBe('/api/exports/rapport-pdf?vue=annee&periode=2026')
  })
})

describe('rapports : évolutions et marges', () => {
  it('compare à la période précédente', () => {
    expect(delta(0, 0)).toEqual({ kind: 'none' })
    expect(delta(100, 0)).toEqual({ kind: 'new' })
    expect(delta(110, 100)).toEqual({ kind: 'up', pct: 10 })
    expect(delta(80, 100)).toEqual({ kind: 'down', pct: 20 })
    expect(delta(100, 100)).toEqual({ kind: 'same' })
    expect(deltaText(delta(110, 100))).toBe('+10 % sur la période précédente')
    expect(deltaText(delta(80, 100))).toBe('-20 % sur la période précédente')
    expect(deltaText(delta(0, 0))).toBeNull()
  })

  it('juge une marge et pondère la moyenne par le facturé', () => {
    expect(marginTone(0.25)).toBe('success')
    expect(marginTone(0.1)).toBe('wait')
    expect(marginTone(0.01)).toBe('danger')
    expect(weightedMargin([{ caHt: 1000, marginEur: 500 }, { caHt: 9000, marginEur: 900 }])).toBeCloseTo(0.14)
    expect(weightedMargin([])).toBe(0)
  })

  it('calcule les chiffres de l’entretien et détecte l’absence de données', () => {
    const mr = { interventionsDone: 2, hoursTotal: 5, laborCost: 100, partsCost: 50, travelCost: 25, otherCost: 25, revenueHt: 1000, encaisseHt: 800, marginEur: 800, expectedRevenueHt: 1200, expectedCostHt: 600, expectedMarginHt: 600 } as MaintenanceReport
    expect(maintenanceFigures(mr)).toEqual({ actualCost: 200, actualMarginPct: 0.8, expectedMarginPct: 0.5, fieldCost: 100 })
    expect(hasMaintenanceData(mr)).toBe(true)
    expect(hasMaintenanceData({ ...mr, interventionsDone: 0, hoursTotal: 0, revenueHt: 0, partsCost: 0, travelCost: 0, expectedRevenueHt: 0, expectedCostHt: 0 })).toBe(false)
    expect(hasMaintenanceData(null)).toBe(false)
    expect(membersWithoutRateTitle(1)).toBe('1 intervenant sans taux horaire')
    expect(membersWithoutRateTitle(3)).toBe('3 intervenants sans taux horaire')
  })
})

describe('rapports : objectifs', () => {
  const annual: AnnualObjectives = { year: 2026, revenue_ht_target: 600000, margin_eur_target: null, margin_pct_target: 30, chantiers_count_target: null, new_clients_target: 25, hours_target: null, customs: [{ id: 'c1', label: 'Avis Google', target: 50, unit: 'avis', sort_order: 0 }] }

  it('transforme les objectifs en liste modifiable et inversement', () => {
    const entries = objectivesToEntries(annual, ANNUAL_STANDARD_OPTS)
    expect(entries.map(e => (e.kind === 'standard' ? e.key : e.label))).toEqual(['revenue_ht_target', 'margin_pct_target', 'new_clients_target', 'Avis Google'])
    const edited: ObjEntry[] = [{ kind: 'standard', key: 'hours_target', value: 2000 }, { kind: 'custom', label: 'Leads', target: 10, unit: '' }]
    const back = entriesToObjectives(edited, annual, ANNUAL_STANDARD_OPTS)
    expect(back.revenue_ht_target).toBeNull()
    expect(back.hours_target).toBe(2000)
    expect(back.customs).toEqual([{ id: undefined, label: 'Leads', target: 10, unit: '', sort_order: 0 }])
  })

  it('n’écrit pas « nouveaux clients » dans un objectif mensuel', () => {
    const monthly: MonthlyObjectives = { year: 2026, month: 11, revenue_ht_target: 10000, margin_eur_target: null, margin_pct_target: null, chantiers_count_target: null, hours_target: null, customs: [] }
    const back = entriesToObjectives([{ kind: 'standard', key: 'hours_target', value: 160 }], monthly, MONTHLY_STANDARD_OPTS)
    expect(back.revenue_ht_target).toBeNull()
    expect(back.hours_target).toBe(160)
    expect('new_clients_target' in back).toBe(false)
  })

  it('détecte des objectifs vides et propose le prochain objectif libre', () => {
    expect(objectivesEmpty(null)).toBe(true)
    expect(objectivesEmpty({ ...annual, revenue_ht_target: null, margin_pct_target: null, new_clients_target: null, customs: [] })).toBe(true)
    expect(objectivesEmpty(annual)).toBe(false)
    expect(nextEntry([{ kind: 'standard', key: 'revenue_ht_target', value: 1 }], ANNUAL_STANDARD_OPTS)).toEqual({ kind: 'standard', key: 'margin_eur_target', value: null })
    const all: ObjEntry[] = MONTHLY_STANDARD_OPTS.map(o => ({ kind: 'standard', key: o.key, value: 1 }))
    expect(nextEntry(all, MONTHLY_STANDARD_OPTS).kind).toBe('custom')
  })

  it('calcule l’avancement et son ton', () => {
    expect(progressPct(50, 200)).toBe(25)
    expect(progressPct(300, 200)).toBe(100)
    expect(progressPct(5, 0)).toBe(0)
    expect(progressTone(100)).toBe('success')
    expect(progressTone(75)).toBe('wait')
    expect(progressTone(10)).toBe('danger')
  })
})

describe('rapports : avancement des objectifs', () => {
  const inputs = { vue: 'annee' as const, billedLabel: 'Facturé HT', caHt: 300000, benefice: 80000, marginRatio: 0.29, chantiers: 24, newClients: 18, hours: 312.5 }
  const obj: AnnualObjectives = { year: 2026, revenue_ht_target: 600000, margin_eur_target: null, margin_pct_target: 30, chantiers_count_target: 40, new_clients_target: 25, hours_target: 340, customs: [{ label: 'Avis', target: 50, unit: 'avis', sort_order: 0 }] }

  it('mesure chaque objectif défini, les personnalisés restant à zéro', () => {
    const rows = objectiveProgress({ ...inputs, objectives: obj })
    expect(rows.map(r => r.key)).toEqual(['revenue', 'margin_pct', 'chantiers', 'clients', 'hours', 'custom-0'])
    expect(rows[1].current).toBeCloseTo(29)
    expect(rows[5].current).toBe(0)
    expect(objectiveProgress({ ...inputs, objectives: null })).toEqual([])
  })

  it('ignore « nouveaux clients » en vue mensuelle', () => {
    const rows = objectiveProgress({ ...inputs, vue: 'mois', objectives: obj })
    expect(rows.some(r => r.key === 'clients')).toBe(false)
  })

  it('formate la valeur selon le type d’objectif', () => {
    const rows = objectiveProgress({ ...inputs, objectives: obj })
    expect(formatProgress(rows[0], 300000)).toBe('300 000 €')
    expect(formatProgress(rows[1], 29)).toBe('29.0 %')
    expect(formatProgress(rows[2], 24.4)).toBe('24')
    expect(formatProgress(rows[4], 7.5)).toBe('7:30')
    expect(formatProgress(rows[5], 12)).toBe('12.0 avis')
  })
})
