// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { OfflineBanner } from './OfflineBanner'

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
  window.dispatchEvent(new Event(value ? 'online' : 'offline'))
}

afterEach(() => {
  cleanup()
  setOnline(true)
})

describe('OfflineBanner', () => {
  it('reste absent en ligne, apparaît hors ligne et disparaît au retour du réseau', () => {
    render(<OfflineBanner />)
    expect(screen.queryByRole('status')).toBeNull()
    act(() => setOnline(false))
    expect(screen.getByRole('status').textContent).toContain('hors ligne')
    act(() => setOnline(true))
    expect(screen.queryByRole('status')).toBeNull()
  })
})
