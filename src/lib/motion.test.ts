import { afterEach, describe, expect, it, vi } from 'vitest'
import { getMotionTransition } from './motion'

afterEach(() => vi.unstubAllGlobals())

describe('Atelier motion preferences', () => {
  it('uses a short non-spring transition when the system requests reduced motion', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true })
    vi.stubGlobal('window', { matchMedia })

    const transition = getMotionTransition('reussite')
    expect(transition.type).not.toBe('spring')
    expect(transition.duration).toBeLessThanOrEqual(0.15)
  })

  it('allows an explicit preference to override the system setting', () => {
    vi.stubGlobal('window', { matchMedia: vi.fn().mockReturnValue({ matches: true }) })

    expect(getMotionTransition('entree', false)).toMatchObject({ type: 'spring' })
  })
})
