import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'

export type EmailTemplateSlug =
  | 'quote_sent'
  | 'invoice_sent'
  | 'payment_reminder_1'
  | 'payment_reminder_2'

export type EmailTemplate = {
  id: string | null
  slug: EmailTemplateSlug
  name: string
  subject: string
  body_text: string
  variables: string[]
  is_custom: boolean
}

export const DEFAULT_EMAIL_TEMPLATES: Omit<EmailTemplate, 'id' | 'is_custom'>[] = [
  {
    slug: 'quote_sent',
    name: 'Envoi de Devis',
    subject: 'Votre devis {{numero_devis}}',
    body_text:
      'Bonjour {{client_nom}},\n\nVeuillez trouver ci-joint notre devis {{numero_devis}} d\'un montant de {{montant_ttc}}.\n\nPour l\'accepter en ligne : {{lien_signature}}\n\nAu plaisir de continuer avec vous sur ce projet,\nL\'équipe {{entreprise_nom}}',
    variables: ['{{numero_devis}}', '{{client_nom}}', '{{montant_ttc}}', '{{entreprise_nom}}', '{{lien_signature}}'],
  },
  {
    slug: 'invoice_sent',
    name: 'Envoi de Facture',
    subject: 'Votre facture {{numero_facture}}',
    body_text:
      'Bonjour {{client_nom}},\n\nVeuillez trouver ci-joint notre facture {{numero_facture}} d\'un montant de {{montant_ttc}}.\n\nMerci encore pour votre confiance,\nL\'équipe {{entreprise_nom}}',
    variables: ['{{numero_facture}}', '{{client_nom}}', '{{montant_ttc}}', '{{entreprise_nom}}'],
  },
  {
    slug: 'payment_reminder_1',
    name: 'Relance facture (niveau 1, douce)',
    subject: 'Relance : Facture {{numero_facture}}',
    body_text:
      'Bonjour {{client_nom}},\n\nSauf erreur de notre part, la facture {{numero_facture}} de {{montant_ttc}} arrivée à échéance le {{date_echeance}} reste impayée.\n\nMerci par avance pour votre retour,\nL\'équipe {{entreprise_nom}}',
    variables: ['{{numero_facture}}', '{{client_nom}}', '{{montant_ttc}}', '{{date_echeance}}', '{{entreprise_nom}}'],
  },
  {
    slug: 'payment_reminder_2',
    name: 'Relance facture (niveau 2, ferme)',
    subject: 'Dernière relance : Facture {{numero_facture}}',
    body_text:
      'Bonjour {{client_nom}},\n\nMalgré notre précédente relance, la facture {{numero_facture}} d\'un montant de {{montant_ttc}} est toujours en attente de paiement.\n\nNous vous invitons à procéder au règlement dès que possible afin que nous puissions clôturer ce dossier dans les meilleures conditions.\n\nL\'équipe {{entreprise_nom}}',
    variables: ['{{numero_facture}}', '{{client_nom}}', '{{montant_ttc}}', '{{date_echeance}}', '{{entreprise_nom}}'],
  },
]

export async function getEmailTemplates(): Promise<EmailTemplate[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()

  if (!orgId) {
    return DEFAULT_EMAIL_TEMPLATES.map(t => ({ ...t, id: null, is_custom: false }))
  }

  const { data: dbTemplates } = await supabase
    .from('email_templates')
    .select('id, slug, subject, body_text')
    .eq('organization_id', orgId)
    .eq('is_active', true)

  return DEFAULT_EMAIL_TEMPLATES.map(defaultTpl => {
    const dbTpl = dbTemplates?.find(d => d.slug === defaultTpl.slug)
    return {
      ...defaultTpl,
      id: dbTpl?.id ?? null,
      subject: dbTpl?.subject ?? defaultTpl.subject,
      body_text: dbTpl?.body_text ?? defaultTpl.body_text,
      is_custom: !!dbTpl,
    }
  })
}
