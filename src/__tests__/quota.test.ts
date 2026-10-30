import { describe, expect, it, vi } from 'vitest'
import { ORGANIZATION_MODULE_KEYS, normalizeOrganizationModules } from '@/lib/organization-modules'
import { checkQuota, evaluateQuotaAllowance } from '@/lib/quota'
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
    // Les anciennes consommations WhatsApp restent lisibles dans l'historique sans quota associé.
    expect(getQuotaFeatureForTechnicalFeature('whatsapp_transcription')).toBeNull()
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
    const modules = normalizeOrganizationModules({ quote_ai: false })

    expect(Object.keys(modules).sort()).toEqual([...ORGANIZATION_MODULE_KEYS].sort())
    expect(modules.quote_ai).toBe(false)
  })

  it('ignores legacy whatsapp keys still stored in organization_modules', () => {
    const modules = normalizeOrganizationModules({ whatsapp_agent: true, whatsapp_ocr: true, whatsapp_proactive: true })

    expect(Object.keys(modules).some((key) => key.startsWith('whatsapp_'))).toBe(false)
    expect(Object.keys(modules).sort()).toEqual([...ORGANIZATION_MODULE_KEYS].sort())
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

describe('evaluateQuotaAllowance — bornes', () => {
  it('bloque au-delà du plafond en mode block', () => {
    const result = evaluateQuotaAllowance({
      quotaFeature: 'quote_ai',
      quotaUnit: 'call',
      quotaMonthly: 5,
      usedQuantity: 5,
      requestedQuantity: 1,
      overflowMode: 'block',
    })

    expect(result.allowed).toBe(false)
    expect(result.overQuota).toBe(true)
  })

  it('laisse passer en mode charge en signalant le dépassement', () => {
    const result = evaluateQuotaAllowance({
      quotaFeature: 'quote_ai',
      quotaUnit: 'call',
      quotaMonthly: 5,
      usedQuantity: 5,
      requestedQuantity: 1,
      overflowMode: 'charge',
    })

    expect(result.allowed).toBe(true)
    expect(result.overQuota).toBe(true)
  })

  it('accepte exactement le plafond', () => {
    const result = evaluateQuotaAllowance({
      quotaFeature: 'quote_ai',
      quotaUnit: 'call',
      quotaMonthly: 5,
      usedQuantity: 4,
      requestedQuantity: 1,
      overflowMode: 'block',
    })

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(0)
  })
})
function makeQuery(result: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    gte: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(async () => result),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  query.select.mockImplementation(() => query)
  query.eq.mockImplementation(() => query)
  query.in.mockImplementation(() => query)
  query.gte.mockImplementation(() => query)
  query.limit.mockImplementation(() => query)
  return query
}

function makeQuotaClient(params: {
  usageRows?: Array<{ status: string; quota_quantity: number }>
  usageError?: { message: string } | null
  reservation?: { data: unknown; error: { message: string } | null }
}) {
  const modulesQuery = makeQuery({
    data: { quota_config: { quote_ai: 10 }, overflow_mode: 'block', ai_billing_mode: 'orsayn_shared' },
    error: null,
  })
  const usageResult = { data: params.usageRows ?? [], error: params.usageError ?? null }
  const usageQuery = makeQuery(usageResult)
  usageQuery.in.mockImplementation((column: string, values: string[]) => {
    if (column === 'status') usageResult.data = usageResult.data.filter(row => values.includes(row.status))
    return usageQuery
  })
  const from = vi.fn((table: string) => table === 'organization_modules' ? modulesQuery : usageQuery)
  const rpc = vi.fn(async () => params.reservation ?? {
    data: null,
    error: { message: 'reservation RPC unavailable' },
  })
  // This narrow mock supplies only the query methods checkQuota exercises.
  const supabase = { from, rpc } as unknown as Parameters<typeof checkQuota>[0]['supabase']
  return { supabase, usageQuery, rpc }
}

describe('checkQuota reservation accounting', () => {
  it('counts successful, in-flight, and failed calls before making a new allowance decision', async () => {
    const { supabase } = makeQuotaClient({
      usageRows: [
        { status: 'success', quota_quantity: 2 },
        { status: 'reserved', quota_quantity: 3 },
        { status: 'error', quota_quantity: 4 },
        { status: 'blocked', quota_quantity: 100 },
      ],
    })

    const result = await checkQuota({
      supabase,
      organizationId: 'org-1',
      technicalFeature: 'quote_analysis',
      quantity: 2,
    })

    expect(result.usedQuantity).toBe(9)
    expect(result.allowed).toBe(false)
    expect(result.overQuota).toBe(true)
  })

  it('fails closed when the atomic reservation RPC fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { supabase, rpc } = makeQuotaClient({
        usageRows: [{ status: 'success', quota_quantity: 2 }],
        reservation: { data: null, error: { message: 'database unavailable' } },
      })

      const result = await checkQuota({
        supabase,
        organizationId: 'org-1',
        technicalFeature: 'quote_analysis',
        reserve: true,
      })

      expect(rpc).toHaveBeenCalledWith('reserve_quota', expect.objectContaining({
        p_org: 'org-1',
        p_feature: 'quote_ai',
        p_limit: 10,
      }))
      expect(result.allowed).toBe(false)
      expect(result.reservationId).toBeUndefined()
    } finally {
      log.mockRestore()
    }
  })

  it('fails closed if the RPC says allowed but returns no reservation id', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { supabase } = makeQuotaClient({
        reservation: { data: { allowed: true, used: 1, reservation_id: null }, error: null },
      })

      const result = await checkQuota({
        supabase,
        organizationId: 'org-1',
        technicalFeature: 'quote_analysis',
        reserve: true,
      })

      expect(result.allowed).toBe(false)
      expect(result.reservationId).toBeUndefined()
    } finally {
      log.mockRestore()
    }
  })

  it('returns the durable reservation id on an allowed RPC result', async () => {
    const { supabase } = makeQuotaClient({
      reservation: { data: [{ allowed: true, used: 1, reservation_id: 'reservation-1' }], error: null },
    })

    const result = await checkQuota({
      supabase,
      organizationId: 'org-1',
      technicalFeature: 'quote_analysis',
      reserve: true,
    })

    expect(result.allowed).toBe(true)
    expect(result.reservationId).toBe('reservation-1')
  })
})
