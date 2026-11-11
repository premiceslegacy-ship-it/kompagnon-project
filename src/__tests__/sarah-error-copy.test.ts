import { describe, expect, it } from 'vitest'
import { getSarahErrorContent } from '@/components/sarah/errorCopy'

describe('Sarah provider error copy', () => {
  it('does not expose provider names or suggest a plan upgrade for an assistant configuration error', () => {
    const content = getSarahErrorContent('openrouter_credits')
    expect(`${content.title} ${content.body}`).not.toMatch(/openrouter/i)
    expect(content.upgrade).toBe(false)
  })
})
