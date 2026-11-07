import { describe, expect, it } from 'vitest'
import { certificationsToArray, certificationsToText } from '@/lib/data/certifications'

describe('certifications (texte de l’écran ↔ tableau de la base)', () => {
  it('découpe une saisie sur virgule, point-virgule et retour à la ligne', () => {
    expect(certificationsToArray('RGE, Qualibat 7131 ; Qualipac\nQualiPV')).toEqual(['RGE', 'Qualibat 7131', 'Qualipac', 'QualiPV'])
  })
  it('renvoie null pour une saisie vide', () => {
    expect(certificationsToArray('')).toBeNull()
    expect(certificationsToArray('  , ; ')).toBeNull()
    expect(certificationsToArray(null)).toBeNull()
    expect(certificationsToArray(undefined)).toBeNull()
  })
  it('recompose le texte affiché à partir du tableau', () => {
    expect(certificationsToText(['RGE', 'Qualibat 7131'])).toBe('RGE, Qualibat 7131')
    expect(certificationsToText([])).toBeNull()
    expect(certificationsToText(null)).toBeNull()
    expect(certificationsToText('RGE')).toBe('RGE')
  })
})
