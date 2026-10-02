import { describe, expect, it } from 'vitest'
import { APP_SIGNATURE, ATELIER_SENDER_NAME, defaultBrandedSenderName } from '@/lib/brand'
import {
  buildAtelierCommercialEmail,
  buildAtelierLifecycleEmail,
  buildAtelierNotificationEmail,
  buildAtelierTrialEndedEmail,
  buildAtelierTrialReminderEmail,
  buildAtelierTrialStartedEmail,
} from '@/lib/email/commercial'
import { emailSafeLogoUrl, renderEmailShell } from '@/lib/email/layout'
import { renderOrganizationEmail } from '@/lib/email/organization'
import {
  buildDepositInvoiceEmail,
  buildInviteEmail,
  buildInvoicePaidEmail,
  buildMemberMonthlyReportEmail,
  buildMemberSpaceInviteEmail,
  buildMemberSpaceInviteReminderEmail,
  buildOrganizationExportReadyEmail,
  buildPasswordResetOtpEmail,
  buildQuoteAcceptedClientEmail,
  buildQuoteAcceptedProfessionalEmail,
  buildQuoteRequestNotificationEmail,
  buildQuoteSentEmail,
  buildSignupOtpEmail,
} from '@/lib/email/templates'
import { TRIAL_DURATION_DAYS, TRIAL_TIER } from '@/lib/operator/trial-lifecycle'

type Built = { subject: string; html: string }

const ORG = 'Weber Tôlerie'
const APP_URL = 'https://app.atelier-btp.fr'

// Défini à la collecte : les tables it.each génèrent les emails avant tout beforeAll.
process.env.NEXT_PUBLIC_APP_URL = APP_URL

/** Emails écrits par Atelier lui-même (support, cycle de vie, essai, facturation Atelier). */
function atelierEmails(): Array<[string, Built]> {
  return [
    ['essai démarré', buildAtelierTrialStartedEmail({ appUrl: APP_URL, companyName: ORG })],
    ['rappel essai', buildAtelierTrialReminderEmail({ appUrl: APP_URL, daysLeft: 2 })],
    ['essai terminé', buildAtelierTrialEndedEmail({ appUrl: APP_URL })],
    ['cycle de vie', buildAtelierLifecycleEmail({ subject: 'Votre accès Atelier est activé', title: 'Accès activé', body: 'Votre formule Pro est active.', appUrl: APP_URL, ctaLabel: 'Ouvrir', ctaPath: '/dashboard' })],
    ['notification interne', buildAtelierNotificationEmail({ subject: '[Atelier] Nouvel essai : Weber', title: 'Nouvel essai démarré', body: 'Weber vient de démarrer un essai Pro de 7 jours.' })],
    ['message cockpit', buildAtelierCommercialEmail({ subject: 'Un point sur votre usage', title: 'Un point sur votre usage', paragraphs: ['Bonjour,', 'Voici un message du support.'] })],
    ['code d’inscription', buildSignupOtpEmail({ otp: '123456', orgName: APP_SIGNATURE })],
    ['code mot de passe', buildPasswordResetOtpEmail({ otp: '654321', orgName: APP_SIGNATURE })],
  ]
}

/** Emails envoyés au nom d'une entreprise cliente, à ses propres clients ou équipiers. */
function organizationEmails(logoUrl?: string): Array<[string, Built]> {
  const logo = logoUrl ? { logoUrl } : {}
  const common = { orgName: ORG, orgEmail: 'contact@weber.fr', clientName: 'Mme Martin', currency: 'EUR', ...logo }
  return [
    ['invitation équipe', buildInviteEmail({ orgName: ORG, ...logo, inviterName: 'Paul Weber', inviteUrl: `${APP_URL}/invite/abc` })],
    ['devis envoyé', buildQuoteSentEmail({ ...common, quoteNumber: 'DEV-001', quoteTitle: 'Garde-corps', totalTtc: 1200, validUntil: '2026-12-01', signUrl: `${APP_URL}/sign/abc`, emailSignature: 'Paul Weber' })],
    ['devis accepté (client)', buildQuoteAcceptedClientEmail({ ...common, quoteNumber: 'DEV-001', quoteTitle: 'Garde-corps', totalTtc: 1200, signedAt: new Date('2026-10-01') })],
    ['devis accepté (pro)', buildQuoteAcceptedProfessionalEmail({ orgName: ORG, ...logo, clientName: 'Mme Martin', clientEmail: 'm@x.fr', quoteNumber: 'DEV-001', quoteTitle: 'Garde-corps', totalTtc: 1200, currency: 'EUR', signedAt: new Date('2026-10-01'), quoteEditorUrl: `${APP_URL}/quotes/1` })],
    ['facture payée', buildInvoicePaidEmail({ ...common, invoiceNumber: 'FAC-001', invoiceTitle: 'Garde-corps', totalTtc: 1200, paidAt: new Date('2026-10-01') })],
    ['facture d’acompte', buildDepositInvoiceEmail({ ...common, invoiceNumber: 'FAC-002', quoteNumber: 'DEV-001', quoteTitle: 'Garde-corps', depositRate: 30, totalTtc: 360, dueDate: '2026-11-01' })],
    ['demande de devis reçue', buildQuoteRequestNotificationEmail({ orgName: ORG, ...logo, name: 'Mme Martin', email: 'm@x.fr', description: 'Besoin d’un garde-corps.' })],
    ['export prêt', buildOrganizationExportReadyEmail({ orgName: ORG, ...logo, downloadUrl: `${APP_URL}/export/1`, expiresAt: '2026-10-08', summary: { counts: { clients: 3 }, files: { pdf: 4 }, warnings: [] } })],
    ['espace équipier', buildMemberSpaceInviteEmail({ orgName: ORG, ...logo, memberFirstName: 'Léo', spaceUrl: `${APP_URL}/espace/abc` })],
    ['rappel espace équipier', buildMemberSpaceInviteReminderEmail({ orgName: ORG, ...logo, memberFirstName: 'Léo', spaceUrl: `${APP_URL}/espace/abc` })],
    ['rapport mensuel équipier', buildMemberMonthlyReportEmail({ orgName: ORG, ...logo, orgEmail: 'contact@weber.fr', memberFirstName: 'Léo', periodLabel: 'septembre 2026', totalHours: 151, spaceUrl: `${APP_URL}/espace/abc` })],
    ['code mot de passe (entreprise)', buildPasswordResetOtpEmail({ otp: '654321', orgName: ORG, ...logo })],
    ['relance (wrapper entreprise)', { subject: 'Relance', html: renderOrganizationEmail({ subject: ORG, orgName: ORG, bodyHtml: '<p>Bonjour</p>', ...logo }) }],
  ]
}

describe('essai gratuit unique : Pro 7 jours', () => {
  it('définit un seul essai : tier Pro, 7 jours', () => {
    expect(TRIAL_TIER).toBe('pro')
    expect(TRIAL_DURATION_DAYS).toBe(7)
  })

  it('annonce 7 jours Pro dans les trois emails du parcours', () => {
    const started = buildAtelierTrialStartedEmail({ appUrl: APP_URL, companyName: ORG })
    const ended = buildAtelierTrialEndedEmail({ appUrl: APP_URL })
    expect(started.subject).toContain('7 jours Pro')
    expect(started.html).toContain('Pendant 7 jours')
    expect(ended.html).toContain('Vos 7 jours Pro sont terminés')
    for (const { subject, html } of [started, ended, buildAtelierTrialReminderEmail({ appUrl: APP_URL, daysLeft: 2 })]) {
      expect(`${subject}${html}`).not.toMatch(/14 jours|30 jours|essai Expert|Expert 30/i)
    }
  })

  it('pluralise le rappel et pointe vers la page d’activation avec un bouton', () => {
    const last = buildAtelierTrialReminderEmail({ appUrl: APP_URL, daysLeft: 1 })
    const two = buildAtelierTrialReminderEmail({ appUrl: APP_URL, daysLeft: 2 })
    expect(last.subject).toBe('Plus que 1 jour de Pro offert')
    expect(two.subject).toBe('Plus que 2 jours de Pro offert')
    expect(two.html).toContain(`${APP_URL}/activation`)
    expect(two.html).toContain('role="button"')
  })
})

describe('branding des emails Atelier (support, cycle de vie, essai)', () => {
  it.each(atelierEmails())('%s : habillage Atelier complet', (_name, { subject, html }) => {
    expect(html).toContain('<html lang="fr">')
    expect(html).toContain('#F7F4EE')
    expect(html).toContain('Atelier BTP')
    expect(html).toContain('contact@orsayn.fr')
    // Une seule fois : soit dans la signature de Samuel, soit dans « Une question ? », jamais les deux.
    expect(html.match(/mailto:contact@orsayn\.fr/g)).toHaveLength(1)
    expect(html).toContain(`${APP_URL}/brand/atelier/logo-atelier-blanc.png`)
    expect(html).not.toContain('Propulsé par')
    expect(html).not.toContain('—')
    expect(subject).not.toContain('—')
  })

  it('les emails du support signent Samuel, fondateur d’Atelier BTP', () => {
    for (const [, email] of atelierEmails().filter(([name]) => ['essai démarré', 'rappel essai', 'essai terminé', 'cycle de vie', 'message cockpit'].includes(name))) {
      expect(email.html).toContain('Fondateur d’Atelier BTP')
    }
  })
})

describe('branding des emails envoyés au nom d’une entreprise cliente', () => {
  it.each(organizationEmails())('%s : au nom de l’entreprise, attribué à Atelier', (_name, { subject, html }) => {
    expect(html).toContain('<html lang="fr">')
    expect(html).toContain(ORG)
    expect(html).toContain(`${APP_URL}/brand/atelier/logo-atelier-blanc.png`)
    expect(html).toContain('Propulsé par Atelier BTP')
    expect(html).not.toContain('Fondateur d’Atelier BTP')
    expect(html).not.toContain('contact@orsayn.fr')
    expect(html).not.toContain('—')
    expect(subject).not.toContain('—')
  })
})

describe('logo entier dans les emails', () => {
  it('utilise des PNG, jamais de SVG (non affichés par Gmail et Outlook)', () => {
    for (const [, { html }] of [...atelierEmails(), ...organizationEmails()]) {
      expect(html).not.toMatch(/<img[^>]+\.svg/)
    }
  })

  it('blanc sur en-tête sombre, noir sur en-tête clair', () => {
    const dark = renderEmailShell({ title: 'T', headerName: 'Atelier BTP', bodyHtml: '<p>x</p>' })
    const light = renderEmailShell({ title: 'T', headerName: 'Atelier BTP', bodyHtml: '<p>x</p>', headerColor: '#F7F4EE' })
    expect(dark).toContain('logo-atelier-blanc.png')
    expect(dark).not.toContain('logo-atelier-noir.png')
    expect(light).toContain('logo-atelier-noir.png')
    expect(light).not.toContain('logo-atelier-blanc.png')
  })

  it('affiche le nom de l’entreprise sous le logo Atelier', () => {
    const html = renderOrganizationEmail({ subject: ORG, orgName: ORG, bodyHtml: '<p>Bonjour</p>' })
    expect(html).toContain('alt="Atelier BTP"')
    expect(html.indexOf('logo-atelier-blanc.png')).toBeLessThan(html.indexOf(`>${ORG}</p>`))
  })

  it('garde le logo propre à l’entreprise quand elle en fournit un', () => {
    const html = renderOrganizationEmail({ subject: ORG, orgName: ORG, bodyHtml: '<p>Bonjour</p>', logoUrl: 'https://cdn.weber.fr/logo.png' })
    expect(html).toContain('https://cdn.weber.fr/logo.png')
    expect(html).not.toContain('logo-atelier-blanc.png')
  })

  it('retombe sur le nom en texte quand l’URL de l’app est inconnue', () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    try {
      const html = renderEmailShell({ title: 'T', headerName: 'Atelier BTP', bodyHtml: '<p>x</p>' })
      expect(html).not.toContain('<img')
      expect(html).toContain('Atelier BTP')
    } finally {
      process.env.NEXT_PUBLIC_APP_URL = APP_URL
    }
  })
})

describe('noms d’expéditeur', () => {
  it('Atelier signe toujours « Atelier BTP », aligné sur l’en-tête et la signature', () => {
    expect(ATELIER_SENDER_NAME).toBe('Atelier BTP')
    expect(defaultBrandedSenderName(null)).toBe('Atelier BTP')
    expect(defaultBrandedSenderName('   ')).toBe('Atelier BTP')
  })

  it('une entreprise garde son propre nom d’expéditeur', () => {
    expect(defaultBrandedSenderName('Weber Tôlerie')).toBe('Weber Tôlerie')
  })

  it('le nom d’expéditeur Atelier est reconnu comme la marque Atelier par le shell', () => {
    const html = renderEmailShell({ title: 'T', headerName: ATELIER_SENDER_NAME, bodyHtml: '<p>x</p>' })
    expect(html).toContain('Une question ?')
    expect(html).not.toContain('Propulsé par')
  })

  it('n’affiche pas « Une question ? » en plus de la signature de Samuel', () => {
    const withSignature = renderEmailShell({ title: 'T', headerName: ATELIER_SENDER_NAME, bodyHtml: '<p>x</p>', includeSignature: true })
    expect(withSignature).toContain('Fondateur d’Atelier BTP')
    expect(withSignature).not.toContain('Une question ?')
  })
})

describe('logo des emails envoyés au nom d’une entreprise', () => {
  const ORG_LOGO = 'https://xyz.supabase.co/storage/v1/object/public/logos/weber/logo.png'

  it.each(organizationEmails(ORG_LOGO))('%s : logo de l’entreprise quand elle en a un', (_name, { html }) => {
    expect(html).toContain(ORG_LOGO)
    expect(html).not.toContain('logo-atelier-blanc.png')
    expect(html).toContain('Propulsé par Atelier BTP')
  })

  it.each(organizationEmails())('%s : logo Atelier quand l’entreprise n’en a pas', (_name, { html }) => {
    expect(html).toContain('logo-atelier-blanc.png')
    expect(html).toContain(`>${ORG}</p>`)
  })

  it.each([
    ['SVG', 'https://cdn.weber.fr/logo.svg'],
    ['SVG avec paramètres', 'https://cdn.weber.fr/logo.SVG?v=2'],
    ['AVIF', 'https://cdn.weber.fr/logo.avif'],
    ['HTTP non sécurisé', 'http://cdn.weber.fr/logo.png'],
    ['data URI', 'data:image/png;base64,AAAA'],
    ['vide', '   '],
  ])('logo %s non affichable dans un email : repli sur Atelier', (_label, url) => {
    const html = renderOrganizationEmail({ subject: ORG, orgName: ORG, bodyHtml: '<p>x</p>', logoUrl: url })
    expect(html).toContain('logo-atelier-blanc.png')
    expect(html).not.toContain(url.trim() || 'NEVER')
  })

  it('accepte PNG, JPEG et WebP en HTTPS', () => {
    for (const url of ['https://cdn.weber.fr/a.png', 'https://cdn.weber.fr/a.jpg?x=1', 'https://cdn.weber.fr/a.webp']) {
      expect(emailSafeLogoUrl(url)).toBe(url)
    }
  })

  it('pose le logo de l’entreprise sur une plaque blanche lisible sur l’en-tête sombre', () => {
    const html = renderOrganizationEmail({ subject: ORG, orgName: ORG, bodyHtml: '<p>x</p>', logoUrl: ORG_LOGO })
    expect(html).toMatch(/background:#FFFFFF;border-radius:12px[^"]*"><img src="https:\/\/xyz\.supabase\.co/)
  })
})
