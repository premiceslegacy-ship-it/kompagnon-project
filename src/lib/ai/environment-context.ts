import { createClient } from '@/lib/supabase/server'

// Ce que l'assistante doit savoir de l'entreprise au-delà de son métier : le pays
// (donc le droit et la fiscalité à appliquer), la TVA, la localisation, et surtout
// les limites de ses propres connaissances. Module séparé de business-context.ts :
// il ne dépend d'aucune table métier et se teste sans base.

export type EnvironmentContext = {
  country: string | null
  currency: string | null
  city: string | null
  postalCode: string | null
  legalForm: string | null
  nafCode: string | null
  isVatSubject: boolean | null
  defaultVatRate: number | null
  decennaleEnabled: boolean
  decennaleEndDate: string | null
  certifications: string[]
}

export type ActivitiesForPrompt = {
  activityLabel: string
  secondaryActivityLabels: string[]
}

const FRANCE_ALIASES = new Set(['fr', 'fra', 'france', 'république française', 'republique francaise'])

export function normalizeCountry(raw: string | null | undefined): { label: string; isFrance: boolean; assumed: boolean } {
  const value = (raw ?? '').trim()
  // Produit français : sans pays renseigné, on suppose la France, et on le dit.
  if (!value) return { label: 'France', isFrance: true, assumed: true }
  if (FRANCE_ALIASES.has(value.toLowerCase())) return { label: 'France', isFrance: true, assumed: false }
  return { label: value, isFrance: false, assumed: false }
}

function departmentFromPostalCode(postalCode: string | null): string | null {
  const code = (postalCode ?? '').trim()
  if (!/^\d{5}$/.test(code)) return null
  // Corse (20xxx) et outre-mer (97x/98x) : trois chiffres pour l'outre-mer, sinon deux.
  return code.startsWith('97') || code.startsWith('98') ? code.slice(0, 3) : code.slice(0, 2)
}

export async function getEnvironmentContext(orgId: string): Promise<EnvironmentContext> {
  const supabase = await createClient()
  const { data: org } = await supabase
    .from('organizations')
    .select('country, currency, city, postal_code, forme_juridique, naf_code, is_vat_subject, default_vat_rate, decennale_enabled, decennale_date_fin, certifications')
    .eq('id', orgId)
    .single()

  return {
    country: org?.country ?? null,
    currency: org?.currency ?? null,
    city: org?.city ?? null,
    postalCode: org?.postal_code ?? null,
    legalForm: org?.forme_juridique ?? null,
    nafCode: org?.naf_code ?? null,
    isVatSubject: org?.is_vat_subject ?? null,
    defaultVatRate: org?.default_vat_rate ?? null,
    decennaleEnabled: org?.decennale_enabled ?? false,
    decennaleEndDate: org?.decennale_date_fin ?? null,
    certifications: Array.isArray(org?.certifications) ? (org.certifications as string[]).filter(Boolean) : [],
  }
}

export function formatEnvironmentForPrompt(
  env: EnvironmentContext,
  activities: ActivitiesForPrompt,
  today: string,
): string {
  const country = normalizeCountry(env.country)
  const lines: string[] = ['Environnement de l\'entreprise :']

  lines.push(
    country.isFrance
      ? `- Pays : France${country.assumed ? ' (non renseigné, supposé)' : ''}. Raisonne avec le droit, la fiscalité (TVA, cotisations), les assurances et les normes françaises.`
      : `- Pays : ${country.label}. N'applique pas le droit ni la fiscalité français sans le signaler : donne la règle du pays si tu la connais, sinon dis que tu ne la connais pas.`,
  )

  const department = country.isFrance ? departmentFromPostalCode(env.postalCode) : null
  const place = [env.city?.trim(), department ? `(${department})` : null].filter(Boolean).join(' ')
  if (place) lines.push(`- Localisation : ${place}.`)
  if (env.currency) lines.push(`- Devise : ${env.currency}.`)
  if (env.legalForm?.trim()) lines.push(`- Forme juridique : ${env.legalForm.trim()}.`)
  if (env.nafCode?.trim()) lines.push(`- Code NAF : ${env.nafCode.trim()}.`)

  if (env.isVatSubject === false) {
    lines.push('- TVA : entreprise non assujettie (franchise en base). Ne jamais ajouter de TVA à un montant proposé.')
  } else if (env.isVatSubject === true) {
    lines.push(`- TVA : entreprise assujettie${env.defaultVatRate != null ? `, taux par défaut ${env.defaultVatRate} %` : ''}. Le taux réel dépend de la prestation : ne le devine pas, lis-le dans le devis ou le catalogue.`)
  }

  if (env.decennaleEnabled) {
    lines.push(`- Assurance décennale : activée${env.decennaleEndDate ? `, valable jusqu'au ${env.decennaleEndDate}` : ''}.`)
  }
  if (env.certifications.length > 0) lines.push(`- Certifications : ${env.certifications.join(', ')}.`)

  const secondary = activities.secondaryActivityLabels
  if (secondary.length > 0) {
    lines.push(
      '',
      `Cette entreprise est multiservices : métier principal « ${activities.activityLabel} », autres activités : ${secondary.join(', ')}.`,
      'Pour chaque question ou document, identifie de quelle activité il relève. Les règles (taux de TVA, normes, assurances, vocabulaire, prix habituels) peuvent différer d\'une activité à l\'autre : traite-les séparément quand une demande en mélange plusieurs. Pour une question générale dont la réponse dépend du métier (assurances, obligations, qualifications, normes, TVA), répartis ta réponse par activité dès que les règles diffèrent, au lieu de répondre seulement pour le métier principal. Si l\'activité visée n\'est pas claire, pose une question courte plutôt que de supposer le métier principal.',
    )
  }

  lines.push(
    '',
    `Limites de tes connaissances (obligatoire) : nous sommes le ${today}. Tes connaissances générales (lois, taux, barèmes, aides, normes) peuvent être en retard sur cette date.`,
    '- Pour une question de loi, de fiscalité ou de réglementation : donne la règle que tu connais en la présentant comme telle (« à ma connaissance », « aujourd\'hui »), et renvoie vers la source officielle (service-public.fr, impots.gouv.fr, l\'organisme concerné) ou l\'expert-comptable pour un cas précis.',
    '- Si la question porte sur une date postérieure à aujourd\'hui, dis clairement que tu ne peux pas savoir si la règle changera d\'ici là. Donne seulement la règle en vigueur que tu connais, comme règle actuelle, sans l\'affirmer pour cette date.',
    '- N\'invente jamais un taux, un montant, un seuil, une date ou un article de loi. Ne cite une exception ou une nuance fiscale que si tu en es sûre ; en cas de doute, dis-le.',
    '- Termine toute réponse de loi, de fiscalité ou de réglementation par une phrase courte invitant à vérifier la source officielle ou l\'expert-comptable.',
    '- Distingue ce que tu lis dans les données de l\'entreprise (fiable) de ce que tu sais en général (à vérifier).',
    '- Tu t\'adresses toujours à l\'utilisateur en le vouvoyant, y compris dans ces mises en garde.',
  )

  return lines.join('\n')
}
