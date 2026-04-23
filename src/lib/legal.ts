import { APP_NAME, APP_SIGNATURE } from '@/lib/brand'

export const LEGAL_PATHS = {
  privacy: '/privacy',
  terms: '/terms',
  legal: '/legal',
} as const

function envValue(name: string): string | null {
  const value = process.env[name]?.trim()
  return value ? value : null
}

export const LEGAL_CONTACT = {
  supportEmail: envValue('NEXT_PUBLIC_SUPPORT_EMAIL') ?? 'contact@orsayn.fr',
  privacyEmail:
    envValue('NEXT_PUBLIC_PRIVACY_EMAIL') ??
    envValue('NEXT_PUBLIC_SUPPORT_EMAIL') ??
    'contact@orsayn.fr',
  legalEmail:
    envValue('NEXT_PUBLIC_LEGAL_EMAIL') ??
    envValue('NEXT_PUBLIC_SUPPORT_EMAIL') ??
    'contact@orsayn.fr',
} as const

export const LEGAL_EDITOR = {
  publisherName: envValue('NEXT_PUBLIC_LEGAL_PUBLISHER_NAME') ?? 'Orsayn',
  companyName:
    envValue('NEXT_PUBLIC_LEGAL_COMPANY_NAME') ??
    'Samuel Mbeboura, entrepreneur individuel exerçant sous le nom commercial Orsayn',
  address: envValue('NEXT_PUBLIC_LEGAL_ADDRESS') ?? '1 rue des héraults',
  phone: envValue('NEXT_PUBLIC_LEGAL_PHONE') ?? '0651664068',
  registration:
    envValue('NEXT_PUBLIC_LEGAL_REGISTRATION') ??
    'Entrepreneur individuel immatriculé sous le SIRET 98920815200011',
  vatNumber: envValue('NEXT_PUBLIC_LEGAL_VAT_NUMBER'),
  publicationDirector: envValue('NEXT_PUBLIC_LEGAL_PUBLICATION_DIRECTOR') ?? 'Samuel Mbeboura',
  hostingProvider: envValue('NEXT_PUBLIC_LEGAL_HOSTING_PROVIDER') ?? 'Cloudflare, Inc.',
  hostingWebsite: envValue('NEXT_PUBLIC_LEGAL_HOSTING_WEBSITE') ?? 'https://www.cloudflare.com',
} as const

export const LEGAL_INFO_INCOMPLETE = !LEGAL_CONTACT.legalEmail

export const PLATFORM_MODEL = {
  ownershipTitle: 'Socle logiciel maintenu par Orsayn',
  ownershipBody:
    "ATELIER est fourni comme un logiciel métier B2B opéré par Orsayn. Orsayn conserve la propriété du socle logiciel, des composants réutilisables et de l'architecture. Chaque client reste propriétaire de ses données, contenus et paramètres métier.",
  dataTitle: 'Données client et réversibilité',
  dataBody:
    "Les données métier restent la propriété du client. En fin de contrat, un export est remis avant suppression de l'instance selon le calendrier contractuel, sous réserve des obligations de conservation applicables.",
  privacyTitle: 'Traitements RGPD cadrés',
  privacyBody:
    "Pour les données métier hébergées pour le compte du client, Orsayn intervient généralement comme sous-traitant. Pour ses propres traitements de compte, support, sécurité et facturation, Orsayn peut intervenir comme responsable de traitement.",
} as const

export const LANDING_LEGAL_SNIPPETS = [
  {
    title: PLATFORM_MODEL.ownershipTitle,
    body: PLATFORM_MODEL.ownershipBody,
  },
  {
    title: PLATFORM_MODEL.dataTitle,
    body: PLATFORM_MODEL.dataBody,
  },
  {
    title: PLATFORM_MODEL.privacyTitle,
    body: PLATFORM_MODEL.privacyBody,
  },
] as const

export function buildDeletionRequestMailto({
  requesterEmail,
  orgName,
}: {
  requesterEmail?: string | null
  orgName?: string | null
}): string | null {
  const to = LEGAL_CONTACT.privacyEmail ?? LEGAL_CONTACT.supportEmail
  if (!to) return null

  const subject = `ATELIER - Demande de suppression de données${orgName ? ` (${orgName})` : ''}`
  const body = [
    'Bonjour,',
    '',
    "Je souhaite demander la suppression de mes données dans ATELIER.",
    '',
    `Organisation : ${orgName ?? 'À préciser'}`,
    `Email du demandeur : ${requesterEmail ?? 'À préciser'}`,
    '',
    "Je comprends que certaines données puissent être conservées pendant la durée légale nécessaire, notamment les pièces comptables et de facturation.",
    '',
    "Merci de me confirmer la réception de cette demande ainsi que les prochaines étapes (export, délai de traitement, suppression).",
  ].join('\n')

  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export function legalContactLabel(email: string | null): string {
  return email ?? 'contact@orsayn.fr'
}

export const LEGAL_COPY = {
  appName: APP_NAME,
  signature: APP_SIGNATURE,
  cookies:
    "ATELIER utilise des cookies techniques strictement nécessaires à l'authentification et au maintien de session. Aucun mécanisme publicitaire ou de tracking marketing n'est intégré.",
  deletion:
    "La suppression de compte nécessite de conserver légalement certains documents. Suite à une demande de fermeture, vous pourrez d'abord télécharger l'ensemble de vos données (informations clients, devis, factures), puis nous supprimerons ce qui n'est pas requis légalement.",
} as const
