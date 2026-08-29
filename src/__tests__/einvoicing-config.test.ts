import { describe, expect, it } from 'vitest'
import { normalizeEinvoicingConfig, normalizeEinvoicingConfigFromDb } from '@/lib/einvoicing-config'

// Garantit la contrainte produit : emission/reception ne sont jamais activables
// hors mode='super_pdp', et jamais activables implicitement (defaut = false).
// Voir docs/atelier-facturation-electronique.md §7.4/§7.5.
describe('normalizeEinvoicingConfig — granularite emission/reception', () => {
  it('defaults to disabled when input is empty', () => {
    const config = normalizeEinvoicingConfig({})
    expect(config.mode).toBe('off')
    expect(config.emission_enabled).toBe(false)
    expect(config.reception_enabled).toBe(false)
  })

  it('keeps emission/reception disabled even if requested, when mode is off', () => {
    const config = normalizeEinvoicingConfig({
      mode: 'off',
      emission_enabled: true,
      reception_enabled: true,
    })
    expect(config.emission_enabled).toBe(false)
    expect(config.reception_enabled).toBe(false)
  })

  it('keeps emission/reception disabled when mode is export_only', () => {
    const config = normalizeEinvoicingConfig({
      mode: 'export_only',
      emission_enabled: true,
      reception_enabled: true,
    })
    expect(config.emission_enabled).toBe(false)
    expect(config.reception_enabled).toBe(false)
  })

  it('enables emission/reception independently when mode is super_pdp', () => {
    const emissionOnly = normalizeEinvoicingConfig({
      mode: 'super_pdp',
      emission_enabled: true,
      reception_enabled: false,
    })
    expect(emissionOnly.emission_enabled).toBe(true)
    expect(emissionOnly.reception_enabled).toBe(false)

    const receptionOnly = normalizeEinvoicingConfig({
      mode: 'super_pdp',
      emission_enabled: false,
      reception_enabled: true,
    })
    expect(receptionOnly.emission_enabled).toBe(false)
    expect(receptionOnly.reception_enabled).toBe(true)
  })

  it('does not enable emission/reception from mode=super_pdp alone (oauth connected but flags absent)', () => {
    const config = normalizeEinvoicingConfig({
      mode: 'super_pdp',
      oauth_status: 'connected',
    })
    expect(config.oauth_status).toBe('connected')
    expect(config.emission_enabled).toBe(false)
    expect(config.reception_enabled).toBe(false)
  })

  it('rejects non-boolean truthy values for emission/reception (defensive parsing)', () => {
    const config = normalizeEinvoicingConfig({
      mode: 'super_pdp',
      emission_enabled: 'true',
      reception_enabled: 1,
    })
    expect(config.emission_enabled).toBe(false)
    expect(config.reception_enabled).toBe(false)
  })

  it('round-trips through normalizeEinvoicingConfigFromDb the same way', () => {
    const config = normalizeEinvoicingConfigFromDb({
      mode: 'super_pdp',
      oauth_status: 'connected',
      emission_enabled: true,
      reception_enabled: true,
    })
    expect(config.emission_enabled).toBe(true)
    expect(config.reception_enabled).toBe(true)
  })

  it('defaults to disabled when normalizeEinvoicingConfigFromDb receives null/undefined', () => {
    expect(normalizeEinvoicingConfigFromDb(null).emission_enabled).toBe(false)
    expect(normalizeEinvoicingConfigFromDb(undefined).reception_enabled).toBe(false)
  })
})
