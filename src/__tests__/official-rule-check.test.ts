import { describe, expect, it, vi } from 'vitest'
import {
  OFFICIAL_SOURCE_GROUPS_FR,
  figuresDisagree,
  formatOfficialRuleCheckForTool,
  hostMatches,
  normalizeFigures,
  officialCitations,
  parseFinding,
  verifyOfficialRule,
  type ModelCall,
} from '@/lib/ai/official-rule-check'

const cite = (url: string, title = 'page') => ({ type: 'url_citation', url_citation: { url, title } })
const finding = (answer: string, figures: string[]) =>
  JSON.stringify({ found: true, answer, figures, conditions: ['logement de plus de 2 ans'], effective_from: null })

// Un faux modèle: la 1re recherche vise la famille « droit », la 2e « administration », la 3e compare.
function fakeModel(replies: Array<{ content: string; annotations?: unknown[] } | Error>): ModelCall {
  const queue = [...replies]
  return vi.fn(async () => {
    const next = queue.shift()
    if (!next) throw new Error('appel inattendu')
    if (next instanceof Error) throw next
    return { content: next.content, annotations: next.annotations ?? [] }
  })
}

const Q = { question: 'Taux de TVA pour le remplacement d\'un chauffe-eau chez un particulier ?', today: '2026-11-11', isFrance: true }

describe('contrôle de l\'origine des sources', () => {
  it('accepte les domaines officiels et leurs sous-domaines, refuse les imitations', () => {
    const d = OFFICIAL_SOURCE_GROUPS_FR.administration
    expect(hostMatches('https://www.service-public.fr/particuliers/vosdroits/F1', d)).toBe(true)
    expect(hostMatches('https://entreprendre.service-public.fr/vosdroits/F23570', d)).toBe(true)
    expect(hostMatches('https://evilservice-public.fr/x', d)).toBe(false)
    expect(hostMatches('https://service-public.fr.evil.com/x', d)).toBe(false)
    expect(hostMatches('pas une url', d)).toBe(false)
  })

  it('ne garde que les citations officielles, sans doublon', () => {
    const sources = officialCitations(
      [cite('https://www.impots.gouv.fr/a', 'A'), cite('https://blog-artisan.fr/tva'), cite('https://www.impots.gouv.fr/a', 'A'), cite('https://bofip.impots.gouv.fr/b', 'B')],
      OFFICIAL_SOURCE_GROUPS_FR.droit,
    )
    expect(sources.map((s) => s.host)).toEqual(['impots.gouv.fr', 'bofip.impots.gouv.fr'])
  })
})

describe('comparaison des chiffres par code', () => {
  it('reconnaît le même taux écrit de façons différentes', () => {
    expect(normalizeFigures(['5,5 %', '5.5%'])).toEqual(['5.5%'])
    expect(normalizeFigures(['10 %', 'taux réduit de 5,5 %'])).toEqual(['10%', '5.5%'])
  })

  it('ne confond pas un taux voisin cité sur la page avec le taux retenu', () => {
    const a = parseFinding('droit', finding('Taux de 10 %.', ['10 %']), [cite('https://bofip.impots.gouv.fr/x')])
    const b = parseFinding('administration', finding('Taux de 10 %, contre 5,5 % pour un appareil thermodynamique.', ['5,5 %', '10 %', '20 %']), [cite('https://www.economie.gouv.fr/y')])
    expect(figuresDisagree(a, b)).toBe(false)
  })

  it('signale deux familles de sources qui donnent des taux différents', () => {
    const a = parseFinding('droit', finding('Taux de 10 %.', ['10 %']), [cite('https://bofip.impots.gouv.fr/x')])
    const b = parseFinding('administration', finding('Taux de 5,5 %.', ['5,5 %']), [cite('https://www.service-public.fr/y')])
    expect(figuresDisagree(a, b)).toBe(true)
  })

  it('ne marque pas « trouvé » une réponse sans source officielle citée', () => {
    const f = parseFinding('droit', finding('Taux de 10 %.', ['10 %']), [cite('https://blog-artisan.fr/tva')])
    expect(f.found).toBe(false)
  })
})

describe('verifyOfficialRule', () => {
  const official = [
    { content: finding('Taux réduit de 10 %.', ['10 %']), annotations: [cite('https://bofip.impots.gouv.fr/a', 'BOFiP')] },
    { content: finding('Le taux est de 10 %.', ['10,0 %']), annotations: [cite('https://www.service-public.fr/b', 'Service-Public')] },
  ]

  it('confirme quand deux familles officielles concordent et que le comparateur valide', async () => {
    const callModel = fakeModel([...official, { content: JSON.stringify({ agree: true, differences: [], merged_answer: 'Taux réduit de 10 %.' }) }])
    const check = await verifyOfficialRule({ ...Q, callModel })
    expect(check.status).toBe('confirmed')
    expect(check.answer).toBe('Taux réduit de 10 %.')
    expect(check.sources.map((s) => s.host)).toEqual(['bofip.impots.gouv.fr', 'service-public.fr'])
    expect(formatOfficialRuleCheckForTool(check)).toContain('RÈGLE CONFIRMÉE')
  })

  it('refuse de trancher quand les chiffres diffèrent, sans même appeler le comparateur', async () => {
    const callModel = fakeModel([
      official[0],
      { content: finding('Le taux est de 5,5 %.', ['5,5 %']), annotations: [cite('https://www.service-public.fr/b')] },
    ])
    const check = await verifyOfficialRule({ ...Q, callModel })
    expect(check.status).toBe('conflict')
    expect(check.answer).toBeNull()
    expect(callModel).toHaveBeenCalledTimes(2)
    expect(formatOfficialRuleCheckForTool(check)).toContain('SOURCES QUI DIVERGENT')
  })

  it('refuse de trancher quand le comparateur voit un écart de conditions', async () => {
    const callModel = fakeModel([...official, { content: JSON.stringify({ agree: false, differences: ['période différente'], merged_answer: '' }) }])
    const check = await verifyOfficialRule({ ...Q, callModel })
    expect(check.status).toBe('conflict')
    expect(check.differences).toEqual(['période différente'])
  })

  it('reste « non confirmé » si une seule famille répond', async () => {
    const callModel = fakeModel([official[0], { content: JSON.stringify({ found: false, answer: '', figures: [] }), annotations: [] }])
    const check = await verifyOfficialRule({ ...Q, callModel })
    expect(check.status).toBe('insufficient')
    expect(check.answer).toBeNull()
    expect(formatOfficialRuleCheckForTool(check)).toContain('RÈGLE NON CONFIRMÉE')
  })

  it('reste « non confirmé » si les sources citées ne sont pas officielles', async () => {
    const callModel = fakeModel([
      { content: finding('Taux de 10 %.', ['10 %']), annotations: [cite('https://blog-artisan.fr/tva')] },
      { content: finding('Taux de 10 %.', ['10 %']), annotations: [cite('https://forum-btp.fr/tva')] },
    ])
    expect((await verifyOfficialRule({ ...Q, callModel })).status).toBe('insufficient')
  })

  it('reste « non confirmé » si la recherche tombe en panne', async () => {
    const callModel = fakeModel([new Error('timeout'), new Error('timeout')])
    expect((await verifyOfficialRule({ ...Q, callModel })).status).toBe('insufficient')
  })

  it('ne cherche rien pour une entreprise hors de France', async () => {
    const callModel = fakeModel([])
    const check = await verifyOfficialRule({ ...Q, isFrance: false, callModel })
    expect(check.status).toBe('unsupported_country')
    expect(callModel).not.toHaveBeenCalled()
    expect(formatOfficialRuleCheckForTool(check)).toContain('VÉRIFICATION IMPOSSIBLE')
  })
})
