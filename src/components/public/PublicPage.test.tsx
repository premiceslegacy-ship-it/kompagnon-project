// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PublicError, PublicHeader, PublicPage, PublicSuccess } from './PublicPage'

afterEach(cleanup)

describe('PublicPage', () => {
  it('présente l’entreprise, son adresse et le document', () => {
    render(
      <PublicPage>
        <PublicHeader name="Atelier Mbeboura" address="12 rue des Forges, 69007 Lyon" subtitle="Devis D-114 · Salle de bain" />
      </PublicPage>,
    )
    expect(screen.getByRole('main')).toBeTruthy()
    expect(screen.getByText('Atelier Mbeboura')).toBeTruthy()
    expect(screen.getByText('12 rue des Forges, 69007 Lyon')).toBeTruthy()
    expect(screen.getByText('Devis D-114 · Salle de bain')).toBeTruthy()
  })

  it('annonce la réussite par un titre de premier niveau', () => {
    render(<PublicSuccess title="Devis accepté" description="Votre accord est enregistré." />)
    expect(screen.getByRole('heading', { level: 1, name: 'Devis accepté' })).toBeTruthy()
  })

  it('n’affiche une erreur que lorsqu’il y en a une, et l’annonce', () => {
    const { rerender } = render(<PublicError>{null}</PublicError>)
    expect(screen.queryByRole('alert')).toBeNull()
    rerender(<PublicError>Indiquez votre nom complet.</PublicError>)
    expect(screen.getByRole('alert').textContent).toBe('Indiquez votre nom complet.')
  })
})
