'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import { createClient } from '@/lib/supabase/server'

const QuoteIdSchema = z.string().uuid()
const CreditNoteInputSchema = z.object({
  invoiceId: z.string().uuid(),
  reason: z.string().trim().min(1, 'Indiquez le motif de l’avoir.').max(500, 'Le motif ne peut pas dépasser 500 caractères.'),
})

type Result = { invoiceId: string | null; error: string | null }

/** Creates a quote-backed balance draft from the locked quote and its invoice history. */
export async function createQuoteBalanceInvoice(quoteId: string): Promise<Result> {
  if (!(await hasPermission('invoices.create_solde'))) return { invoiceId: null, error: 'Permission refusée.' }

  const parsedQuoteId = QuoteIdSchema.safeParse(quoteId)
  if (!parsedQuoteId.success) return { invoiceId: null, error: 'Devis invalide.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { invoiceId: null, error: 'Non authentifié.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { invoiceId: null, error: 'Organisation introuvable.' }

  const { data, error } = await supabase.rpc('create_quote_balance_invoice', {
    p_quote_id: parsedQuoteId.data,
  })
  if (error || typeof data !== 'string') {
    return { invoiceId: null, error: error?.message ?? 'Impossible de créer le solde de ce devis.' }
  }

  revalidatePath('/finances')
  revalidatePath('/chantiers', 'layout')
  return { invoiceId: data, error: null }
}

/** Creates a positive-line credit-note draft against an immutable issued invoice. */
export async function createInvoiceCreditNote(invoiceId: string, reason: string): Promise<Result> {
  if (!(await hasPermission('invoices.create_credit'))) return { invoiceId: null, error: 'Permission refusée.' }

  const parsed = CreditNoteInputSchema.safeParse({ invoiceId, reason })
  if (!parsed.success) return { invoiceId: null, error: parsed.error.issues[0]?.message ?? 'Données invalides.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { invoiceId: null, error: 'Non authentifié.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { invoiceId: null, error: 'Organisation introuvable.' }

  const { data, error } = await supabase.rpc('create_invoice_credit_note', {
    p_invoice_id: parsed.data.invoiceId,
    p_reason: parsed.data.reason,
  })
  if (error || typeof data !== 'string') {
    return { invoiceId: null, error: error?.message ?? 'Impossible de créer cet avoir.' }
  }

  revalidatePath('/finances')
  revalidatePath('/clients')
  return { invoiceId: data, error: null }
}
