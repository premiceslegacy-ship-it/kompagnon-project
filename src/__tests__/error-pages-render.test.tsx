// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sentry/browser', () => ({ captureException: vi.fn() }))

afterEach(() => cleanup())

describe('pages d’erreur rendues', () => {
  it('global-error s’affiche seule, avec son bouton de reprise et la référence de l’erreur', async () => {
    const { default: GlobalError } = await import('@/app/global-error')
    const error = Object.assign(new Error('boom'), { digest: 'abc123def456' })
    const reset = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<GlobalError error={error} reset={reset} />, { container: document.documentElement })

    expect(screen.getByRole('heading', { name: /Atelier fait une pause/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Recharger|Réessayer/ }))
    expect(reset).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toMatch(/Référence\s*abc1-23de/)
  })

  it('l’accès réservé explique le refus et propose une sortie', async () => {
    const { AccessDenied } = await import('@/components/errors/AccessDenied')
    render(<AccessDenied what="l’éditeur de factures" />)
    expect(screen.getByRole('heading', { name: 'Accès réservé' })).toBeTruthy()
    expect(document.body.textContent).toContain('l’éditeur de factures')
    expect(screen.getByRole('link', { name: /Aujourd/ }).getAttribute('href')).toBe('/dashboard')
  })
})
