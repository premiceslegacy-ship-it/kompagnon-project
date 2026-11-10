import { describe, expect, it } from 'vitest'
import { clampValidity, clausePayload, clausePreview, clauseFormValid, parseGridCsv, sortClauses, upsertClause } from '@/app/(app)/settings/devisModel'
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
  it('importe les prix manuels avec leur unité et leur précision', () => {
    const csv = 'Libellé;Métal;Prix HT;Unité;Nuance;Épaisseur;Format\nAlu 2mm;aluminium;1,355;kg;5754;2;1000x2000\nAcier S235;acier;19.5;m²;S235;;'
    const { valid, errors } = parseGridCsv(csv)
    expect(errors).toEqual([])
    expect(valid).toEqual([
      { label: 'Alu 2mm', metal_code: 'ALU', manual_price_eur_kg: 1.355, unit: 'kg', grade: '5754', thickness_mm: 2, format_label: '1000x2000' },
      { label: 'Acier S235', metal_code: 'STEEL', manual_price_eur_kg: 19.5, unit: 'm²', grade: 'S235', thickness_mm: undefined, format_label: undefined },
    ])
  })

  it.each(['', '0', '-1', '12abc', 'Infinity', 'lme'])('refuse un prix manuel inutilisable (%s)', price => {
    const { valid, errors } = parseGridCsv(`Libellé;Métal;Prix HT;Unité\nAcier;acier;${price};kg`)
    expect(valid).toEqual([])
    expect(errors).toHaveLength(1)
  })

  it('refuse une unité inconnue au lieu de lui attribuer un prix au kg', () => {
    const { valid, errors } = parseGridCsv('Libellé;Métal;Prix HT;Unité\nAcier;acier;5;m³')
    expect(valid).toEqual([])
    expect(errors).toHaveLength(1)
  })
})
