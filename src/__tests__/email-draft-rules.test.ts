import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EMAIL_DRAFT_NO_INVENTION_RULE } from '@/lib/ai/email-draft-rules'

describe("brouillon d'e-mail client", () => {
  it("interdit au modèle d'inventer chiffres, dates et règles", () => {
    expect(EMAIL_DRAFT_NO_INVENTION_RULE).toMatch(/N'invente JAMAIS/)
    expect(EMAIL_DRAFT_NO_INVENTION_RULE).toMatch(/taux/)
    expect(EMAIL_DRAFT_NO_INVENTION_RULE).toMatch(/crochets/)
  })

  it('est bien injectée dans le prompt système de la route', () => {
    const route = readFileSync(join(process.cwd(), 'src/app/api/ai/email-draft/route.ts'), 'utf8')
    expect(route).toContain('${EMAIL_DRAFT_NO_INVENTION_RULE}')
  })
})
