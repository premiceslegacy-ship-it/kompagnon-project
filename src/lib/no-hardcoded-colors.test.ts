import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import noHardcodedColors from '../../eslint/rules/no-hardcoded-colors.mjs'

function lint(source: string) {
  const linter = new Linter()
  return linter.verify(source, [{
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { atelier: { rules: { 'no-hardcoded-colors': noHardcodedColors } } },
    rules: { 'atelier/no-hardcoded-colors': 'error' },
  }])
}

describe('no-hardcoded-colors ESLint rule', () => {
  it('leaves non-migrated legacy JSX untouched', () => {
    const messages = lint('<div className="bg-red-500 text-white" />')

    expect(messages).toHaveLength(0)
  })

  it('reports palette classes, named CSS colors, and literal values in migrated JSX', () => {
    const messages = lint(`
      /* @atelier-migrated */
      const View = ({ active }) => <>
        <div className={active ? 'bg-red-500' : 'bg-carte'} />
        <div className="text-[tomato]" />
        <div style={{ color: '#ff0000' }} />
      </>
    `)

    expect(messages.map(({ messageId }) => messageId)).toEqual([
      'hardcodedColor',
      'hardcodedColor',
      'hardcodedColor',
    ])
  })

  it('rejects shared constant classes and literal SVG paint without confusing fragment references with colors', () => {
    const messages = lint(`
      /* @atelier-migrated */
      const sharedClass = 'bg-red-500'
      const View = () => <>
        <div className={sharedClass} />
        <svg><path fill="#ff0000" /><path fill="url(#face)" stroke="currentColor" /></svg>
      </>
    `)

    expect(messages.map(({ messageId }) => messageId)).toEqual([
      'hardcodedColor',
      'hardcodedColor',
    ])
  })


  it('allows semantic color classes and token references', () => {
    const messages = lint(`
      /* @atelier-migrated */
      const View = () => <div
        className="bg-carte text-encre-2 border-trait hover:bg-accent/10"
        style={{ color: 'rgb(var(--at-accent-rgb) / 0.2)' }}
      />
    `)

    expect(messages).toHaveLength(0)
  })
})
