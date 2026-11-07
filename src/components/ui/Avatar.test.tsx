// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { Avatar } from './Avatar'

afterEach(() => cleanup())

describe('Avatar', () => {
  it('shows useful initials when no image is supplied', () => {
    render(<Avatar name="Ada Martin" />)

    expect(screen.getByRole('img', { name: 'Ada Martin' })).toBeTruthy()
    expect(screen.getByText('AM')).toBeTruthy()
  })

  it('can display a replacement image after a failed request', () => {
    const view = render(<Avatar name="Ada Martin" src="/avatars/person.png" />)

    fireEvent.error(screen.getByAltText(''))
    expect(screen.getByText('AM')).toBeTruthy()

    view.rerender(<Avatar name="Ada Martin" src="/avatars/replacement.png" />)
    const image = screen.getByAltText('') as HTMLImageElement
    fireEvent.load(image)
    expect(image.hidden).toBe(false)
    expect(screen.queryByText('AM')).toBeNull()
  })

  it.each([
    { result: 'failed', naturalWidth: 0 },
    { result: 'loaded', naturalWidth: 64 },
  ])('handles an image that $result before hydration', async ({ naturalWidth }) => {
    const container = document.createElement('div')
    container.innerHTML = renderToString(<Avatar name="Ada Martin" src="/avatars/person.png" />)
    document.body.append(container)
    const image = container.querySelector('img')!
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: naturalWidth },
    })
    let root: Root | undefined

    try {
      await act(async () => {
        root = hydrateRoot(container, <Avatar name="Ada Martin" src="/avatars/person.png" />)
      })
      const avatar = screen.getByRole('img', { name: 'Ada Martin' })
      if (naturalWidth === 0) {
        expect(avatar.textContent).toBe('AM')
        expect(avatar.querySelector('img')).toBeNull()
      } else {
        expect(avatar.textContent).toBe('')
        expect(avatar.querySelector('img')?.hidden).toBe(false)
      }
    } finally {
      await act(async () => root?.unmount())
      container.remove()
    }
  })
})
