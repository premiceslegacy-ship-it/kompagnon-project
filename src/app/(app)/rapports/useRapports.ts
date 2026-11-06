'use client'
// @atelier-migrated
// Rapports : état de la période affichée, chargement des données à chaque changement de période, détail ouvert.

import { useCallback, useEffect, useState, useTransition } from 'react'
import type {
  AnnualObjectives, AnnualReport, HoursReport, MaintenanceReport, MemberWithoutRate, MonthlyObjectives, MonthlyReport, TopChantierEntry, TopClientEntry,
} from '@/lib/data/queries/reporting'
import { fetchAnnualDataAction, fetchMonthlyDataAction } from './actions'
import { canGoNext, nextPeriod, previousPeriod, type Period, type Vue } from './rapportsModel'

export type RapportsProps = {
  initialVue: Vue
  initialYear: number
  initialMonth: number
  initialMonthlyReport: MonthlyReport | null
  initialAnnualReport: AnnualReport | null
  initialHoursReport: HoursReport | null
  initialTopClients: TopClientEntry[]
  initialTopChantiers: TopChantierEntry[]
  initialMaintenanceReport: MaintenanceReport | null
  initialAnnualObjectives: AnnualObjectives | null
  initialMonthlyObjectives: MonthlyObjectives | null
  membersWithoutRate: MemberWithoutRate[]
  isVatSubject: boolean
}

export type RapportDetail = 'renta' | 'activite' | 'entretien' | 'objectifs' | 'heures' | 'top'
export const RAPPORT_DETAILS: readonly RapportDetail[] = ['renta', 'activite', 'entretien', 'objectifs', 'heures', 'top']

export function useRapports(props: RapportsProps) {
  const [vue, setVue] = useState<Vue>(props.initialVue)
  const [year, setYear] = useState(props.initialYear)
  const [month, setMonth] = useState(props.initialMonth)
  const [monthlyReport, setMonthlyReport] = useState(props.initialMonthlyReport)
  const [annualReport, setAnnualReport] = useState(props.initialAnnualReport)
  const [hoursReport, setHoursReport] = useState(props.initialHoursReport)
  const [topClients, setTopClients] = useState(props.initialTopClients)
  const [topChantiers, setTopChantiers] = useState(props.initialTopChantiers)
  const [maintenanceReport, setMaintenanceReport] = useState(props.initialMaintenanceReport)
  const [annualObjectives, setAnnualObjectives] = useState(props.initialAnnualObjectives)
  const [monthlyObjectives, setMonthlyObjectives] = useState(props.initialMonthlyObjectives)
  const [loading, startTransition] = useTransition()
  const [detail, setDetail] = useState<RapportDetail | null>(null)

  const goMonthly = useCallback((y: number, m: number) => {
    startTransition(async () => {
      setVue('mois'); setYear(y); setMonth(m)
      const data = await fetchMonthlyDataAction(y, m)
      setMonthlyReport(data.monthlyReport)
      setHoursReport(data.hoursReport)
      setTopClients(data.topClients)
      setTopChantiers(data.topChantiers)
      setMaintenanceReport(data.maintenanceReport)
      setMonthlyObjectives(data.objectives)
    })
  }, [])

  const goAnnual = useCallback((y: number) => {
    startTransition(async () => {
      setVue('annee'); setYear(y)
      const data = await fetchAnnualDataAction(y)
      setAnnualReport(data.annualReport)
      setHoursReport(data.hoursReport)
      setTopClients(data.topClients)
      setTopChantiers(data.topChantiers)
      setMaintenanceReport(data.maintenanceReport)
      setAnnualObjectives(data.objectives)
    })
  }, [])

  const period: Period = { vue, year, month }
  const goTo = (p: Period) => (p.vue === 'mois' ? goMonthly(p.year, p.month) : goAnnual(p.year))
  const goPrevious = () => goTo(previousPeriod(period))
  const goNext = () => { if (canGoNext(period)) goTo(nextPeriod(period)) }
  const switchVue = (next: Vue) => { if (next !== vue) goTo({ ...period, vue: next }) }

  // Le retour du navigateur ferme le détail ouvert ; l'ouverture d'un détail ajoute une entrée d'historique.
  useEffect(() => {
    const onPop = () => {
      const d = new URLSearchParams(window.location.search).get('detail')
      setDetail((RAPPORT_DETAILS as readonly string[]).includes(d ?? '') ? (d as RapportDetail) : null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const openDetail = useCallback((next: RapportDetail | null) => {
    setDetail(next)
    const url = new URL(window.location.href)
    if (next) url.searchParams.set('detail', next); else url.searchParams.delete('detail')
    window.history.pushState(null, '', url)
    window.scrollTo(0, 0)
  }, [])

  const report: MonthlyReport | AnnualReport | null = vue === 'mois' ? monthlyReport : annualReport
  const objectives = vue === 'mois' ? monthlyObjectives : annualObjectives

  return {
    ...props, vue, year, month, period, loading, detail, openDetail, goPrevious, goNext, switchVue,
    monthlyReport, annualReport, report, hoursReport, topClients, topChantiers, maintenanceReport,
    annualObjectives, setAnnualObjectives, monthlyObjectives, setMonthlyObjectives, objectives,
  }
}

export type RapportsState = ReturnType<typeof useRapports>
