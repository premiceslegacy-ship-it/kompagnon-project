// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SignaturePad } from './SignaturePad'

afterEach(cleanup)

describe('SignaturePad', () => {
  it('associates the hint with the signature surface and disables clear when empty', () => {
    const { container } = render(<SignaturePad value={null} onChange={() => {}} hint="Aide de saisie." />)

    const canvas = container.querySelector('canvas') as HTMLCanvasElement
    const clearButton = screen.getByRole('button') as HTMLButtonElement
    const hint = container.querySelector('p') as HTMLParagraphElement
    expect(canvas.getAttribute('aria-describedby')).toBe(hint.id)
    expect(clearButton.disabled).toBe(true)
  })
  it('enables clear when a signature value is supplied', () => {
    const signature = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/8fkAAAAASUVORK5CYII='
    render(<SignaturePad value={signature} onChange={() => {}} />)

    const clearButton = screen.getByRole('button') as HTMLButtonElement
    expect(clearButton.disabled).toBe(false)
  })
})
