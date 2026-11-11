import { describe, expect, it } from 'vitest'
import {
  formatEnvironmentForPrompt,
  normalizeCountry,
  type EnvironmentContext,
} from '@/lib/ai/environment-context'

const base: EnvironmentContext = {
  country: 'France',
  currency: 'EUR',
  city: 'Lyon',
  postalCode: '69003',
  legalForm: 'SASU',
  nafCode: '4332A',
  isVatSubject: true,
  defaultVatRate: 20,
  decennaleEnabled: true,
  decennaleEndDate: '2027-03-01',
  certifications: ['RGE', 'Qualibat'],
}
const single = { activityLabel: 'Menuiserie', secondaryActivityLabels: [] }
const multi = { activityLabel: 'Menuiserie', secondaryActivityLabels: ['Plomberie', 'Peinture'] }
const TODAY = '2026-11-11'

describe('contexte d\'environnement de l\'assistante', () => {
  it('décrit le pays, la localisation, la TVA, la décennale et les certifications', () => {
    const text = formatEnvironmentForPrompt(base, single, TODAY)
    expect(text).toContain('Pays : France.')
    expect(text).toContain('Localisation : Lyon (69).')
    expect(text).toContain('Devise : EUR.')
    expect(text).toContain('Forme juridique : SASU.')
    expect(text).toContain('assujettie, taux par défaut 20 %')
    expect(text).toContain("valable jusqu'au 2027-03-01")
    expect(text).toContain('Certifications : RGE, Qualibat.')
  })

  it('suppose la France quand le pays est absent, et le dit', () => {
    const text = formatEnvironmentForPrompt({ ...base, country: null }, single, TODAY)
    expect(text).toContain('France (non renseigné, supposé)')
    expect(normalizeCountry('FR').isFrance).toBe(true)
  })

  it("n'applique pas le droit français à une entreprise d'un autre pays", () => {
    const text = formatEnvironmentForPrompt({ ...base, country: 'Belgique', postalCode: '1000' }, single, TODAY)
    expect(text).toContain('Pays : Belgique.')
    expect(text).toContain("N'applique pas le droit ni la fiscalité français")
    expect(text).not.toContain('Localisation : Lyon (')
  })

  it('interdit d\'ajouter de la TVA en franchise en base', () => {
    const text = formatEnvironmentForPrompt({ ...base, isVatSubject: false }, single, TODAY)
    expect(text).toContain('franchise en base')
    expect(text).toContain('Ne jamais ajouter de TVA')
  })

  it('reconnaît un département d\'outre-mer sur trois chiffres', () => {
    const text = formatEnvironmentForPrompt({ ...base, city: 'Fort-de-France', postalCode: '97200' }, single, TODAY)
    expect(text).toContain('Fort-de-France (972)')
  })

  it('traite chaque activité séparément pour une entreprise multiservices', () => {
    const text = formatEnvironmentForPrompt(base, multi, TODAY)
    expect(text).toContain('multiservices')
    expect(text).toContain('Plomberie, Peinture')
    expect(text).toContain('traite-les séparément')
    expect(text).toContain('pose une question courte')
    expect(text).toContain('répartis ta réponse par activité')
  })

  it("n'ajoute pas de bloc multiservices pour un seul métier", () => {
    expect(formatEnvironmentForPrompt(base, single, TODAY)).not.toContain('multiservices')
  })

  it('impose de reconnaître les limites de ses connaissances, dont les dates futures', () => {
    const text = formatEnvironmentForPrompt(base, single, TODAY)
    expect(text).toContain(`nous sommes le ${TODAY}`)
    expect(text).toContain('postérieure à aujourd\'hui')
    expect(text).toContain('ne peux pas savoir si la règle changera')
    expect(text).toContain('N\'invente jamais un taux')
    expect(text).toContain('verify_official_rule')
    expect(text).toContain('ne réponds jamais de mémoire')
    expect(text).toContain('tutoiement')
  })
})
