import { describe, expect, it } from 'vitest'
import { errorReference, supportHref } from '@/lib/error-pages'

describe('error-pages', () => {
  it("ne propose pas de contact tant qu'aucune adresse n'est configurée", () => {
    expect(supportHref(undefined)).toBeNull()
    expect(supportHref('  ')).toBeNull()
  })

  it('prépare un email au support avec un objet encodé', () => {
    expect(supportHref('aide@orsayn.fr')).toBe('mailto:aide@orsayn.fr?subject=Un%20probl%C3%A8me%20dans%20Atelier')
    expect(supportHref('aide@orsayn.fr', 'Réf. 12')).toContain('subject=R%C3%A9f.%2012')
  })

  it("met l'empreinte de l'erreur en forme lisible", () => {
    expect(errorReference(undefined)).toBeNull()
    expect(errorReference('')).toBeNull()
    expect(errorReference('3194738')).toBe('3194738')
    expect(errorReference('7f3a91c2b0')).toBe('7f3a-91c2')
  })
})
