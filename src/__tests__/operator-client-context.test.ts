import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createOperatorAdminClient } = vi.hoisted(() => ({
  createOperatorAdminClient: vi.fn(),
}))

vi.mock('@/lib/supabase/operator', () => ({ createOperatorAdminClient }))

import {
  getOperatorClientContext,
  UNRESOLVED_ORGANIZATION_ID,
} from '@/lib/operator/trial-lifecycle'

describe('operator tenant scope', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([undefined, UNRESOLVED_ORGANIZATION_ID])(
    'rejects an unresolved tenant instead of resolving the latest registered client (%s)',
    async (organizationId) => {
      await expect(getOperatorClientContext('atelier-app', organizationId)).rejects.toBeInstanceOf(TypeError)
      expect(createOperatorAdminClient).not.toHaveBeenCalled()
    },
  )
})
