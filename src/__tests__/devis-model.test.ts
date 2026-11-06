import { describe, expect, it } from 'vitest'
import { clampValidity, clausePayload, clausePreview, clauseFormValid, gridDetails, gridPriceLabel, parseGridCsv, sortClauses, upsertClause } from '@/app/(app)/settings/devisModel'
import type { QuoteClauseTemplate } from '@/lib/data/queries/clause-templates'

const clause = (id: string, category: string | null, position: number): QuoteClauseTemplate => ({
  id, organization_id: 'o', title: id, body: 'texte', category, position, is_active: true, created_at: '', updated_at: '',
})

describe('devis : validité', () => {
  it('borne la validité entre 1 et 365 jours et retombe sur 30', () => {
    expect(clampValidity(45)).toBe(45)
    expect(clampValidity(0)).toBe(30)
    expect(clampValidity(null)).toBe(30)
    expect(clampValidity(NaN)).toBe(30)
    expect(clampValidity(900)).toBe(365)
    expect(clampValidity(-4)).toBe(1)
  })
})

describe('devis : clauses', () => {
  it('exige un titre et un contenu, et range une catégorie vide à null', () => {
    expect(clauseFormValid({ title: ' ', body: 'x', category: '', position: 0 })).toBe(false)
    expect(clauseFormValid({ title: 'A', body: 'x', category: '', position: 0 })).toBe(true)
    expect(clausePayload({ title: 'A', body: 'x', category: '  ', position: 2 }).category).toBeNull()
  })

  it('trie par catégorie puis position et remplace une clause existante', () => {
    const sorted = sortClauses([clause('b', 'Paiement', 1), clause('a', 'Délai', 2), clause('c', 'Délai', 0), clause('d', null, 0)])
    expect(sorted.map(c => c.id)).toEqual(['c', 'a', 'd', 'b'])
    const updated = upsertClause(sorted, { ...clause('a', 'Délai', 2), title: 'Nouveau' })
    expect(updated).toHaveLength(4)
    expect(updated.find(c => c.id === 'a')?.title).toBe('Nouveau')
    expect(upsertClause(sorted, clause('z', null, 9))).toHaveLength(5)
  })

  it('résume le contenu sur une ligne', () => {
    expect(clausePreview('a\n\n b   c')).toBe('a b c')
    expect(clausePreview('x'.repeat(200), 20)).toHaveLength(20)
  })
})

describe('devis : grilles de prix', () => {
  it('lit un CSV avec « ; » ou « , » et reconnaît les noms français', () => {
    const csv = 'Libellé;Métal;Source;Coefficient;Prix fixe;Unité;Nuance;Épaisseur;Format\nAlu 2mm;aluminium;lme;1,35;;kg;5754;2;1000x2000\nAcier S235;acier;fixe;;0.95;kg;S235;;'
    const { valid, errors } = parseGridCsv(csv)
    expect(errors).toEqual([])
    expect(valid[0]).toMatchObject({ label: 'Alu 2mm', metal_code: 'ALU', source_type: 'lme', grade: '5754', thickness_mm: 2 })
    expect(valid[1]).toMatchObject({ metal_code: 'STEEL', source_type: 'manual', manual_price_eur_kg: 0.95 })
  })

  it('signale les lignes impossibles avec leur numéro', () => {
    const csv = 'a;b\nAcier;acier;lme;1;;kg\nCuivre;cuivre;manuel;;;kg'
    const { valid, errors } = parseGridCsv(csv)
    expect(valid).toHaveLength(0)
    expect(errors[0]).toContain('Ligne 2')
    expect(errors[1]).toContain('prix fixe requis')
    expect(parseGridCsv('seulement un titre').errors[0]).toContain('vide')
  })

  it('formate le prix et les précisions d’une grille', () => {
    expect(gridPriceLabel({ source_type: 'manual', manual_price_eur_kg: 0.95, coefficient: 1, unit: 'kg' })).toMatch(/^0,95 € \/ kg$/)
    expect(gridPriceLabel({ source_type: 'lme', manual_price_eur_kg: null, coefficient: 1.35, unit: 'm²' })).toMatch(/^Cours × 1,35 \/ m²$/)
    expect(gridDetails({ grade: 'S235', thickness_mm: 2, format_label: null })).toEqual(['S235', '2 mm'])
  })
})
