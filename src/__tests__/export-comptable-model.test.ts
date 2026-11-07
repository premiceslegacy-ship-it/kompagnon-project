import { describe, expect, it } from 'vitest'
import { backupStatus, canDownload, closureNameMatches, downloadParams, formatFileSize, hasDownloadableContent, isBlockingGap, memoryTypeLabel, periodRange, ymd, type ExportContent, type PreviewData } from '@/app/(app)/settings/exportComptableModel'

const all: ExportContent = { invoices: true, avoirs: true, payments: true, received: true }
const gaps = { numberingHasGaps: true, numberingGaps: ['F-3'] } as PreviewData

describe('export comptable : périodes', () => {
  it('formate une date locale sans décalage UTC', () => {
    expect(ymd(new Date(2026, 10, 30))).toBe('2026-11-30')
  })

  it('calcule le mois, le trimestre et l’exercice courants', () => {
    const now = new Date(2026, 10, 6)
    expect(periodRange('current_month', now)).toEqual({ from: '2026-11-01', to: '2026-11-30' })
    expect(periodRange('current_quarter', now)).toEqual({ from: '2026-10-01', to: '2026-12-31' })
    expect(periodRange('fiscal_year', now)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    expect(periodRange('custom', now)).toBeNull()
    expect(periodRange('current_month', new Date(2028, 1, 10))?.to).toBe('2028-02-29')
  })
})

describe('export comptable : contenu et blocages', () => {
  it('le CSV simplifié ignore les factures reçues', () => {
    const onlyReceived = { invoices: false, avoirs: false, payments: false, received: true }
    expect(hasDownloadableContent(onlyReceived, 'fec')).toBe(true)
    expect(hasDownloadableContent(onlyReceived, 'csv')).toBe(false)
  })

  it('un trou de numérotation ne bloque qu’un FEC d’exercice complet', () => {
    expect(isBlockingGap(gaps, 'fec', 'fiscal_year')).toBe(true)
    expect(isBlockingGap(gaps, 'fec', 'current_month')).toBe(false)
    expect(isBlockingGap(gaps, 'csv', 'fiscal_year')).toBe(false)
    expect(isBlockingGap(null, 'fec', 'fiscal_year')).toBe(false)
  })

  it('autorise le téléchargement selon le SIREN, le contenu et le blocage', () => {
    const base = { content: all, format: 'fec' as const, period: 'fiscal_year' as const, preview: null, siren: '123456789', busy: false }
    expect(canDownload(base)).toBe(true)
    expect(canDownload({ ...base, siren: null })).toBe(false)
    expect(canDownload({ ...base, siren: null, format: 'csv' })).toBe(true)
    expect(canDownload({ ...base, preview: gaps })).toBe(false)
    expect(canDownload({ ...base, busy: true })).toBe(false)
  })

  it('construit les paramètres de téléchargement', () => {
    const p = downloadParams({ from: '2026-01-01', to: '2026-03-31', format: 'csv', period: 'custom', content: { ...all, received: false } })
    expect(p.get('preset')).toBe('period')
    expect(p.get('include_received')).toBe('false')
    expect(p.get('include_invoices')).toBe('true')
  })
})

describe('sauvegardes et fermeture', () => {
  it('traduit l’état d’une sauvegarde et formate sa taille', () => {
    expect(backupStatus('ready')).toEqual({ label: 'Prêt', pill: 'success' })
    expect(backupStatus('processing').pill).toBe('wait')
    expect(formatFileSize(null)).toBe('Taille en attente')
    expect(formatFileSize(512)).toBe('512 o')
    expect(formatFileSize(1536)).toBe('1.5 Ko')
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 Mo')
  })

  it('exige le nom exact de l’organisation', () => {
    expect(closureNameMatches('Atelier', 'Atelier')).toBe(true)
    expect(closureNameMatches('atelier', 'Atelier')).toBe(false)
    expect(closureNameMatches('', null)).toBe(false)
  })

  it('nomme l’origine d’un souvenir avec l’assistante officielle', () => {
    expect(memoryTypeLabel('sarah_memory', 'Sarah')).toBe('Retenu par Sarah')
    expect(memoryTypeLabel('marco_memory', 'Sarah', { chantier_id: 'c1' })).toBe('Retenu par Sarah · ce chantier')
    expect(memoryTypeLabel('invoice', 'Sarah')).toBe('Résumé document')
    expect(memoryTypeLabel('autre', 'Sarah')).toBe('autre')
  })
})
