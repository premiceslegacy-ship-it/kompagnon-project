// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Field } from './Field'

afterEach(cleanup)

type Kind = 'text' | 'number' | 'select' | 'textarea'

function BlockedField({ kind, loading, onChange }: { kind: Kind; loading: boolean; onChange: () => void }) {
  const state = { disabled: !loading, loading, onChange, label: 'Valeur' }
  switch (kind) {
    case 'number': return <Field {...state} type="number" value={12} />
    case 'select': return <Field {...state} type="select" defaultValue="one"><option value="one">Premier</option><option value="two">Second</option></Field>
    case 'textarea': return <Field {...state} type="textarea" value="Initial" />
    default: return <Field {...state} type="text" value="Initial" />
  }
}

describe('Field', () => {
  it('updates its composed validation description without dropping caller context or focus', async () => {
    const user = userEvent.setup()
    const view = (error?: string) => <>
      <p id="caller-context">Contexte fourni.</p>
      <Field type="text" label="Référence" defaultValue="A" aria-describedby="caller-context" hint="Aide du champ." error={error} />
    </>
    const { rerender } = render(view('Valeur à corriger.'))
    const input = screen.getByRole('textbox', { name: 'Référence', description: 'Contexte fourni. Valeur à corriger. Aide du champ.' })
    expect(input.getAttribute('aria-invalid')).toBe('true')
    await user.click(input)

    rerender(view())
    expect(screen.getByRole('textbox', { name: 'Référence', description: 'Contexte fourni. Aide du champ.' })).toBe(input)
    expect(input.getAttribute('aria-invalid')).toBeNull()
    expect(document.activeElement).toBe(input)
  })

  it.each(['text', 'number', 'select', 'textarea'] as const)('blocks edits in the %s branch while disabled or loading', async (kind) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(<BlockedField kind={kind} loading={false} onChange={onChange} />)
    for (const loading of [false, true]) {
      rerender(<BlockedField kind={kind} loading={loading} onChange={onChange} />)
      const control = screen.getByLabelText('Valeur') as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      const initial = control.value
      if (kind === 'select') await user.selectOptions(control as HTMLSelectElement, 'two')
      else await user.type(control, '9')
      expect(control.value).toBe(initial)
      expect(onChange).not.toHaveBeenCalled()
    }
  })

  it('garde le contrôle natif des dates, heures, emails et téléphones', () => {
    render(
      <>
        <Field type="date" label="Date" defaultValue="2026-11-05" />
        <Field type="time" label="Heure de début" defaultValue="08:30" />
        <Field type="email" label="Email" defaultValue="jean@exemple.fr" />
        <Field type="tel" label="Téléphone" defaultValue="06 12 34 56 78" />
      </>,
    )
    expect((screen.getByLabelText('Date') as HTMLInputElement).type).toBe('date')
    expect((screen.getByLabelText('Heure de début') as HTMLInputElement).type).toBe('time')
    expect((screen.getByLabelText('Email') as HTMLInputElement).type).toBe('email')
    expect((screen.getByLabelText('Téléphone') as HTMLInputElement).type).toBe('tel')
  })
})
