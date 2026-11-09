// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ProgressRing } from './ProgressRing'
import { Sparkline, buildSparklinePath } from './Sparkline'
import { SplitBar } from './SplitBar'

afterEach(cleanup)

describe('ProgressRing', () => {
  it('expose son avancement aux lecteurs d’écran et ramène la valeur dans 0 à 100', () => {
    const { container } = render(<ProgressRing value={140} label="Avancement : 100 %">100 %</ProgressRing>)
    expect(screen.getByRole('img', { name: 'Avancement : 100 %' })).toBeTruthy()
    const arc = container.querySelector('circle:nth-of-type(2)') as SVGCircleElement
    expect(Number(arc.getAttribute('stroke-dashoffset'))).toBeCloseTo(0, 5)
  })

  it('ne trace pas d’arc à 0 % ni sur une valeur invalide', () => {
    const { container, rerender } = render(<ProgressRing value={0} label="Avancement : 0 %" />)
    expect(container.querySelectorAll('circle')).toHaveLength(1)
    rerender(<ProgressRing value={Number.NaN} label="Avancement inconnu" />)
    expect(container.querySelectorAll('circle')).toHaveLength(1)
  })

  it('laisse l’arc proportionnel à la valeur', () => {
    const { container } = render(<ProgressRing value={25} label="Avancement : 25 %" size={100} stroke={10} />)
    const arc = container.querySelector('circle:nth-of-type(2)') as SVGCircleElement
    const circumference = 2 * Math.PI * 45
    expect(Number(arc.getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference * 0.75, 3)
  })
})

describe('Sparkline', () => {
  it('ne dessine rien sous deux valeurs', () => {
    expect(buildSparklinePath([3], 100, 30)).toBeNull()
    const { container } = render(<Sparkline values={[3]} label="Tendance" />)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('place la plus haute valeur en haut et la plus basse en bas, dans les marges', () => {
    const path = buildSparklinePath([10, 50, 30], 100, 40)
    expect(path).not.toBeNull()
    expect(path!.line.startsWith('M4 36')).toBe(true)
    expect(path!.last.x).toBe(96)
  })

  it('trace une ligne au milieu quand toutes les valeurs sont égales', () => {
    const path = buildSparklinePath([7, 7, 7], 100, 40)
    expect(path!.last.y).toBe(20)
  })

  it('porte son libellé', () => {
    render(<Sparkline values={[1, 2, 3]} label="Facturé sur trois mois" />)
    expect(screen.getByRole('img', { name: 'Facturé sur trois mois' })).toBeTruthy()
  })
})

describe('SplitBar', () => {
  it('répartit la barre selon les valeurs et omet les segments vides', () => {
    const { container } = render(
      <SplitBar
        label="Répartition des devis"
        segments={[
          { key: 'a', label: 'Envoyés', value: 3, tone: 'accent' },
          { key: 'b', label: 'Acceptés', value: 1, tone: 'success' },
          { key: 'c', label: 'Refusés', value: 0, tone: 'danger' },
        ]}
      />,
    )
    const segments = container.querySelectorAll('[data-tone]:not(li)')
    expect(segments).toHaveLength(2)
    expect((segments[0] as HTMLElement).style.flexGrow).toBe('3')
    expect(screen.getByRole('img', { name: 'Répartition des devis : Envoyés 3, Acceptés 1' })).toBeTruthy()
    expect(screen.queryByText('Refusés')).toBeNull()
  })

  it('dit « aucune donnée » quand tout est à zéro', () => {
    render(<SplitBar label="Répartition des devis" segments={[{ key: 'a', label: 'Envoyés', value: 0, tone: 'accent' }]} />)
    expect(screen.getByRole('img', { name: 'Répartition des devis : aucune donnée' })).toBeTruthy()
  })
})
