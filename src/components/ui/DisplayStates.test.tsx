// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StatusPill } from './StatusPill'
import { StatTile } from './StatTile'
import { PageSkeleton } from './PageSkeleton'
import { Skeleton } from './Skeleton'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { Dock } from './Dock'

afterEach(cleanup)

it('keeps informational content outside the recovery and primary action tab sequence', async () => {
  const user = userEvent.setup()
  render(
    <>
      <button type="button">Première action</button>
      <StatusPill status="success">Signé</StatusPill>
      <StatTile label="À encaisser" value="42" detail="Données d’exemple" />
      <PageSkeleton rows={4} />
      <Skeleton />
      <EmptyState title="Aucun client" description="Ajoutez votre premier client." />
      <ErrorState title="Impossible de charger les documents" description="La connexion a été coupée." onRetry={() => {}} />
      <Dock totalLabel="Total TTC" total="42 €" actionLabel="Envoyer le devis" onAction={() => {}} />
      <button type="button">Action suivante</button>
    </>,
  )

  await user.tab()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Première action' }))
  await user.tab()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Réessayer' }))
  await user.tab()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Envoyer le devis' }))
  await user.tab()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Action suivante' }))
})
