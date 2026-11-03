// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AssistantField } from './AssistantField'

afterEach(cleanup)

describe('AssistantField', () => {
  it('requires a non-empty request and submits by button or Enter', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    function ControlledField() {
      const [value, setValue] = useState('')
      return <AssistantField value={value} onChange={setValue} onSubmit={onSubmit} />
    }
    render(<ControlledField />)

    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    const send = screen.getByRole('button') as HTMLButtonElement
    expect(send.disabled).toBe(true)

    await user.type(input, 'Relancer les devis')
    expect(input.value).toBe('Relancer les devis')
    expect(send.disabled).toBe(false)

    await user.click(send)
    await user.click(input)
    await user.keyboard('{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })

  it('fills a suggested request without submitting it', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const onChange = vi.fn()
    render(
      <AssistantField
        value=""
        onChange={onChange}
        onSubmit={onSubmit}
        suggestions={['Relancer les devis sans réponse']}
      />
    )

    const suggestionButton = screen.getByRole('group').querySelector('button') as HTMLButtonElement
    await user.click(suggestionButton)

    expect(onChange).toHaveBeenCalledWith('Relancer les devis sans réponse')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('keeps focus and blocks edits and sending while loading, then resumes', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const onChange = vi.fn()
    const { rerender } = render(
      <AssistantField value="Une demande" onChange={onChange} onSubmit={onSubmit} />
    )

    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    const form = screen.getByRole('form', { name: 'Assistant' })
    input.focus()
    rerender(
      <AssistantField value="Une demande" onChange={onChange} onSubmit={onSubmit} loading />
    )

    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('Une demande')
    fireEvent.change(input, { target: { value: 'Une autre demande' } })
    await user.keyboard('{Enter}')
    fireEvent.click(screen.getByRole('button', { name: 'Traitement en cours' }))
    fireEvent.submit(form)
    expect(onChange).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()

    rerender(
      <AssistantField value="Une demande" onChange={onChange} onSubmit={onSubmit} />
    )
    fireEvent.change(input, { target: { value: 'Une nouvelle demande' } })
    expect(onChange).toHaveBeenCalledWith('Une nouvelle demande')
    await user.click(screen.getByRole('button', { name: 'Envoyer' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('keeps explicitly disabled requests inert and exposes field errors', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const onChange = vi.fn()
    render(
      <AssistantField
        value="Une demande"
        onChange={onChange}
        onSubmit={onSubmit}
        suggestions={['Relancer les devis']}
        disabled
        error="Connexion interrompue. Réessayez."
      />
    )

    const input = screen.getByRole('textbox') as HTMLTextAreaElement
    const error = screen.getByRole('alert')
    const suggestion = screen.getByRole('button', { name: 'Relancer les devis' })
    const send = screen.getByRole('button', { name: 'Envoyer' })
    await user.type(input, ' encore')
    await user.click(suggestion)
    await user.click(send)

    expect(onChange).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(input.getAttribute('aria-describedby')).toBe(error.id)
  })
})
