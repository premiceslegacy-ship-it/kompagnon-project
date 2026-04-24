'use server'

import React from 'react'
import { revalidatePath } from 'next/cache'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { getInvoiceById } from '@/lib/data/queries/invoices'
import { getOrganization } from '@/lib/data/queries/organization'
import { sendEmail } from '@/lib/email'
import { buildInvoicePaidEmail, buildDepositInvoiceEmail } from '@/lib/email/templates'
import { getClientGreetingName } from '@/lib/client'
import { DEFAULT_EMAIL_TEMPLATES } from '@/lib/data/queries/emailTemplates'
import InvoicePDF from '@/components/pdf/InvoicePDF'
import { coerceLegalVatRate } from '@/lib/utils'

type Result = { error: string | null }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function interpolate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, v), template)
}

function wrapHtml(orgName: string, bodyText: string): string {
  const bodyHtml = bodyText.replace(/\n/g, '<br>')
  return `<div style="max-width:560px;margin:0 auto;font-family:sans-serif"><div style="background:#0a0a0a;padding:24px 32px;border-radius:12px 12px 0 0"><p style="color:white;font-weight:bold;margin:0;font-size:16px">${orgName}</p></div><div style="background:white;padding:32px;border-radius:0 0 12px 12px;border:1px solid #eee;border-top:none;line-height:1.7;color:#333;font-size:14px">${bodyHtml}</div></div>`
}

// ─── Save invoice items ────────────────────────────────────────────────────────

export async function saveInvoiceItems(
  invoiceId: string,
  items: { description: string; quantity: number; unit: string; unit_price: number; vat_rate: number; is_internal?: boolean; length_m?: number | null; width_m?: number | null; height_m?: number | null; material_id?: string | null }[],
  meta: {
    clientId: string | null
    issueDate: string
    dueDate: string
    title?: string | null
    quoteId?: string | null
  },
): Promise<Result> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  // Vérifier que la facture appartient à l'org
  const { data: inv } = await supabase
    .from('invoices')
    .select('id')
    .eq('id', invoiceId)
    .eq('organization_id', orgId)
    .single()
  if (!inv) return { error: 'Facture introuvable.' }

  // Supprimer les lignes existantes
  await supabase.from('invoice_items').delete().eq('invoice_id', invoiceId)

  // Insérer les nouvelles lignes
  if (items.length > 0) {
    const rows = items.map((item, idx) => ({
      invoice_id: invoiceId,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit || null,
      unit_price: item.unit_price,
      vat_rate: coerceLegalVatRate(item.vat_rate, 20),
      is_internal: item.is_internal ?? false,
      length_m: item.length_m ?? null,
      width_m: item.width_m ?? null,
      height_m: item.height_m ?? null,
      material_id: item.material_id ?? null,
      position: idx,
    }))
    const { error: insertError } = await supabase.from('invoice_items').insert(rows)
    if (insertError) return { error: insertError.message }
  }

  // Recalculer les totaux (lignes internes exclues du total client)
  const normalizedItems = items.map(item => ({ ...item, vat_rate: coerceLegalVatRate(item.vat_rate, 20) }))
  const clientItems = normalizedItems.filter(i => !i.is_internal)
  const totalHt = clientItems.reduce((sum, i) => sum + i.quantity * i.unit_price, 0)
  const totalTva = clientItems.reduce((sum, i) => sum + i.quantity * i.unit_price * (i.vat_rate / 100), 0)
  const totalTtc = totalHt + totalTva

  const { error: updateError } = await supabase
    .from('invoices')
    .update({
      client_id: meta.clientId || null,
      issue_date: meta.issueDate,
      due_date: meta.dueDate,
      title: meta.title || 'Facture',
      quote_id: meta.quoteId ?? null,
      total_ht: totalHt,
      total_tva: totalTva,
      total_ttc: totalTtc,
    })
    .eq('id', invoiceId)
    .eq('organization_id', orgId)

  if (updateError) return { error: updateError.message }
  revalidatePath('/finances')
  return { error: null }
}

// ─── Mark as paid ─────────────────────────────────────────────────────────────

/**
 * Enregistre le paiement d'une facture (paiement total).
 * Met le statut à 'paid', enregistre la date de paiement,
 * et envoie un email de remerciement au client.
 */
export async function markInvoicePaid(invoiceId: string): Promise<Result> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const paidAt = new Date()

  const { error } = await supabase
    .from('invoices')
    .update({ status: 'paid', paid_at: paidAt.toISOString() })
    .eq('id', invoiceId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

  // Charger les infos de la facture + client + org pour l'email
  const { data: invoice } = await supabase
    .from('invoices')
    .select('number, title, total_ttc, currency, client_id')
    .eq('id', invoiceId)
    .single()

  if (invoice?.client_id) {
    const [{ data: client }, { data: org }, { data: customTpl }] = await Promise.all([
      supabase.from('clients').select('company_name, contact_name, first_name, last_name, email').eq('id', invoice.client_id).single(),
      supabase.from('organizations').select('name, email, email_from_address').eq('id', orgId).single(),
      supabase.from('email_templates').select('subject, body_text').eq('organization_id', orgId).eq('slug', 'invoice_paid').eq('is_active', true).maybeSingle(),
    ])

    if (client && org && (client as any).email) {
      const clientName = getClientGreetingName(client as any)

      let subject: string
      let html: string

      if (customTpl?.body_text) {
        const vars: Record<string, string> = {
          numero_facture: invoice.number ?? '',
          client_nom: clientName,
          montant_ttc: new Intl.NumberFormat('fr-FR', { style: 'currency', currency: invoice.currency ?? 'EUR' }).format(invoice.total_ttc ?? 0),
          entreprise_nom: org.name,
        }
        const interpolate = (t: string) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, v), t)
        subject = interpolate(customTpl.subject ?? '')
        const bodyHtml = interpolate(customTpl.body_text).replace(/\n/g, '<br>')
        html = `<div style="max-width:560px;margin:0 auto;font-family:sans-serif"><div style="background:#0a0a0a;padding:24px 32px;border-radius:12px 12px 0 0"><p style="color:white;font-weight:bold;margin:0;font-size:16px">${org.name}</p></div><div style="background:white;padding:32px;border-radius:0 0 12px 12px;border:1px solid #eee;border-top:none;line-height:1.7;color:#333;font-size:14px">${bodyHtml}</div></div>`
      } else {
        const built = buildInvoicePaidEmail({
          orgName: org.name,
          orgEmail: org.email,
          clientName,
          invoiceNumber: invoice.number,
          invoiceTitle: invoice.title,
          totalTtc: invoice.total_ttc,
          currency: invoice.currency ?? 'EUR',
          paidAt,
        })
        subject = built.subject
        html = built.html
      }

      await sendEmail({
        organizationId: orgId,
        to: (client as any).email,
        subject,
        html,
      }).catch(err => console.error('[markInvoicePaid] email error:', err))
    }
  }

  revalidatePath('/finances')
  revalidatePath('/clients')
  return { error: null }
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createInvoice(data: {
  clientId?: string | null
  title?: string
  currency?: string
  quoteId?: string | null
}): Promise<{ invoiceId: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { invoiceId: null, error: 'Non authentifié.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { invoiceId: null, error: 'Organisation introuvable.' }

  const { data: invoice, error } = await supabase
    .from('invoices')
    .insert({
      organization_id: orgId,
      client_id: data.clientId ?? null,
      title: data.title ?? 'Nouvelle facture',
      currency: data.currency ?? 'EUR',
      status: 'draft',
      created_by: user.id,
      quote_id: data.quoteId ?? null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createInvoice]', error)
    return { invoiceId: null, error: 'Erreur lors de la création de la facture.' }
  }

  revalidatePath('/finances')
  return { invoiceId: invoice.id, error: null }
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateInvoice(
  invoiceId: string,
  updates: {
    title?: string
    client_id?: string | null
    currency?: string
    payment_terms_days?: number
    notes_client?: string | null
    payment_conditions?: string | null
  },
): Promise<Result> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { error } = await supabase
    .from('invoices')
    .update(updates)
    .eq('id', invoiceId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/finances')
  return { error: null }
}

// ─── Send ─────────────────────────────────────────────────────────────────────

export async function sendInvoice(invoiceId: string): Promise<Result> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const [invoice, organization] = await Promise.all([
    getInvoiceById(invoiceId),
    getOrganization(),
  ])
  if (!invoice) return { error: 'Facture introuvable.' }
  if (!organization) return { error: 'Organisation introuvable.' }

  // Récupérer l'email client
  let clientEmail: string | null = null
  let clientName = 'Client'
  if (invoice.client) {
    clientEmail = invoice.client.email ?? null
    clientName = invoice.client.company_name
      || [invoice.client.first_name, invoice.client.last_name].filter(Boolean).join(' ')
      || 'Client'
  }

  let subject: string
  let html: string

  if (invoice.invoice_type === 'acompte') {
    // Template dédié acompte — mentionne le devis parent et le caractère d'avance
    let quoteNumber: string | null = null
    let quoteTitle: string | null = null
    let depositRate: number | null = null

    if (invoice.quote_id) {
      const { data: parentQuote } = await supabase
        .from('quotes')
        .select('number, title')
        .eq('id', invoice.quote_id)
        .single()
      quoteNumber = parentQuote?.number ?? null
      quoteTitle = parentQuote?.title ?? null
    }

    // Extraire le taux depuis notes_client "Acompte de 30% sur devis n° …"
    const rateMatch = invoice.notes_client?.match(/(\d+)%/)
    if (rateMatch) depositRate = parseInt(rateMatch[1], 10)

    const built = buildDepositInvoiceEmail({
      orgName: organization.name,
      orgEmail: organization.email ?? '',
      clientName,
      invoiceNumber: invoice.number,
      quoteNumber,
      quoteTitle,
      depositRate,
      totalTtc: invoice.total_ttc,
      currency: invoice.currency ?? 'EUR',
      dueDate: invoice.due_date ?? null,
    })
    subject = built.subject
    html = built.html
  } else {
    // Template standard (custom DB ou défaut)
    const { data: customTpl } = await supabase
      .from('email_templates')
      .select('subject, body_text')
      .eq('organization_id', orgId)
      .eq('slug', 'invoice_sent')
      .eq('is_active', true)
      .maybeSingle()

    const defaultTpl = DEFAULT_EMAIL_TEMPLATES.find(t => t.slug === 'invoice_sent')
    const tpl = customTpl ?? defaultTpl
    if (!tpl) return { error: 'Template email introuvable.' }

    const fmtAmount = new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: invoice.currency ?? 'EUR',
    }).format(invoice.total_ttc ?? 0)

    const vars: Record<string, string> = {
      numero_facture: invoice.number ?? '',
      client_nom: clientName,
      montant_ttc: fmtAmount,
      entreprise_nom: organization.name,
    }

    subject = interpolate(tpl.subject, vars)
    html = wrapHtml(organization.name, interpolate(tpl.body_text, vars))
  }

  // Générer le PDF
  let attachments: Array<{ filename: string; content: Buffer }> | undefined
  try {
    const pdfBuffer = await renderToBuffer(
      React.createElement(InvoicePDF, { invoice, organization }) as any,
    )
    attachments = [{ filename: `facture-${invoice.number ?? invoiceId}.pdf`, content: Buffer.from(pdfBuffer) }]
  } catch (pdfErr) {
    console.error('[sendInvoice] PDF generation error:', pdfErr)
  }

  // Envoyer l'email
  if (clientEmail) {
    await sendEmail({ organizationId: orgId, to: clientEmail, subject, html, attachments })
      .catch(err => console.error('[sendInvoice] email error:', err))
  }

  // Marquer comme envoyée
  const { error } = await supabase
    .from('invoices')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', invoiceId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/finances')
  return { error: null }
}

// ─── Générer une facture d'acompte depuis un devis accepté ───────────────────

/**
 * Crée une facture d'acompte liée à un devis accepté.
 * - Copie les items du devis, applique le taux d'acompte
 * - invoice_type = 'acompte', quote_id = devis parent
 * - Redirige vers l'éditeur facture pour révision avant envoi
 */
export async function generateDepositInvoice(
  quoteId: string,
  depositRate: number, // en % (ex: 30 pour 30%)
  dueDate: string | null = null,
  balanceDueDate: string | null = null,
): Promise<{ invoiceId: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { invoiceId: null, error: 'Non authentifié.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { invoiceId: null, error: 'Organisation introuvable.' }

  if (depositRate <= 0 || depositRate > 100) {
    return { invoiceId: null, error: 'Taux d\'acompte invalide (1-100%).' }
  }

  // Charger le devis avec ses lignes (is_internal obligatoire pour filtrer les coûts internes)
  const { data: quote } = await supabase
    .from('quotes')
    .select(`
      id, number, title, status, total_ht, total_tva, total_ttc, currency,
      client_id, payment_conditions,
      items:quote_items(description, quantity, unit, unit_price, vat_rate, position, is_internal)
    `)
    .eq('id', quoteId)
    .eq('organization_id', orgId)
    .single()

  if (!quote) return { invoiceId: null, error: 'Devis introuvable.' }
  if (quote.status !== 'accepted' && quote.status !== 'converted') {
    return { invoiceId: null, error: 'Le devis doit être accepté pour générer un acompte.' }
  }

  const ratio = depositRate / 100
  // Les totaux du devis excluent déjà les items internes — on les utilise directement
  const depositHt = Math.round((quote.total_ht ?? 0) * ratio * 100) / 100
  const depositTva = Math.round((quote.total_tva ?? 0) * ratio * 100) / 100
  const depositTtc = Math.round((quote.total_ttc ?? 0) * ratio * 100) / 100

  const quoteNum = quote.number ?? quoteId.slice(0, 8)
  const title = `Acompte ${depositRate}% · ${quote.title ?? `Devis ${quoteNum}`}`

  // Créer la facture d'acompte
  const { data: invoice, error: createErr } = await supabase
    .from('invoices')
    .insert({
      organization_id: orgId,
      client_id: quote.client_id ?? null,
      quote_id: quoteId,
      invoice_type: 'acompte',
      title,
      currency: quote.currency ?? 'EUR',
      status: 'draft',
      created_by: user.id,
      total_ht: depositHt,
      total_tva: depositTva,
      total_ttc: depositTtc,
      payment_conditions: quote.payment_conditions ?? null,
      notes_client: `Acompte de ${depositRate}% sur devis n° ${quoteNum}`,
      due_date: dueDate ?? null,
      balance_due_date: balanceDueDate ?? null,
    })
    .select('id')
    .single()

  if (createErr || !invoice) {
    console.error('[generateDepositInvoice]', createErr)
    return { invoiceId: null, error: 'Erreur lors de la création de la facture d\'acompte.' }
  }

  // Copier les lignes du devis avec les montants proratisés
  // Les items internes sont copiés avec is_internal=true → masqués du PDF client
  const items = (quote.items ?? []) as any[]
  if (items.length > 0) {
    const rows = items.map((item: any, idx: number) => ({
      invoice_id: invoice.id,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unit_price: Math.round(item.unit_price * ratio * 100) / 100,
      vat_rate: item.vat_rate,
      is_internal: item.is_internal ?? false,
      position: idx,
    }))
    await supabase.from('invoice_items').insert(rows)
  }

  revalidatePath('/finances')
  return { invoiceId: invoice.id, error: null }
}

// ─── Archive ──────────────────────────────────────────────────────────────────

export async function archiveInvoice(invoiceId: string): Promise<Result> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { error } = await supabase
    .from('invoices')
    .update({ status: 'cancelled' })
    .eq('id', invoiceId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/finances')
  return { error: null }
}
