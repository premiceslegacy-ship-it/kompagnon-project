import { describe, expect, it } from 'vitest'
import {
  buildAtelierSubscriptionEmail,
  buildAtelierTrialEndedEmail,
  buildAtelierTrialReminderEmail,
  buildAtelierTrialStartedEmail,
  buildQuotaAlertContent,
  formatTierLabel,
  type AtelierSubscriptionEmailKind,
} from '@/lib/email/commercial'
import { ATELIER_PRICING } from '@/lib/pricing'
import { CANCELLATION_NOTICE_DAYS, TRIAL_DURATION_DAYS } from '@/lib/subscription-terms'

process.env.NEXT_PUBLIC_APP_URL = 'https://app.atelier-btp.fr'

const APP = 'https://app.atelier-btp.fr'
// Mardi 13 octobre 2026, 14 h 30 à Paris (UTC+2).
const END = '2026-10-13T12:30:00.000Z'
const RENEWS = '2026-11-13T12:30:00.000Z'

const PRO_PRICE = `${ATELIER_PRICING.pro.amountEur} € HT/mois`
const EXPERT_PRICE = `${ATELIER_PRICING.expert.amountEur} € HT/mois`

/** Texte lisible d'un email : sans balises, entités décodées. */
function text(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ')
}

const subscriptionKinds: AtelierSubscriptionEmailKind[] = ['activated', 'payment_failed', 'payment_recovered', 'ended', 'cancellation_scheduled']

const lifecycle: Array<[string, { subject: string; html: string }]> = [
  ['essai : bienvenue', buildAtelierTrialStartedEmail({ appUrl: APP, companyName: 'Weber Tôlerie', trialEndsAt: END })],
  ['essai : rappel 4 jours', buildAtelierTrialReminderEmail({ appUrl: APP, daysLeft: 4, trialEndsAt: END })],
  ['essai : rappel 2 jours', buildAtelierTrialReminderEmail({ appUrl: APP, daysLeft: 2, trialEndsAt: END })],
  ['essai : rappel 1 jour', buildAtelierTrialReminderEmail({ appUrl: APP, daysLeft: 1, trialEndsAt: END })],
  ['essai : fin', buildAtelierTrialEndedEmail({ appUrl: APP })],
  ...subscriptionKinds.map((kind): [string, { subject: string; html: string }] => [
    `abonnement : ${kind}`,
    buildAtelierSubscriptionEmail({ kind, appUrl: APP, tier: 'pro', renewsAt: RENEWS, endsAt: RENEWS }),
  ]),
]

describe('copy des emails d’essai et d’abonnement : garde-fous', () => {
  it.each(lifecycle)('%s : une seule action, ton sobre, aucune pression', (_name, { subject, html }) => {
    const body = text(html)
    // Une seule action principale par email.
    expect(html.match(/role="button"/g)).toHaveLength(1)
    // Style : aucun emoji, aucun tiret cadratin (sujet compris).
    expect(`${subject}${body}`).not.toMatch(/\p{Extended_Pictographic}/u)
    expect(`${subject}${body}`).not.toContain('—')
    // Aucune urgence décorative, rareté inventée, peur ou honte.
    expect(`${subject} ${body}`).not.toMatch(/dernière chance|dépêchez|ne manquez pas|offre limitée|places? limitées?|n[’']attendez pas|avant qu[’']il ne soit trop tard|vous perdez|vous allez perdre/i)
    // Le lien d'action pointe vers l'application.
    expect(html).toContain(`href="${APP}/`)
  })
})

describe('essai : bienvenue', () => {
  const { subject, html } = buildAtelierTrialStartedEmail({ appUrl: APP, companyName: 'Weber Tôlerie', trialEndsAt: END })
  const body = text(html)

  it('annonce la durée, la formule et la vraie date de fin', () => {
    expect(subject).toContain(`${TRIAL_DURATION_DAYS} jours Pro`)
    expect(body).toContain('Fin de l')
    expect(body).toContain('mardi 13 octobre à 14 h 30')
  })

  it('rend la condition visible : aucune carte, rien prélevé, mise en pause', () => {
    expect(body).toContain('Aucune carte bancaire')
    expect(body).toContain('rien ne sera prélevé')
    expect(body).toContain('mis en pause')
  })

  it('reste valable sans date de fin connue', () => {
    expect(text(buildAtelierTrialStartedEmail({ appUrl: APP, companyName: 'X' }).html)).not.toContain('Fin de l')
  })
})

describe('essai : rappels', () => {
  it('à 3 jours ou plus : compare Pro et Expert avec les prix et limites du catalogue', () => {
    const body = text(buildAtelierTrialReminderEmail({ appUrl: APP, daysLeft: 4, trialEndsAt: END }).html)
    expect(body).toContain(`Pro, ${PRO_PRICE}`)
    expect(body).toContain(`Expert, ${EXPERT_PRICE}`)
    expect(body).toContain('120 échanges IA et 60 analyses de devis')
    expect(body).toContain('mardi 13 octobre à 14 h 30')
    expect(body).toContain('aucun prélèvement')
  })

  it('personnalise le conseil quand Expert était visé à l’inscription', () => {
    const expert = text(buildAtelierTrialReminderEmail({ appUrl: APP, daysLeft: 4, preferredTier: 'expert' }).html)
    const pro = text(buildAtelierTrialReminderEmail({ appUrl: APP, daysLeft: 4, preferredTier: 'pro' }).html)
    expect(expert).toContain('Vous aviez indiqué Expert')
    expect(pro).not.toContain('Vous aviez indiqué Expert')
  })

  it('à 2 jours ou moins : montre les conditions de paiement et de résiliation avant la décision', () => {
    const body = text(buildAtelierTrialReminderEmail({ appUrl: APP, daysLeft: 2, trialEndsAt: END }).html)
    expect(body).toContain(PRO_PRICE)
    expect(body).toContain(EXPERT_PRICE)
    expect(body).toContain('par Stripe')
    expect(body).toContain('chaque mois automatiquement')
    expect(body).toContain(`${CANCELLATION_NOTICE_DAYS} jours après la demande`)
    expect(body).toContain('aucun prélèvement ne sera effectué')
  })

  it('accorde le singulier et le pluriel dans le sujet et le titre', () => {
    const one = buildAtelierTrialReminderEmail({ appUrl: APP, daysLeft: 1 })
    expect(one.subject).toBe('Plus que 1 jour de Pro offert')
    expect(text(one.html)).toContain('dans 1 jour.')
    expect(buildAtelierTrialReminderEmail({ appUrl: APP, daysLeft: 4 }).subject).toBe('Plus que 4 jours de Pro offert')
  })
})

describe('essai : fin', () => {
  const body = text(buildAtelierTrialEndedEmail({ appUrl: APP }).html)

  it('dit l’état, rassure sur les données et laisse partir sans pénalité', () => {
    expect(body).toContain(`Vos ${TRIAL_DURATION_DAYS} jours Pro sont terminés`)
    expect(body).toContain('Aucun prélèvement n’a été effectué')
    expect(body).toContain('conservés')
    expect(body).toContain('exporter vos données')
    expect(body).toContain('sans rien payer')
  })

  it('nomme les deux formules avec leur prix', () => {
    expect(body).toContain(PRO_PRICE)
    expect(body).toContain(EXPERT_PRICE)
  })
})

describe('abonnement : paiement', () => {
  const mail = (kind: AtelierSubscriptionEmailKind, extra: Partial<Parameters<typeof buildAtelierSubscriptionEmail>[0]> = {}) =>
    buildAtelierSubscriptionEmail({ kind, appUrl: APP, tier: 'pro', renewsAt: RENEWS, endsAt: RENEWS, ...extra })

  it('activation : formule, montant, prochain prélèvement et gestion du paiement', () => {
    const { subject, html } = mail('activated')
    const body = text(html)
    expect(subject).toBe('Votre formule Pro est active')
    expect(body).toContain('Montant')
    expect(body).toContain(`${ATELIER_PRICING.pro.amountEur} € HT/mois`)
    expect(body).toContain('Prochain prélèvement')
    expect(body).toContain('13 novembre 2026')
    expect(body).toContain('mensuel et automatique par Stripe')
    expect(html).toContain(`${APP}/dashboard`)
  })

  it('activation Expert : le montant Expert, pas celui de Pro', () => {
    const body = text(mail('activated', { tier: 'expert' }).html)
    expect(body).toContain(`${ATELIER_PRICING.expert.amountEur} € HT/mois`)
    // « 169 € » contient « 69 € » : on cherche le montant Pro isolé.
    expect(body).not.toMatch(new RegExp(`(?<!\\d)${ATELIER_PRICING.pro.amountEur} € HT/mois`))
  })

  it('activation sans date de renouvellement connue : pas de ligne vide ni « undefined »', () => {
    const body = text(mail('activated', { renewsAt: null }).html)
    expect(body).not.toContain('Prochain prélèvement')
    expect(body).not.toContain('undefined')
  })

  it('paiement refusé : le bouton mène à la mise à jour du moyen de paiement', () => {
    const { subject, html } = mail('payment_failed')
    expect(subject).toBe('Votre paiement Atelier n’a pas abouti')
    expect(html).toContain(`${APP}/settings?tab=abonnement`)
    expect(text(html)).toContain('Mettre à jour mon moyen de paiement')
    expect(text(html)).toContain('Votre accès reste ouvert')
  })

  it('abonnement terminé : export possible et reprise, sans relance insistante', () => {
    const { html } = mail('ended')
    expect(html).toContain(`${APP}/activation`)
    expect(text(html)).toContain('exportables')
  })

  it('résiliation programmée : date de fin et arrêt des prélèvements', () => {
    const body = text(mail('cancellation_scheduled').html)
    expect(body).toContain('jusqu’au 13 novembre 2026')
    expect(body).toContain('les prélèvements s')
  })

  it('un palier inconnu n’invente pas de prix', () => {
    const body = text(mail('activated', { tier: 'setup_only' }).html)
    expect(body).not.toContain('Montant')
    expect(formatTierLabel('setup_only')).toBe('Atelier')
  })
})

describe('alerte d’usage : approche de la limite mensuelle', () => {
  it('annonce l’usage, le renouvellement et ce que change Expert, sans jargon technique', () => {
    const { subject, bodyLines, cta } = buildQuotaAlertContent({ featureLabel: 'Analyse devis', feature: 'quote_ai', pct: 0.86, tier: 'pro' })
    const body = bodyLines.join(' ')
    expect(subject).toBe('Vous approchez de votre limite mensuelle : Analyse devis')
    expect(body).toContain('86 %')
    expect(body).toContain('formule Pro')
    expect(body).toContain('1er du mois prochain')
    expect(body).toContain('la formule Expert retire cette limite')
    expect(body).toContain('Rien à faire si vous préférez attendre')
    expect(body).not.toMatch(/setup_only|\bpro\b(?! ?\))|\bexpert\b(?! ?\))/)
    expect(cta.path).toBe('/settings?tab=abonnement')
  })

  it('cite la vraie limite Expert quand elle n’est pas illimitée (vocal en direct)', () => {
    const { bodyLines } = buildQuotaAlertContent({ featureLabel: 'Vocal live Sarah', feature: 'voice_live_minutes', pct: 0.9, tier: 'pro' })
    expect(bodyLines.join(' ')).toContain('porte cette limite à 300 minutes par mois')
  })

  it('ne contient ni emoji ni tiret cadratin', () => {
    const { subject, bodyLines } = buildQuotaAlertContent({ featureLabel: 'Relances IA', feature: 'relances_ai', pct: 0.85, tier: 'pro' })
    expect(`${subject}${bodyLines.join(' ')}`).not.toMatch(/\p{Extended_Pictographic}|—/u)
  })
})
