import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SendEmailResult } from '@/lib/email'

type ReminderLog = {
  client_id: string | null
  type: 'payment_reminder' | 'quote_followup'
  rank: number
  sent_by?: string
  is_auto: boolean
  email_subject: string
  email_body: string
}

/** At most one provider attempt per document/day, across every reminder channel. */
export async function dispatchDocumentReminder(input: {
  organizationId: string
  invoiceId?: string
  quoteId?: string
  reminder: ReminderLog
  deliver: () => Promise<SendEmailResult>
}): Promise<{ error: string | null; sent: boolean; duplicate: boolean }> {
  const admin = createAdminClient()
  const { data: claim, error: claimError } = await admin.rpc('claim_document_reminder', {
    p_org_id: input.organizationId,
    p_invoice_id: input.invoiceId ?? null,
    p_quote_id: input.quoteId ?? null,
  })
  if (claimError) return {
    error: claimError.code === 'P2001'
      ? 'Cette facture est soldée ou compensée par un avoir. Aucune relance envoyée.'
      : 'Impossible de réserver la relance. Aucun email envoyé.',
    sent: false,
    duplicate: false,
  }
  if (!claim) return { error: 'Relance déjà envoyée aujourd’hui, en cours ou à vérifier. Aucun nouvel email envoyé.', sent: false, duplicate: true }

  let mail: SendEmailResult
  try {
    mail = await input.deliver()
  } catch {
    mail = { error: 'Résultat de l’envoi à vérifier avant toute nouvelle relance.', delivery: 'unknown' }
  }
  if (mail.error || mail.delivery !== 'accepted') {
    if (mail.delivery === 'not_sent' || mail.delivery === 'rejected') {
      await admin.from('document_reminder_dispatches').delete().eq('id', claim).eq('delivery', 'pending')
    } else {
      await admin.from('document_reminder_dispatches').update({ delivery: 'unknown' }).eq('id', claim)
    }
    return { error: mail.delivery === 'unknown' ? 'Résultat de l’envoi à vérifier avant toute nouvelle relance.' : 'Relance non envoyée. Vérifiez l’adresse du client et les réglages email.', sent: false, duplicate: false }
  }

  const { error: stateError } = await admin.from('document_reminder_dispatches').update({ delivery: 'accepted' }).eq('id', claim)
  const { error: logError } = await admin.from('reminders').insert({
    ...input.reminder,
    organization_id: input.organizationId,
    invoice_id: input.invoiceId ?? null,
    quote_id: input.quoteId ?? null,
    sent_at: new Date().toISOString(),
  })
  if (stateError || logError) return { error: 'Email envoyé, mais son journal n’a pas pu être finalisé. Ne pas renvoyer sans vérification.', sent: true, duplicate: false }
  return { error: null, sent: true, duplicate: false }
}
