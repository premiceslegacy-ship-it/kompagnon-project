import { describe, expect, it } from 'vitest'
import { ORGANIZATION_MODULE_KEYS, normalizeOrganizationModules } from '@/lib/organization-modules'
import { evaluateQuotaAllowance } from '@/lib/quota'
import {
  getQuotaFeatureForTechnicalFeature,
  QUOTA_FEATURES,
  QUOTAS_BY_TIER,
  TECHNICAL_FEATURE_TO_QUOTA,
} from '@/lib/quota-catalog'

describe('quota catalog', () => {
  it('maps technical features to commercial quota features', () => {
    expect(getQuotaFeatureForTechnicalFeature('quote_analysis')).toBe('quote_ai')
    expect(getQuotaFeatureForTechnicalFeature('document_parse')).toBe('document_import_ai')
    expect(getQuotaFeatureForTechnicalFeature('voice_transcription')).toBe('voice_input')
    expect(getQuotaFeatureForTechnicalFeature('whatsapp_transcription')).toBe('wa_vocal_minutes')
  })

  it('defines every tier quota for every quota feature', () => {
    for (const quotas of Object.values(QUOTAS_BY_TIER)) {
      expect(Object.keys(quotas).sort()).toEqual([...QUOTA_FEATURES].sort())
    }
  })

  it('does not map technical features to unknown quota features', () => {
    for (const quotaFeature of Object.values(TECHNICAL_FEATURE_TO_QUOTA)) {
      expect(QUOTA_FEATURES).toContain(quotaFeature)
    }
  })
})

describe('organization modules', () => {
  it('normalizes every module key', () => {
    const modules = normalizeOrganizationModules({ quote_ai: false, whatsapp_agent: true })

    expect(Object.keys(modules).sort()).toEqual([...ORGANIZATION_MODULE_KEYS].sort())
    expect(modules.quote_ai).toBe(false)
    expect(modules.whatsapp_agent).toBe(true)
  })
})

describe('evaluateQuotaAllowance', () => {
  it('allows unlimited quotas', () => {
    const result = evaluateQuotaAllowance({
      quotaFeature: 'quote_ai',
      quotaUnit: 'call',
      quotaMonthly: -1,
      usedQuantity: 1000,
      requestedQuantity: 1,
      overflowMode: 'block',
    })

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBeNull()
  })

  it('allows usage below quota', () => {
    const result = evaluateQuotaAllowance({
      quotaFeature: 'quote_ai',
      quotaUnit: 'call',
      quotaMonthly: 10,
      usedQuantity: 8,
      requestedQuantity: 1,
      overflowMode: 'block',
    })

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(1)
    expect(result.overQuota).toBe(false)
  })

  it('blocks usage above quota in block mode', () => {
    const result = evaluateQuotaAllowance({
      quotaFeature: 'quote_ai',
      quotaUnit: 'call',
      quotaMonthly: 10,
      usedQuantity: 10,
      requestedQuantity: 1,
      overflowMode: 'block',
    })

    expect(result.allowed).toBe(false)
    expect(result.overQuota).toBe(true)
  })

  it('allows over quota usage in upgrade_prompt and charge modes', () => {
    for (const overflowMode of ['upgrade_prompt', 'charge'] as const) {
      const result = evaluateQuotaAllowance({
        quotaFeature: 'quote_ai',
        quotaUnit: 'call',
        quotaMonthly: 10,
        usedQuantity: 10,
        requestedQuantity: 1,
        overflowMode,
      })

      expect(result.allowed).toBe(true)
      expect(result.overQuota).toBe(true)
    }
  })
})
