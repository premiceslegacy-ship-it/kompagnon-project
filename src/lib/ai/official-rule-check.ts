// Vérification d'une règle fiscale, sociale ou légale française sur des sources
// officielles, recoupées entre deux familles de sites indépendantes. Objectif :
// qu'une assistante ne donne pas de mémoire un taux ou une condition que
// l'artisan va répercuter sur un devis. Le modèle ne décide jamais seul du statut :
// les sources citées sont filtrées par code sur une liste blanche de domaines.

export const OFFICIAL_SOURCE_GROUPS_FR = {
  droit: ['legifrance.gouv.fr', 'bofip.impots.gouv.fr', 'impots.gouv.fr'],
  administration: ['service-public.fr', 'entreprendre.service-public.fr', 'economie.gouv.fr', 'urssaf.fr'],
} as const

export type SourceGroup = keyof typeof OFFICIAL_SOURCE_GROUPS_FR
export type RuleCheckStatus = 'confirmed' | 'conflict' | 'insufficient' | 'unsupported_country'

export type OfficialSource = { url: string; title: string; host: string }

export type GroupFinding = {
  group: SourceGroup
  found: boolean
  answer: string
  figures: string[]
  conditions: string[]
  effectiveFrom: string | null
  sources: OfficialSource[]
}

export type OfficialRuleCheck = {
  status: RuleCheckStatus
  answer: string | null
  figures: string[]
  conditions: string[]
  sources: OfficialSource[]
  differences: string[]
  findings: GroupFinding[]
}

export type ModelCall = (args: {
  messages: Array<{ role: 'system' | 'user'; content: string }>
  plugins?: Array<Record<string, unknown>>
  maxTokens: number
}) => Promise<{ content: string; annotations: unknown[] }>

const VERIFIER_MODEL = 'google/gemini-2.5-flash'

export function hostMatches(url: string, domains: readonly string[]): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

export function officialCitations(annotations: unknown[], domains: readonly string[]): OfficialSource[] {
  const seen = new Set<string>()
  const sources: OfficialSource[] = []
  for (const annotation of annotations ?? []) {
    const citation = (annotation as { url_citation?: { url?: unknown; title?: unknown } } | null)?.url_citation
    const url = typeof citation?.url === 'string' ? citation.url : null
    if (!url || seen.has(url) || !hostMatches(url, domains)) continue
    seen.add(url)
    sources.push({
      url,
      title: typeof citation?.title === 'string' ? citation.title : '',
      host: new URL(url).hostname.replace(/^www\./, ''),
    })
  }
  return sources
}

// Les chiffres sont comparés par code, pas par le modèle : "5,5 %" et "5.5%" sont le même taux.
export function normalizeFigures(values: string[]): string[] {
  const out = new Set<string>()
  for (const value of values) {
    for (const match of value.matchAll(/(\d+(?:[.,]\d+)?)\s?%/g)) {
      out.add(`${Number(match[1].replace(',', '.'))}%`)
    }
  }
  return [...out].sort()
}

function extractJsonObject(content: string): Record<string, unknown> | null {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(content.slice(start, end + 1))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function stringList(value: unknown, max: number): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').slice(0, max) : []
}

export function parseFinding(group: SourceGroup, content: string, annotations: unknown[]): GroupFinding {
  const json = extractJsonObject(content)
  const sources = officialCitations(annotations, OFFICIAL_SOURCE_GROUPS_FR[group])
  const answer = typeof json?.answer === 'string' ? json.answer.trim() : ''
  return {
    group,
    // Pas de source officielle citée de ce groupe = rien de vérifié, quoi que dise le modèle.
    found: json?.found === true && answer !== '' && sources.length > 0,
    answer,
    figures: stringList(json?.figures, 8),
    conditions: stringList(json?.conditions, 5),
    effectiveFrom: typeof json?.effective_from === 'string' ? json.effective_from : null,
    sources,
  }
}

// Taux retenus par chaque famille pour le cas posé: ceux de la réponse elle-même
// (la liste « figures » mélange souvent le cas posé et des cas voisins mentionnés
// sur la page). Désaccord = aucun taux en commun; les nuances de conditions sont
// jugées ensuite par le comparateur.
function claimedRates(f: GroupFinding): string[] {
  const fromAnswer = normalizeFigures([f.answer])
  return fromAnswer.length > 0 ? fromAnswer : normalizeFigures(f.figures)
}

export function figuresDisagree(a: GroupFinding, b: GroupFinding): boolean {
  const fa = claimedRates(a)
  const fb = claimedRates(b)
  if (fa.length === 0 || fb.length === 0) return false
  return !fa.some((rate) => fb.includes(rate))
}

function emptyCheck(status: RuleCheckStatus, findings: GroupFinding[] = [], differences: string[] = []): OfficialRuleCheck {
  return { status, answer: null, figures: [], conditions: [], sources: [], differences, findings }
}

const SEARCH_SYSTEM = (today: string) => `Tu es un vérificateur de règles françaises (fiscalité, TVA, social, assurances, construction). Nous sommes le ${today}.
Tu disposes UNIQUEMENT des pages officielles fournies par la recherche. N'utilise jamais ta mémoire pour compléter.
Réponds en JSON strict, sans texte autour :
{"found": boolean, "answer": "2 phrases maximum", "figures": ["chaque taux, seuil ou montant tel qu'il figure sur la page, ex: 5,5 %"], "conditions": ["conditions d'application, 5 maximum"], "effective_from": "date d'application ou null"}
Règles : si les pages ne répondent pas clairement à la question, found=false. Vérifie que la règle est en vigueur à la date du jour, sans mélanger des règles de dates différentes. Ne cite aucune nuance absente des pages.`

const COMPARE_SYSTEM = `Tu compares deux réponses sur une règle française, issues de deux familles de sources officielles. Réponds en JSON strict :
{"agree": boolean, "differences": ["écarts réels"], "merged_answer": "réponse commune en 2 phrases maximum"}
agree=true seulement si les deux retiennent le même taux ou la même règle pour le cas posé, avec les mêmes conditions principales et la même période. Si l'une retient un taux que l'autre n'applique pas à ce cas, ou si une condition essentielle manque d'un côté, agree=false. Mentionner un taux voisin pour un autre cas n'est pas un écart. Une simple différence de formulation n'est pas un écart.`

export async function verifyOfficialRule(params: {
  question: string
  today: string
  isFrance: boolean
  callModel: ModelCall
}): Promise<OfficialRuleCheck> {
  if (!params.isFrance) return emptyCheck('unsupported_country')
  const question = params.question.trim().slice(0, 600)
  if (!question) return emptyCheck('insufficient')

  const groups = Object.keys(OFFICIAL_SOURCE_GROUPS_FR) as SourceGroup[]
  const findings = await Promise.all(
    groups.map(async (group) => {
      try {
        const domains = OFFICIAL_SOURCE_GROUPS_FR[group]
        const reply = await params.callModel({
          messages: [
            { role: 'system', content: SEARCH_SYSTEM(params.today) },
            { role: 'user', content: question },
          ],
          plugins: [{
            id: 'web',
            engine: 'exa',
            max_results: 5,
            include_domains: [...domains, ...domains.map((d) => `*.${d}`)],
          }],
          maxTokens: 700,
        })
        return parseFinding(group, reply.content, reply.annotations)
      } catch {
        return parseFinding(group, '', [])
      }
    }),
  )

  const verified = findings.filter((f) => f.found)
  if (verified.length < 2) return emptyCheck('insufficient', findings)

  const [a, b] = verified
  if (figuresDisagree(a, b)) {
    return emptyCheck('conflict', findings, [
      `Les taux retenus diffèrent : ${claimedRates(a).join(', ')} d'un côté, ${claimedRates(b).join(', ')} de l'autre.`,
    ])
  }

  let comparison: Record<string, unknown> | null = null
  try {
    const reply = await params.callModel({
      messages: [
        { role: 'system', content: COMPARE_SYSTEM },
        { role: 'user', content: `Question : ${question}\n\nRéponse A (${a.group}) : ${a.answer}\nConditions A : ${a.conditions.join(' ; ') || 'aucune'}\n\nRéponse B (${b.group}) : ${b.answer}\nConditions B : ${b.conditions.join(' ; ') || 'aucune'}` },
      ],
      maxTokens: 500,
    })
    comparison = extractJsonObject(reply.content)
  } catch {
    comparison = null
  }

  if (!comparison) return emptyCheck('insufficient', findings)
  if (comparison.agree !== true) {
    return emptyCheck('conflict', findings, stringList(comparison.differences, 4))
  }

  const sources = [...a.sources.slice(0, 2), ...b.sources.slice(0, 2)]
  return {
    status: 'confirmed',
    answer: typeof comparison.merged_answer === 'string' && comparison.merged_answer.trim() ? comparison.merged_answer.trim() : a.answer,
    figures: [...new Set([...a.figures, ...b.figures])].slice(0, 8),
    conditions: [...new Set([...a.conditions, ...b.conditions])].slice(0, 6),
    sources,
    differences: [],
    findings,
  }
}

// Ce que l'outil renvoie à l'assistante : un statut sans ambiguïté et la façon d'en parler.
export function formatOfficialRuleCheckForTool(check: OfficialRuleCheck): string {
  if (check.status === 'unsupported_country') {
    return 'VÉRIFICATION IMPOSSIBLE : aucune source officielle configurée pour le pays de cette entreprise. Dis franchement que tu ne peux pas vérifier cette règle et renvoie vers un expert local. N\'énonce aucun taux de mémoire.'
  }
  if (check.status === 'confirmed') {
    return [
      'RÈGLE CONFIRMÉE par deux familles de sources officielles qui concordent.',
      `Réponse : ${check.answer}`,
      check.figures.length ? `Chiffres : ${check.figures.join(' ; ')}` : '',
      check.conditions.length ? `Conditions : ${check.conditions.join(' ; ')}` : '',
      `Sources : ${check.sources.map((s) => `${s.host}${s.title ? ` (${s.title})` : ''}`).join(' ; ')}`,
      'Consigne : tu peux l\'affirmer, avec les conditions ci-dessus et rien d\'autre. Cite deux sources en une demi-phrase (ex. « confirmé sur service-public.fr et bofip »). N\'ajoute aucune nuance qui ne figure pas ici.',
    ].filter(Boolean).join('\n')
  }
  const found = check.findings
    .filter((f) => f.found)
    .map((f) => `- ${f.group} : ${f.answer} (${f.sources.map((s) => s.host).join(', ')})`)
    .join('\n')
  if (check.status === 'conflict') {
    return [
      'SOURCES QUI DIVERGENT : impossible de te prononcer.',
      ...check.differences.map((d) => `Écart : ${d}`),
      found,
      'Consigne : dis simplement que les sources officielles ne disent pas exactement la même chose. Tu peux dire ce sur quoi elles s\'accordent, mais n\'emploie aucune formule de certitude (« c\'est sûr », « aucun doute »), ne tranche pas le point qui diverge, et renvoie vers l\'expert-comptable.',
    ].filter(Boolean).join('\n')
  }
  return [
    'RÈGLE NON CONFIRMÉE : les sources officielles consultées n\'ont pas permis de vérifier.',
    found ? `Ce qu\'une seule famille de sources indique, à ne pas présenter comme sûr :\n${found}` : '',
    'Consigne : dis honnêtement que tu n\'as pas pu confirmer, ne donne pas de taux ou de condition de mémoire, et renvoie vers l\'expert-comptable ou service-public.fr.',
  ].filter(Boolean).join('\n')
}
