import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import noHardcodedColors, { noHardcodedColorsCssProcessor } from '../../eslint/rules/no-hardcoded-colors.mjs'

function lint(source: string, filename = 'legacy.js') {
  const linter = new Linter()
  return linter.verify(source, [{
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { atelier: { rules: { 'no-hardcoded-colors': noHardcodedColors } } },
    rules: { 'atelier/no-hardcoded-colors': 'error' },
  }], { filename })
}

function lintCss(source: string, filename = 'src/components/ui/Card.module.css') {
  const linter = new Linter()
  const blocks = noHardcodedColorsCssProcessor.preprocess(source, filename)
  const messageLists = blocks.map((block, index) => linter.verify(block, [{
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  }], { filename: `${filename}/${index}.js` }))
  return noHardcodedColorsCssProcessor.postprocess(messageLists, filename)
}

describe('no-hardcoded-colors ESLint rule', () => {
  it('leaves non-migrated legacy JSX untouched', () => {
    const messages = lint('<div className="bg-red-500 text-white" />')

    expect(messages).toHaveLength(0)
  })

  it('protects UI components without requiring a migration marker', () => {
    const messages = lint(
      '<button className="bg-red-500" />',
      'src/components/ui/Button.js',
    )

    expect(messages.map(({ messageId }) => messageId)).toEqual(['hardcodedColor'])
    expect(lint(
      '<svg><path fill="rgb(var(--accent-primary))" stroke="currentColor" /></svg>',
      'src/components/ui/icons/Icon.js',
    )).toHaveLength(0)
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

  it('reports CSS module literals and fallbacks at their declaration locations', () => {
    const messages = lintCss(`
.card {
  color: var(--text-role, #fff);
  background: color-mix(in srgb, var(--accent-role), tomato);
  border-color: rgb(20 30 40);
  --surface-token: blue;
}
`)

    expect(messages.map(({ messageId, line, column }) => [messageId, line, column])).toEqual([
      ['hardcodedColor', 3, 3],
      ['hardcodedColor', 4, 3],
      ['hardcodedColor', 5, 3],
      ['hardcodedColor', 6, 3],
    ])
  })

  it('allows role-based blends and excludes comments, URL fragments, strings, and font names', () => {
    const messages = lintCss(`
.card {
  color: var(--text-role, currentColor);
  background: linear-gradient(90deg, var(--surface-role), color-mix(in srgb, var(--accent-role), transparent));
  outline-color: rgb(var(--accent-role-rgb) / 0.2);
  border-color: inherit;
  fill: url("#face");
  font-family: red;
  --font-family: red;
  content: "#fff tomato";
  /* color: red; background: #fff; */
}
`)

    expect(messages).toHaveLength(0)
  })

  it('keeps the UI and migration-marker boundary for CSS modules', () => {
    expect(lintCss(
      '.card { color: #fff; }',
      'src/components/marketing/Card.module.css',
    )).toHaveLength(0)
    expect(lintCss(
      '/* @atelier-migrated */ .card { color: #fff; }',
      'src/components/marketing/Card.module.css',
    ).map(({ messageId }) => messageId)).toEqual(['hardcodedColor'])
  })
})
