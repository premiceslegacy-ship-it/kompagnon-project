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
})
