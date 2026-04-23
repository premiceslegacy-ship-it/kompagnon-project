'use server'

import React from 'react'
import { revalidatePath } from 'next/cache'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { getOrganization } from '@/lib/data/queries/organization'
import { getQuoteById } from '@/lib/data/queries/quotes'
import { sendEmail } from '@/lib/email'
import { DEFAULT_EMAIL_TEMPLATES } from '@/lib/data/queries/emailTemplates'
import QuotePDF from '@/components/pdf/QuotePDF'
import type { Client } from '@/lib/data/queries/clients'
import { getClientGreetingName } from '@/lib/client'

type Result = { error: string | null }

// ─── Interpolation helper ──────────────────────────────────────────────────────

function interpolate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, v), template)
}

function wrapHtml(orgName: string, bodyText: string): string {
  const bodyHtml = bodyText.replace(/\n/g, '<br>')
  return `<div style="max-width:560px;margin:0 auto;font-family:sans-serif"><div style="background:#0a0a0a;padding:24px 32px;border-radius:12px 12px 0 0"><p style="color:white;font-weight:bold;margin:0;font-size:16px">${orgName}</p></div><div style="background:white;padding:32px;border-radius:0 0 12px 12px;border:1px solid #eee;border-top:none;line-height:1.7;color:#333;font-size:14px">${bodyHtml}</div></div>`
}

// ─── Envoyer une relance facture ───────────────────────────────────────────────

export async function sendInvoiceReminder(
  invoiceId: string,
  aiDraft?: { subject: string; body: string },
): Promise<Result> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  // Charger facture + client + org + template personnalisé
  const [
    { data: invoice },
    { data: org },
  ] = await Promise.all([
    supabase.from('invoices').select('id, number, total_ttc, currency, due_date, client_id').eq('id', invoiceId).eq('organization_id', orgId).single(),
    supabase.from('organizations').select('name, email, email_from_address').eq('id', orgId).single(),
  ])

  if (!invoice) return { error: 'Facture introuvable.' }
  if (!org) return { error: 'Organisation introuvable.' }

  // Compter les relances existantes pour choisir niveau 1 ou 2
  const { count } = await supabase
    .from('reminders')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('invoice_id', invoiceId)

  const rank = (count ?? 0) + 1
  const slug = rank >= 2 ? 'payment_reminder_2' : 'payment_reminder_1'

  // Template DB ou défaut
  const { data: customTpl } = await supabase
    .from('email_templates')
    .select('subject, body_text')
    .eq('organization_id', orgId)
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle()

  let subject: string
  let html: string
  let clientEmail: string | null = null
  let clientName = 'Client'

  if (invoice.client_id) {
    const { data: client } = await supabase
      .from('clients')
      .select('company_name, contact_name, first_name, last_name, email')
      .eq('id', invoice.client_id)
      .single()
    if (client) {
      clientName = getClientGreetingName(client as any)
      clientEmail = (client as any).email ?? null
    }
  }

  const fmtAmount = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: invoice.currency ?? 'EUR' }).format(invoice.total_ttc ?? 0)
  const fmtDate = invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : ''

  const vars: Record<string, string> = {
    numero_facture: invoice.number ?? '',
    client_nom: clientName,
    montant_ttc: fmtAmount,
    date_echeance: fmtDate,
    entreprise_nom: org.name,
  }

  let bodyText: string

  if (aiDraft) {
    subject = aiDraft.subject
    bodyText = aiDraft.body
    html = wrapHtml(org.name, aiDraft.body.replace(/\n/g, '<br>'))
  } else {
    const defaultTpl = DEFAULT_EMAIL_TEMPLATES.find(t => t.slug === slug)
    const tpl = customTpl ?? defaultTpl
    if (!tpl) return { error: 'Template introuvable.' }
    subject = interpolate(tpl.subject, vars)
    bodyText = interpolate(tpl.body_text, vars)
    html = wrapHtml(org.name, bodyText)
  }

  // Envoyer l'email si le client a une adresse
  if (clientEmail) {
    await sendEmail({ organizationId: orgId, to: clientEmail, subject, html })
      .catch(err => console.error('[sendInvoiceReminder] email error:', err))
  }

  // Logger la relance dans la table reminders
  await supabase.from('reminders').insert({
    organization_id: orgId,
    invoice_id: invoiceId,
    client_id: invoice.client_id ?? null,
    type: 'payment_reminder',
    rank,
    sent_at: new Date().toISOString(),
    sent_by: user.id,
    is_auto: false,
    email_subject: subject,
    email_body: bodyText,
  })

  revalidatePath('/reminders')
  return { error: null }
}

// ─── Envoyer une relance devis ─────────────────────────────────────────────────

export async function sendQuoteFollowup(
  quoteId: string,
  aiDraft?: { subject: string; body: string },
): Promise<Result> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const [
    { data: quote },
    { data: org },
    fullQuote,
    organization,
  ] = await Promise.all([
    supabase.from('quotes').select('id, number, title, total_ttc, currency, client_id, signature_token, notes_client, payment_conditions').eq('id', quoteId).eq('organization_id', orgId).single(),
    supabase.from('organizations').select('name, email, email_from_address').eq('id', orgId).single(),
    getQuoteById(quoteId),
    getOrganization(),
  ])

  if (!quote) return { error: 'Devis introuvable.' }
  if (!org) return { error: 'Organisation introuvable.' }

  let clientEmail: string | null = null
  let clientName = 'Client'
  let clientData: Client | null = null

  if (quote.client_id) {
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', quote.client_id)
      .single()
    if (client) {
      clientData = client as unknown as Client
      clientName = getClientGreetingName(client as any)
      clientEmail = (client as any).email ?? null
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const signUrl = quote.signature_token ? `${appUrl}/sign/${quote.signature_token}` : ''

  const fmtAmount = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: quote.currency ?? 'EUR' }).format(quote.total_ttc ?? 0)

  const vars: Record<string, string> = {
    numero_devis: quote.number ?? '',
    client_nom: clientName,
    montant_ttc: fmtAmount,
    entreprise_nom: org.name,
    lien_signature: signUrl,
  }

  let subject: string
  let bodyText: string
  let html: string

  if (aiDraft) {
    subject = aiDraft.subject
    bodyText = aiDraft.body
    html = wrapHtml(org.name, aiDraft.body.replace(/\n/g, '<br>'))
  } else {
    const { data: customTpl } = await supabase
      .from('email_templates')
      .select('subject, body_text')
      .eq('organization_id', orgId)
      .eq('slug', 'quote_sent')
      .eq('is_active', true)
      .maybeSingle()

    const defaultTpl = DEFAULT_EMAIL_TEMPLATES.find(t => t.slug === 'quote_sent')
    const tpl = customTpl ?? defaultTpl
    if (!tpl) return { error: 'Template introuvable.' }

    subject = interpolate(tpl.subject, vars)
    bodyText = interpolate(tpl.body_text, vars)
    html = wrapHtml(org.name, bodyText)
  }

  // Générer le PDF du devis en pièce jointe
  let attachments: Array<{ filename: string; content: Buffer }> | undefined
  if (fullQuote && organization) {
    try {
      const pdfBuffer = await renderToBuffer(
        React.createElement(QuotePDF, {
          quote: fullQuote,
          organization,
          client: clientData,
        }) as any,
      )
      attachments = [{ filename: `devis-${quote.number ?? quoteId}.pdf`, content: Buffer.from(pdfBuffer) }]
    } catch (pdfErr) {
      console.error('[sendQuoteFollowup] PDF generation error:', pdfErr)
    }
  }

  if (clientEmail) {
    await sendEmail({ organizationId: orgId, to: clientEmail, subject, html, attachments })
      .catch(err => console.error('[sendQuoteFollowup] email error:', err))
  }

  // Logger
  await supabase.from('reminders').insert({
    organization_id: orgId,
    quote_id: quoteId,
    client_id: quote.client_id ?? null,
    type: 'quote_followup',
    rank: 1,
    sent_at: new Date().toISOString(),
    sent_by: user.id,
    is_auto: false,
    email_subject: subject,
    email_body: bodyText,
  })

  revalidatePath('/reminders')
  return { error: null }
}

// ─── Marquer un devis comme accepté ───────────────────────────────────────────

export async function markQuoteAccepted(quoteId: string): Promise<Result> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { error } = await supabase
    .from('quotes')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', quoteId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/reminders')
  revalidatePath('/finances')
  revalidatePath('/dashboard')
  return { error: null }
}

// ─── Marquer un devis comme refusé ────────────────────────────────────────────

export async function markQuoteRefused(quoteId: string): Promise<Result> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { error } = await supabase
    .from('quotes')
    .update({ status: 'refused' })
    .eq('id', quoteId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/reminders')
  revalidatePath('/finances')
  return { error: null }
}
