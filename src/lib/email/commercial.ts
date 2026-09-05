import {
  atelierEmailBrand,
  escHtml,
  renderAlertBanner,
  renderCTA,
  renderEmailShell,
  renderInfoBox,
  renderTextBox,
} from './layout'

export type AtelierCommercialEmailInput = {
  subject: string
  eyebrow?: string
  title: string
  paragraphs: string[]
  cta?: { label: string; url: string }
  facts?: Array<{ label: string; value: string; large?: boolean }>
  notice?: { text: string; theme?: 'success' | 'info' }
  quote?: string
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

  const html = renderEmailShell({
    title: input.subject,
    headerName: 'Atelier BTP',
    bodyHtml: `${eyebrowHtml}${titleHtml}${paragraphHtml}${quoteHtml}${factsHtml}${ctaHtml}`,
    alertHtml: noticeHtml,
    brand: atelierEmailBrand(),
    includeSignature: true,
  })
  return { subject: input.subject, html }
}

export function buildAtelierTrialStartedEmail({ appUrl, companyName }: { appUrl: string; companyName: string }) {
  return buildAtelierCommercialEmail({
    subject: 'Bienvenue dans Atelier — vos 14 jours Pro commencent maintenant',
    eyebrow: 'Votre espace est prêt',
    title: `${companyName}, votre atelier peut commencer à travailler.`,
    paragraphs: [
      'Pendant 14 jours, vous disposez de la formule Pro : devis, factures, chantiers, suivi de marge et assistants métier.',
      'Aucune carte bancaire n’a été demandée et aucun prélèvement ne sera lancé automatiquement à la fin de l’essai.',
    ],
    cta: { label: 'Ouvrir Atelier →', url: `${appUrl}/dashboard` },
    notice: { text: 'À la fin de l’essai, votre espace sera simplement mis en pause. Vous choisirez ensuite Pro ou Expert.', theme: 'success' },
  })
}

export function buildAtelierTrialReminderEmail({ appUrl, daysLeft }: { appUrl: string; daysLeft: number }) {
  return buildAtelierCommercialEmail({
    subject: `Plus que ${daysLeft} jour${daysLeft > 1 ? 's' : ''} de Pro offert`,
    eyebrow: 'Votre essai continue',
    title: `Il vous reste ${daysLeft} jour${daysLeft > 1 ? 's' : ''} pour tout tester.`,
    paragraphs: [
      'Vos devis, vos chantiers et votre suivi de marge restent en place.',
      'Choisissez votre formule avant la fin de l’essai si vous souhaitez garder l’accès sans interruption.',
    ],
    cta: { label: 'Voir les formules →', url: `${appUrl}/activation` },
  })
}

export function buildAtelierTrialEndedEmail({ appUrl }: { appUrl: string }) {
  return buildAtelierCommercialEmail({
    subject: 'Votre essai Atelier est terminé',
    eyebrow: 'Votre espace est conservé',
    title: 'Vos données sont toujours là.',
    paragraphs: [
      'Vos 14 jours Pro sont terminés. Aucun prélèvement n’a été effectué.',
      'Choisissez Pro ou Expert pour reprendre là où vous vous êtes arrêté, ou exportez vos données quand vous le souhaitez.',
    ],
    cta: { label: 'Choisir ma formule →', url: `${appUrl}/activation` },
  })
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
