import { describe, expect, it } from 'vitest'
import { decennaleStatus, firstOrgError, summarizeLabels, tabOfOrgField, vatRateLabel } from '@/app/(app)/settings/entrepriseModel'

const day = 86_400_000
const now = new Date('2026-06-01T00:00:00Z').getTime()

describe('entreprise : erreurs de champs', () => {
  it('range chaque champ sur son écran', () => {
    expect(tabOfOrgField('siret')).toBe('entreprise')
    expect(tabOfOrgField('iban')).toBe('paiement')
    expect(tabOfOrgField('default_vat_rate')).toBe('paiement')
    expect(tabOfOrgField('inconnu')).toBeNull()
  })

  it('trouve le premier champ en erreur et son écran', () => {
    expect(firstOrgError({})).toBeNull()
    expect(firstOrgError({ iban: 'x', name: 'y' })).toEqual({ field: 'iban', tab: 'paiement' })
  })
})

describe('entreprise : décennale', () => {
  it('ne dit rien sans date', () => {
    expect(decennaleStatus('', now)).toBeNull()
    expect(decennaleStatus('pas une date', now)).toBeNull()
  })

  it('signale une assurance expirée, bientôt échue, puis valide', () => {
    expect(decennaleStatus(new Date(now - 3 * day).toISOString().slice(0, 10), now)).toMatchObject({ tone: 'danger' })
    const soon = decennaleStatus(new Date(now + 30 * day).toISOString().slice(0, 10), now)
    expect(soon?.tone).toBe('warn')
    expect(soon?.text).toMatch(/^Expire dans 30 jours/)
    expect(decennaleStatus(new Date(now + 200 * day).toISOString().slice(0, 10), now)?.tone).toBe('ok')
  })

  it('accorde les jours au singulier', () => {
    const one = decennaleStatus(new Date(now + day).toISOString().slice(0, 10), now)
    expect(one?.text).toMatch(/^Expire dans 1 jour,/)
  })
})

describe('entreprise : libellés', () => {
  it('nomme les taux de TVA', () => {
    expect(vatRateLabel(20)).toContain('normal')
    expect(vatRateLabel(5.5)).toContain('5,5')
    expect(vatRateLabel(0)).toContain('exonéré')
  })

  it('résume une liste d’activités', () => {
    expect(summarizeLabels([], 'Aucune')).toBe('Aucune')
    expect(summarizeLabels(['Plomberie', 'Électricité'], 'Aucune')).toBe('Plomberie, Électricité')
    expect(summarizeLabels(['A', 'B', 'C'], 'Aucune')).toBe('A, B et 1 autre')
    expect(summarizeLabels(['A', 'B', 'C', 'D'], 'Aucune')).toBe('A, B et 2 autres')
  })
})
