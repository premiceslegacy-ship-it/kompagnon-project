import { describe, expect, it } from 'vitest'
import { overlaps } from '@/lib/planning/overlaps'

describe('planning-agent overlap detection', () => {
  it('detects overlapping time ranges', () => {
    expect(overlaps('09:00', '12:00', '10:00', '14:00')).toBe(true)
    expect(overlaps('09:00', '12:00', '11:59', '14:00')).toBe(true)
  })

  it('does not flag adjacent or disjoint ranges as conflicts', () => {
    expect(overlaps('09:00', '12:00', '12:00', '14:00')).toBe(false)
    expect(overlaps('09:00', '12:00', '13:00', '14:00')).toBe(false)
  })

  it('treats a slot with no time as covering the full day (conflict by default)', () => {
    expect(overlaps(null, null, '09:00', '10:00')).toBe(true)
    expect(overlaps('09:00', '10:00', null, null)).toBe(true)
    expect(overlaps(null, null, null, null)).toBe(true)
  })
})
