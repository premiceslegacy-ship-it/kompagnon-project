import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FREQ_OPTIONS, fmt, fmtDate, isEquipmentLine, isReadyToPrepare } from '@/app/(app)/finances/recurring/recurringModel'
import type { RecurringInvoice } from '@/lib/data/recurring-utils'

function model(overrides: Partial<RecurringInvoice> = {}): RecurringInvoice {
  return { is_active: true, next_send_date: '2026-12-10', requires_confirmation: true, confirmation_delay_days: 3, ...overrides } as unknown as RecurringInvoice
}

describe('isReadyToPrepare', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('devient vrai à partir du délai de préparation avant l’envoi', () => {
    vi.setSystemTime(new Date('2026-12-06T10:00:00'))
    expect(isReadyToPrepare(model())).toBe(false)
    vi.setSystemTime(new Date('2026-12-07T08:00:00'))
    expect(isReadyToPrepare(model())).toBe(true)
  })

  it('utilise trois jours quand le délai est absent', () => {
    vi.setSystemTime(new Date('2026-12-07T08:00:00'))
    expect(isReadyToPrepare(model({ confirmation_delay_days: null }))).toBe(true)
  })

  it('attend la date d’envoi quand aucune confirmation n’est demandée', () => {
    vi.setSystemTime(new Date('2026-12-09T08:00:00'))
    expect(isReadyToPrepare(model({ requires_confirmation: false }))).toBe(false)
    vi.setSystemTime(new Date('2026-12-10T08:00:00'))
    expect(isReadyToPrepare(model({ requires_confirmation: false }))).toBe(true)
  })

  it('ne propose jamais un modèle en pause', () => {
    vi.setSystemTime(new Date('2027-01-01T08:00:00'))
    expect(isReadyToPrepare(model({ is_active: false }))).toBe(false)
  })
})

describe('affichage', () => {
  it('arrondit les montants à l’euro et écrit les dates en toutes lettres', () => {
    expect(fmt(1234.56).replace(/[\s  ]/g, '')).toBe('1235€')
    expect(fmtDate('2026-12-01')).toContain('décembre')
  })

  it('propose les quatre fréquences', () => {
    expect(FREQ_OPTIONS.map(o => o.value)).toEqual(['monthly', 'quarterly', 'weekly', 'custom'])
  })

  it('reconnaît une ligne d’équipement amorti', () => {
    expect(isEquipmentLine({ is_internal: true, unit: 'usage' })).toBe(true)
    expect(isEquipmentLine({ is_internal: false, unit: 'usage' })).toBe(false)
  })
})
