import {
  atelierEmailBrand,
  escHtml,
  renderAlertBanner,
  renderCTA,
  renderEmailShell,
  renderInfoBox,
  renderTextBox,
} from './layout'
import { ATELIER_PRICING } from '@/lib/pricing'
import { QUOTAS_BY_TIER, QUOTA_DEFINITIONS, type QuotaFeature } from '@/lib/quota-catalog'
import { CANCELLATION_NOTICE_DAYS, TRIAL_DURATION_DAYS } from '@/lib/subscription-terms'

export type AtelierCommercialEmailInput = {
  subject: string
  eyebrow?: string
  title: string
  paragraphs: string[]
  cta?: { label: string; url: string }
  facts?: Array<{ label: string; value: string; large?: boolean }>
  notice?: { text: string; theme?: 'success' | 'info' }
  quote?: string
  /** Condition ou précision affichée sous le bouton : visible au moment de décider. */
  footnote?: string
}

/**
 * Single renderer for customer-facing Atelier lifecycle and commercial emails.
 * It deliberately keeps the content API small so new campaigns cannot fall
 * back to the old Arial-only HTML snippets.
 */
export function buildAtelierCommercialEmail(input: AtelierCommercialEmailInput): { subject: string; html: string } {
  const paragraphHtml = input.paragraphs
    .map((paragraph) => `<p style="margin:0 0 18px;color:#36332E;font-family:'Geist','Inter',Arial,sans-serif;font-size:15px;line-height:1.7;">${escHtml(paragraph)}</p>`)
    .join('')
  const eyebrowHtml = input.eyebrow
    ? `<p style="margin:0 0 9px;color:#8F4600;font-family:'Geist','Inter',Arial,sans-serif;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;">${escHtml(input.eyebrow)}</p>`
    : ''
  const titleHtml = `<h1 style="margin:0 0 18px;color:#080807;font-family:'Geist','Inter',Arial,sans-serif;font-size:28px;font-weight:750;letter-spacing:-.05em;line-height:1.08;">${escHtml(input.title)}</h1>`
  const quoteHtml = input.quote ? renderTextBox(input.quote, 'À retenir') : ''
  const noticeHtml = input.notice ? renderAlertBanner(escHtml(input.notice.text), input.notice.theme ?? 'info') : ''
  const factsHtml = input.facts?.length ? renderInfoBox(input.facts) : ''
  const ctaHtml = input.cta ? renderCTA(input.cta.label, input.cta.url) : ''
  const footnoteHtml = input.footnote
    ? `<p style="margin:-6px 0 0;color:#6E6A62;font-family:'Geist','Inter',Arial,sans-serif;font-size:13px;line-height:1.6;">${escHtml(input.footnote)}</p>`
    : ''

  const html = renderEmailShell({
    title: input.subject,
    headerName: 'Atelier BTP',
    bodyHtml: `${eyebrowHtml}${titleHtml}${paragraphHtml}${factsHtml}${quoteHtml}${ctaHtml}${footnoteHtml}`,
    alertHtml: noticeHtml,
    brand: atelierEmailBrand(),
    includeSignature: true,
  })
  return { subject: input.subject, html }
}

// ─── Faits d'offre (source : lib/pricing, quota-catalog, product-truth) ────────
//
// Principes de copy appliqués (skill interne copywriting-systems) : une seule
// action par email, des conditions visibles avant tout engagement, aucune
// urgence ni rareté inventée (la seule date citée est la vraie fin de l'essai),
// la possibilité de refuser sans pénalité, et des chiffres qui viennent du
// catalogue et non d'une promesse.

const PRO_PRICE = `${ATELIER_PRICING.pro.amountEur} € HT/mois`
const EXPERT_PRICE = `${ATELIER_PRICING.expert.amountEur} € HT/mois`

export function formatTierLabel(tier?: string | null): string {
  if (tier === 'pro') return 'Pro'
  if (tier === 'expert') return 'Expert'
  return 'Atelier'
}

function days(n: number): string {
  return `${n} jour${n > 1 ? 's' : ''}`
}

/** « lundi 12 octobre à 16 h 30 », à l'heure de Paris. */
function formatParisDateTime(iso?: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const day = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' }).format(date)
  const time = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(date).replace(':', ' h ')
  return `${day} à ${time}`
}

/** « 12 octobre 2026 », à l'heure de Paris. */
function formatParisDate(iso?: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

// ─── Essai gratuit : bienvenue, rappels, fin ─────────────────────────────────

/**
 * Carte de message : scène = premier jour dans un espace neuf ; progrès =
 * juger Atelier sur de vrais dossiers ; mécanisme = Sarah prépare, la personne
 * valide ; condition = aucune carte, rien prélevé ; action = ouvrir Atelier.
 */
export function buildAtelierTrialStartedEmail({
  appUrl,
  companyName,
  trialEndsAt,
}: {
  appUrl: string
  companyName: string
  trialEndsAt?: string | null
}) {
  const end = formatParisDateTime(trialEndsAt)
  return buildAtelierCommercialEmail({
    subject: `Bienvenue dans Atelier : vos ${TRIAL_DURATION_DAYS} jours Pro commencent maintenant`,
    eyebrow: 'Votre espace est prêt',
    title: `${companyName}, votre espace Atelier est prêt.`,
    paragraphs: [
      `Pendant ${TRIAL_DURATION_DAYS} jours, vous disposez de la formule Pro sur vos vrais devis, vos chantiers et vos relances.`,
      'Pour juger sur pièces, le plus simple est de préparer un devis réel avec Sarah, de l’envoyer à signer, puis de suivre la marge du chantier. Sarah prépare, vous validez.',
      'Aucune carte bancaire n’a été demandée et rien ne sera prélevé à la fin de l’essai.',
    ],
    facts: [
      { label: 'Formule', value: 'Pro' },
      ...(end ? [{ label: 'Fin de l’essai', value: escHtml(end) }] : []),
    ],
    cta: { label: 'Ouvrir Atelier →', url: `${appUrl}/dashboard` },
    footnote: 'À la fin de l’essai, votre espace est simplement mis en pause. Vous choisissez alors Pro ou Expert, ou vous exportez vos données.',
  })
}

/**
 * Deux états, une seule architecture (état, conséquence, action).
 * - 3 jours ou plus : la valeur et le choix des formules, sans pression.
 * - 2 jours ou moins : la décision, avec les conditions visibles (paiement,
 *   résiliation) avant le pas irréversible.
 */
export function buildAtelierTrialReminderEmail({
  appUrl,
  daysLeft,
  trialEndsAt,
  preferredTier,
}: {
  appUrl: string
  daysLeft: number
  trialEndsAt?: string | null
  preferredTier?: string | null
}) {
  const n = Math.max(1, Math.round(daysLeft))
  const end = formatParisDateTime(trialEndsAt)
  const endClause = end ? `le ${end}` : 'à la fin de la période d’essai'
  const subject = `Plus que ${days(n)} de Pro offert`
  const cta = { label: 'Choisir ma formule →', url: `${appUrl}/activation` }

  if (n <= 2) {
    return buildAtelierCommercialEmail({
      subject,
      eyebrow: 'Votre essai se termine bientôt',
      title: `Votre essai Pro se termine dans ${days(n)}.`,
      paragraphs: [
        `Votre accès Pro se termine ${endClause}. Passé ce moment, votre espace est mis en pause.`,
        `Pour continuer, choisissez Pro (${PRO_PRICE}) ou Expert (${EXPERT_PRICE}). Le paiement se fait en ligne par Stripe, puis chaque mois automatiquement.`,
        `Vous restez libre de partir : la résiliation se fait depuis vos paramètres, et votre accès reste actif ${CANCELLATION_NOTICE_DAYS} jours après la demande.`,
        'Si vous ne souhaitez pas continuer, il n’y a rien à faire : aucun prélèvement ne sera effectué.',
      ],
      cta,
    })
  }

  const guidance = preferredTier === 'expert'
    ? 'Vous aviez indiqué Expert à l’inscription : c’est la formule qui lève les limites si vous comptez beaucoup utiliser Sarah. Vous pouvez aussi commencer par Pro et passer à Expert plus tard depuis vos paramètres.'
    : 'Pro convient à un usage quotidien de Sarah. Expert devient utile quand vous approchez régulièrement des limites, et vous pourrez y passer plus tard depuis vos paramètres.'

  return buildAtelierCommercialEmail({
    subject,
    eyebrow: 'Votre essai continue',
    title: `Il vous reste ${days(n)} pour juger Atelier sur vos vrais dossiers.`,
    paragraphs: [
      `Votre accès Pro se termine ${endClause}. D’ici là, vos devis, vos chantiers et votre suivi de marge restent en place.`,
      'Si vous souhaitez continuer sans interruption, voici les deux formules. Le paiement est mensuel, sans frais de départ.',
    ],
    facts: [
      { label: `Pro, ${PRO_PRICE}`, value: '120 échanges IA et 60 analyses de devis par mois' },
      { label: `Expert, ${EXPERT_PRICE}`, value: 'Échanges et analyses de devis illimités' },
    ],
    quote: guidance,
    cta,
    footnote: 'Si ce n’est pas pour vous, il n’y a rien à faire : aucun prélèvement, votre espace est simplement mis en pause.',
  })
}

/** État, conséquence, action : l'espace est en pause, rien n'a été prélevé, voici le chemin. */
export function buildAtelierTrialEndedEmail({ appUrl }: { appUrl: string }) {
  return buildAtelierCommercialEmail({
    subject: 'Votre essai Atelier est terminé',
    eyebrow: 'Votre espace est en pause',
    title: 'Vos données sont toujours là.',
    paragraphs: [
      `Vos ${TRIAL_DURATION_DAYS} jours Pro sont terminés. Aucun prélèvement n’a été effectué.`,
      `Vos devis, vos chantiers et vos clients sont conservés. Pour reprendre là où vous vous étiez arrêté, choisissez Pro (${PRO_PRICE}) ou Expert (${EXPERT_PRICE}).`,
      'Vous préférez ne pas continuer ? Vous pouvez exporter vos données depuis la page d’activation, sans rien payer.',
    ],
    cta: { label: 'Choisir ma formule →', url: `${appUrl}/activation` },
  })
}

// ─── Abonnement : paiement, échec, fin, résiliation ──────────────────────────

export type AtelierSubscriptionEmailKind =
  | 'activated'
  | 'payment_failed'
  | 'payment_recovered'
  | 'ended'
  | 'cancellation_scheduled'

/** Emails de service autour du paiement : état, conséquence, une action utile. */
export function buildAtelierSubscriptionEmail({
  kind,
  appUrl,
  tier,
  renewsAt,
  endsAt,
}: {
  kind: AtelierSubscriptionEmailKind
  appUrl: string
  tier?: string | null
  renewsAt?: string | null
  endsAt?: string | null
}) {
  const label = formatTierLabel(tier)
  const plan = tier === 'expert' ? ATELIER_PRICING.expert : tier === 'pro' ? ATELIER_PRICING.pro : null

  switch (kind) {
    case 'activated': {
      const next = formatParisDate(renewsAt)
      return buildAtelierCommercialEmail({
        subject: `Votre formule ${label} est active`,
        eyebrow: 'Abonnement actif',
        title: 'Votre accès est ouvert.',
        paragraphs: [
          `Votre formule ${label} est active pour toute votre équipe.`,
          'Le paiement est mensuel et automatique par Stripe. Votre moyen de paiement, vos factures et votre formule se gèrent depuis Paramètres, rubrique Abonnement.',
        ],
        facts: [
          { label: 'Formule', value: label },
          ...(plan ? [{ label: 'Montant', value: `${plan.amountEur} € HT/mois` }] : []),
          ...(next ? [{ label: 'Prochain prélèvement', value: escHtml(next) }] : []),
        ],
        cta: { label: 'Ouvrir Atelier →', url: `${appUrl}/dashboard` },
      })
    }
    case 'payment_failed':
      return buildAtelierCommercialEmail({
        subject: 'Votre paiement Atelier n’a pas abouti',
        eyebrow: 'Paiement',
        title: 'Le prélèvement n’a pas pu être effectué.',
        paragraphs: [
          'Stripe va retenter automatiquement. Votre accès reste ouvert pendant cette période.',
          'Pour éviter une interruption, mettez à jour votre moyen de paiement : cela prend une minute.',
        ],
        cta: { label: 'Mettre à jour mon moyen de paiement →', url: `${appUrl}/settings?tab=abonnement` },
      })
    case 'payment_recovered':
      return buildAtelierCommercialEmail({
        subject: 'Paiement reçu, votre accès est maintenu',
        eyebrow: 'Paiement',
        title: 'Tout est en ordre.',
        paragraphs: ['Votre paiement a bien été récupéré. Atelier continue normalement pour toute votre équipe.'],
        cta: { label: 'Ouvrir Atelier →', url: `${appUrl}/dashboard` },
      })
    case 'ended':
      return buildAtelierCommercialEmail({
        subject: 'Votre abonnement Atelier est terminé',
        eyebrow: 'Abonnement terminé',
        title: 'Votre accès est terminé.',
        paragraphs: [
          'Votre abonnement est arrivé à son terme et les prélèvements sont arrêtés.',
          'Vos données restent exportables depuis la page d’activation, où vous pouvez aussi reprendre un abonnement quand vous le souhaitez.',
        ],
        cta: { label: 'Voir la page d’activation →', url: `${appUrl}/activation` },
      })
    case 'cancellation_scheduled': {
      const until = formatParisDate(endsAt)
      return buildAtelierCommercialEmail({
        subject: 'Résiliation Atelier confirmée',
        eyebrow: 'Résiliation',
        title: 'Votre résiliation est programmée.',
        paragraphs: [
          `Votre accès reste complet${until ? ` jusqu’au ${until}` : ` pendant ${CANCELLATION_NOTICE_DAYS} jours`}. Stripe calcule la dernière période au prorata.`,
          'À cette date, les prélèvements s’arrêtent. Vos données restent exportables depuis la page d’activation.',
        ],
        cta: { label: 'Gérer mon abonnement →', url: `${appUrl}/settings?tab=abonnement` },
      })
    }
  }
}

// ─── Alerte d'usage : approche de la limite mensuelle ────────────────────────

const QUOTA_UNIT_LABEL: Record<string, string> = { call: 'appels', document: 'documents', message: 'messages', minute: 'minutes' }

/**
 * Texte d'une alerte d'usage (relu par un humain avant envoi, ou envoyé
 * automatiquement après un délai). Scène : la limite approche. Conséquence : la
 * limite se renouvelle le 1er du mois. Choix : attendre, ou changer de formule.
 */
export function buildQuotaAlertContent(input: {
  featureLabel: string
  feature: string
  pct: number
  tier?: string | null
}): { subject: string; bodyLines: string[]; cta: { label: string; path: string } } {
  const percent = Math.round(input.pct * 100)
  const expertLimit = (QUOTAS_BY_TIER.expert as Record<string, number | undefined>)[input.feature]
  const unit = QUOTA_UNIT_LABEL[QUOTA_DEFINITIONS[input.feature as QuotaFeature]?.unit ?? ''] ?? 'utilisations'
  const expertSentence = typeof expertLimit === 'number' && expertLimit > 0
    ? `la formule Expert porte cette limite à ${expertLimit} ${unit} par mois.`
    : 'la formule Expert retire cette limite.'
  return {
    subject: `Vous approchez de votre limite mensuelle : ${input.featureLabel}`,
    bodyLines: [
      'Bonjour,',
      `Ce mois-ci, vous avez utilisé ${percent} % de votre limite mensuelle pour « ${input.featureLabel} » (formule ${formatTierLabel(input.tier)}).`,
      `La limite se renouvelle le 1er du mois prochain. Si vous en avez besoin avant, ${expertSentence}`,
      'Rien à faire si vous préférez attendre le renouvellement. Sinon, le changement se fait depuis Paramètres, rubrique Abonnement.',
    ],
    cta: { label: 'Voir les options de mon abonnement →', path: '/settings?tab=abonnement' },
  }
}

export function buildAtelierLifecycleEmail({
  subject,
  title,
  body,
  appUrl,
  ctaLabel,
  ctaPath = '/dashboard',
  notice,
}: {
  subject: string
  title: string
  body: string
  appUrl: string
  ctaLabel?: string
  ctaPath?: string
  notice?: { text: string; theme?: 'success' | 'info' }
}) {
  return buildAtelierCommercialEmail({
    subject,
    eyebrow: 'Atelier BTP',
    title,
    paragraphs: [body],
    cta: ctaLabel ? { label: `${ctaLabel} →`, url: `${appUrl}${ctaPath}` } : undefined,
    notice,
  })
}

export function buildAtelierNotificationEmail({ subject, title, body }: { subject: string; title: string; body: string }) {
  const html = renderEmailShell({
    title: subject,
    headerName: 'Atelier BTP',
    bodyHtml: `<h1 style="margin:0 0 18px;color:#080807;font-family:'Geist','Inter',Arial,sans-serif;font-size:24px;font-weight:750;letter-spacing:-.04em;line-height:1.15;">${escHtml(title)}</h1><p style="margin:0;color:#36332E;font-family:'Geist','Inter',Arial,sans-serif;font-size:14px;line-height:1.7;">${escHtml(body)}</p>`,
    brand: atelierEmailBrand(),
  })
  return { subject, html }
}
