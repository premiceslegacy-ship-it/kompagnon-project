'use server'

import React from 'react'
import { revalidatePath } from 'next/cache'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import {
  CreateInvoiceSchema,
  UpdateInvoiceSchema,
  SaveInvoiceItemsSchema,
  GenerateDepositSchema,
} from '@/lib/validations/invoices'
import { getInvoiceById } from '@/lib/data/queries/invoices'
import { getOrganization } from '@/lib/data/queries/organization'
import { sendEmail } from '@/lib/email'
import { buildInvoicePaidEmail, buildDepositInvoiceEmail } from '@/lib/email/templates'
import { getClientGreetingName } from '@/lib/client'
import { DEFAULT_EMAIL_TEMPLATES } from '@/lib/data/queries/emailTemplates'
import { sendPushToOrg } from '@/lib/push'
import InvoicePDF from '@/components/pdf/InvoicePDF'
import { coerceLegalVatRate } from '@/lib/utils'
import { hasPermission } from '@/lib/data/queries/membership'
import { renderInvoicePdfBufferById, renderContractPdfBufferById } from '@/lib/pdf/server'
import { syncInvoiceMemoryEntry } from '@/lib/data/mutations/document-memory'

type Result = { error: string | null }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function interpolate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, v), template)
}

function wrapHtml(orgName: string, bodyText: string): string {
  const bodyHtml = bodyText.replace(/\n/g, '<br>')
  return `<div style="max-width:560px;margin:0 auto;font-family:sans-serif"><div style="background:#0a0a0a;padding:24px 32px;border-radius:12px 12px 0 0"><p style="color:white;font-weight:bold;margin:0;font-size:16px">${orgName}</p></div><div style="background:white;padding:32px;border-radius:0 0 12px 12px;border:1px solid #eee;border-top:none;line-height:1.7;color:#333;font-size:14px">${bodyHtml}</div></div>`
}

type ProratedInvoiceRow = {
  invoice_id: string
  description: string
  quantity: number
  unit: string | null
  unit_price: number
  vat_rate: number
  is_internal: boolean
  position: number
}

function roundMoney(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100
}

function buildProratedInvoiceRows(invoiceId: string, items: any[], ratio: number): ProratedInvoiceRow[] {
  return items.map((item: any, idx: number) => ({
    invoice_id: invoiceId,
    description: item.description,
    quantity: Number(item.quantity) || 0,
    unit: item.unit ?? null,
    unit_price: roundMoney((Number(item.unit_price) || 0) * ratio),
    unit_cost_ht: item.unit_cost_ht ?? null,
    vat_rate: coerceLegalVatRate(Number(item.vat_rate), 20),
    is_internal: item.is_internal ?? false,
    position: idx,
  }))
}

function calculateInvoiceTotals(rows: ProratedInvoiceRow[]) {
  const clientRows = rows.filter(row => !row.is_internal)
  const totalHt = roundMoney(clientRows.reduce((sum, row) => sum + row.quantity * row.unit_price, 0))
  const totalTva = roundMoney(clientRows.reduce((sum, row) => sum + row.quantity * row.unit_price * (row.vat_rate / 100), 0))
  return {
    totalHt,
    totalTva,
    totalTtc: roundMoney(totalHt + totalTva),
  }
}

// ─── Save invoice items ────────────────────────────────────────────────────────

export async function saveInvoiceItems(
  invoiceId: string,
  items: { description: string; quantity: number; unit: string; unit_price: number; unit_cost_ht?: number | null; vat_rate: number; is_internal?: boolean; length_m?: number | null; width_m?: number | null; height_m?: number | null; dim_quantity?: number; material_id?: string | null }[],
  meta: {
    clientId: string | null
    issueDate: string
    dueDate: string
    title?: string | null
    quoteId?: string | null
    chantierId?: string | null
    aidLabel?: string | null
    aidAmount?: number | null
  },
): Promise<Result> {
  if (!(await hasPermission('invoices.edit'))) return { error: 'Permission refusée.' }

  const parsed = SaveInvoiceItemsSchema.safeParse({ invoiceId, items, meta })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Données invalides.' }

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
      unit_cost_ht: item.unit_cost_ht ?? null,
      vat_rate: coerceLegalVatRate(item.vat_rate, 20),
      is_internal: item.is_internal ?? false,
      length_m: item.length_m ?? null,
      width_m: item.width_m ?? null,
      height_m: item.height_m ?? null,
      dim_quantity: item.dim_quantity ?? 1,
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
      chantier_id: meta.chantierId ?? null,
      aid_label: meta.aidLabel ?? null,
      aid_amount: meta.aidAmount ?? null,
      total_ht: totalHt,
      total_tva: totalTva,
      total_ttc: totalTtc,
    })
    .eq('id', invoiceId)
    .eq('organization_id', orgId)

  if (updateError) return { error: updateError.message }
  await syncInvoiceMemoryEntry(supabase, orgId, invoiceId)
  revalidatePath('/finances')
  return { error: null }
}

// ─── Mark as paid ─────────────────────────────────────────────────────────────

/**
 * Enregistre le paiement d'une facture (paiement total).
 * Met le statut à 'paid', enregistre la date de paiement,
 * et envoie un email de remerciement au client.
 */
export async function markInvoicePaid(invoiceId: string): Promise<Result & { total_paid?: number; paid_at?: string }> {
  if (!(await hasPermission('invoices.record_payment'))) return { error: 'Permission refusée.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const paidAt = new Date()
  const paymentDate = paidAt.toISOString().split('T')[0]

  const { data: invoiceBeforePayment, error: invoiceError } = await supabase
    .from('invoices')
    .select('id, number, title, status, total_ttc, total_paid, currency, client_id')
    .eq('id', invoiceId)
    .eq('organization_id', orgId)
    .single()

  if (invoiceError || !invoiceBeforePayment) return { error: invoiceError?.message ?? 'Facture introuvable.' }
  if (!['sent', 'partial'].includes(invoiceBeforePayment.status)) {
    return { error: 'Cette facture ne peut pas être marquée comme payée.' }
  }

  const { data: existingPayments, error: paymentsError } = await supabase
    .from('payments')
    .select('amount')
    .eq('invoice_id', invoiceId)
    .eq('organization_id', orgId)

  if (paymentsError) return { error: paymentsError.message }

  const totalTtc = roundMoney(invoiceBeforePayment.total_ttc ?? 0)
  const paymentsTotal = roundMoney(
    (existingPayments ?? []).reduce((sum, payment) => sum + (payment.amount ?? 0), 0)
  )
  const alreadyPaid = Math.max(paymentsTotal, roundMoney(invoiceBeforePayment.total_paid ?? 0))
  const amountToRecord = roundMoney(Math.max(0, totalTtc - alreadyPaid))

  if (amountToRecord > 0) {
    const { error: paymentError } = await supabase
      .from('payments')
      .insert({
        organization_id: orgId,
        invoice_id: invoiceId,
        client_id: invoiceBeforePayment.client_id,
        amount: amountToRecord,
        payment_date: paymentDate,
        method: 'manual',
        notes: 'Paiement total enregistré depuis la liste des factures',
        created_by: user.id,
      })

    if (paymentError) return { error: paymentError.message }
  }

  const totalPaid = roundMoney(alreadyPaid + amountToRecord)

  const { error } = await supabase
    .from('invoices')
    .update({ status: 'paid', total_paid: totalPaid, paid_at: paidAt.toISOString() })
    .eq('id', invoiceId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  await syncInvoiceMemoryEntry(supabase, orgId, invoiceId)

  // Charger les infos de la facture + client + org pour l'email
  const { data: invoice } = await supabase
    .from('invoices')
    .select('number, title, total_ttc, currency, client_id')
    .eq('id', invoiceId)
    .single()

  if (invoice?.client_id) {
    const [{ data: client }, { data: org }, { data: customTpl }] = await Promise.all([
      supabase.from('clients').select('company_name, contact_name, first_name, last_name, email').eq('id', invoice.client_id).single(),
      supabase.from('organizations').select('name, email, email_from_address, email_signature').eq('id', orgId).single(),
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
          emailSignature: (org as any).email_signature ?? null,
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

  const invoiceNum = invoiceBeforePayment.number ?? invoiceId.slice(0, 8)
  const invoiceTitle = invoiceBeforePayment.title ?? null
  const clientForPush = invoice?.client_id
    ? await supabase.from('clients').select('company_name, contact_name').eq('id', invoice.client_id).maybeSingle().then(r => r.data)
    : null
  const clientLabel = clientForPush?.company_name ?? clientForPush?.contact_name ?? null
  const bodyParts = [
    clientLabel,
    invoiceTitle,
    `${totalPaid.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`,
  ].filter(Boolean)
  sendPushToOrg(orgId, {
    title: `Facture ${invoiceNum} réglée`,
    body: bodyParts.join(' · '),
    url: '/finances',
  }, user.id).catch(() => {})

  revalidatePath('/finances')
  revalidatePath('/clients')
  revalidatePath('/dashboard')
  return { error: null, total_paid: totalPaid, paid_at: paidAt.toISOString() }
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createInvoice(data: {
  clientId?: string | null
  title?: string
  currency?: string
  quoteId?: string | null
  chantierId?: string | null
}): Promise<{ invoiceId: string | null; error: string | null }> {
  if (!(await hasPermission('invoices.create'))) return { invoiceId: null, error: 'Permission refusée.' }

  const parsed = CreateInvoiceSchema.safeParse(data)
  if (!parsed.success) return { invoiceId: null, error: parsed.error.issues[0]?.message ?? 'Données invalides.' }

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
      chantier_id: data.chantierId ?? null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createInvoice]', error)
    return { invoiceId: null, error: 'Erreur lors de la création de la facture.' }
  }

  await syncInvoiceMemoryEntry(supabase, orgId, invoice.id)
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
    aid_label?: string | null
    aid_amount?: number | null
  },
): Promise<Result> {
  if (!(await hasPermission('invoices.edit'))) return { error: 'Permission refusée.' }

  const parsed = UpdateInvoiceSchema.safeParse(updates)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Données invalides.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { error } = await supabase
    .from('invoices')
    .update(updates)
    .eq('id', invoiceId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

  await supabase
    .from('invoice_schedules')
    .update({ status: 'sent', confirmed_at: new Date().toISOString() })
    .eq('invoice_id', invoiceId)
    .eq('organization_id', orgId)
    .eq('status', 'pending_confirmation')

  await syncInvoiceMemoryEntry(supabase, orgId, invoiceId)
  revalidatePath('/finances')
  revalidatePath('/finances/recurring')
  return { error: null }
}

// ─── Lier / délier facture ↔ chantier ────────────────────────────────────────

export async function linkInvoiceToChantier(invoiceId: string, chantierId: string | null): Promise<Result> {
  if (!(await hasPermission('invoices.edit'))) return { error: 'Permission refusée.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  if (chantierId) {
    const { data: chantier } = await supabase
      .from('chantiers')
      .select('id')
      .eq('id', chantierId)
      .eq('organization_id', orgId)
      .single()

    if (!chantier) return { error: 'Chantier introuvable.' }
  }

  const { error } = await supabase
    .from('invoices')
    .update({ chantier_id: chantierId })
    .eq('id', invoiceId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  await syncInvoiceMemoryEntry(supabase, orgId, invoiceId)
  revalidatePath('/finances')
  revalidatePath('/chantiers', 'layout')
  return { error: null }
}

// ─── Send ─────────────────────────────────────────────────────────────────────

export async function sendInvoice(invoiceId: string, options?: { attachContractIds?: string[] }): Promise<Result> {
  if (!(await hasPermission('invoices.send'))) return { error: 'Permission refusée.' }

  const supabase = await createClient()
  const admin = createAdminClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const [{ data: invoiceData, error: invoiceError }, organization] = await Promise.all([
    admin
      .from('invoices')
      .select(`
        id, number, title, status, invoice_type, total_ht, total_tva, total_ttc, total_paid, currency,
        issue_date, due_date, sent_at, paid_at, created_at,
        notes_client, payment_conditions, aid_label, aid_amount, quote_id, chantier_id, client_id,
        situation_number, cumulative_pct, period_from, period_to, retention_pct, retention_amount, market_reference,
        client:clients(id, company_name, contact_name, first_name, last_name, email, phone,
          address_line1, postal_code, city, siret, siren, vat_number, type),
        items:invoice_items(id, description, quantity, unit, unit_price, unit_cost_ht, vat_rate, position, length_m, width_m, height_m, dim_quantity, is_internal, material_id),
        payment_schedule:invoice_payment_schedule(id, invoice_id, label, due_date, amount, amount_type, percentage, position, paid_payment_id)
      `)
      .eq('id', invoiceId)
      .eq('organization_id', orgId)
      .order('position', { referencedTable: 'invoice_items', ascending: true })
      .order('position', { referencedTable: 'invoice_payment_schedule', ascending: true })
      .single(),
    getOrganization(),
  ])
  if (invoiceError) {
    console.error('[sendInvoice] invoice lookup error:', invoiceError)
    return { error: `Erreur de chargement de la facture : ${invoiceError.message}` }
  }
  if (!invoiceData) {
    return { error: 'Facture introuvable.' }
  }
  if (!organization) return { error: 'Organisation introuvable.' }
  const invoice = {
    ...invoiceData,
    client: Array.isArray(invoiceData.client) ? invoiceData.client[0] ?? null : invoiceData.client ?? null,
    quote_number: null,
  } as Awaited<ReturnType<typeof getInvoiceById>>
  if (!invoice) return { error: 'Facture introuvable.' }

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
    // Template dédié acompte - mentionne le devis parent et le caractère d'avance
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
      emailSignature: organization.email_signature ?? null,
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
    const rendered = await renderInvoicePdfBufferById(invoiceId, orgId)
    if (rendered) {
      attachments = [{ filename: rendered.fileName, content: rendered.buffer }]
    } else {
      const pdfBuffer = await renderToBuffer(
        React.createElement(InvoicePDF, { invoice, organization }) as any,
      )
      attachments = [{ filename: `facture-${invoice.number ?? invoiceId}.pdf`, content: Buffer.from(pdfBuffer) }]
    }
  } catch (pdfErr) {
    console.error('[sendInvoice] PDF generation error:', pdfErr)
  }

  // Pièces jointes additionnelles : contrats du client lié
  const attachContractIds = (options?.attachContractIds ?? []).filter(Boolean)
  if (attachContractIds.length > 0 && invoice.client_id) {
    const { data: ownedContracts } = await supabase
      .from('contracts')
      .select('id, title, pdf_snapshot')
      .eq('organization_id', orgId)
      .eq('client_id', invoice.client_id)
      .in('id', attachContractIds)
    for (const c of ownedContracts ?? []) {
      if (!c.pdf_snapshot) continue
      const pdf = await renderContractPdfBufferById(c.id, orgId).catch(() => null)
      if (pdf) {
        attachments = [...(attachments ?? []), { filename: pdf.fileName, content: pdf.buffer }]
      }
    }
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
  await syncInvoiceMemoryEntry(supabase, orgId, invoiceId)
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
  depositRate: number,
  dueDate: string | null = null,
  balanceDueDate: string | null = null,
): Promise<{ invoiceId: string | null; error: string | null }> {
  if (!(await hasPermission('invoices.create'))) return { invoiceId: null, error: 'Permission refusée.' }

  const parsed = GenerateDepositSchema.safeParse({ quoteId, depositRate, dueDate, balanceDueDate })
  if (!parsed.success) return { invoiceId: null, error: parsed.error.issues[0]?.message ?? 'Données invalides.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { invoiceId: null, error: 'Non authentifié.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { invoiceId: null, error: 'Organisation introuvable.' }

  // Charger le devis avec ses lignes (is_internal obligatoire pour filtrer les coûts internes)
  const { data: quote } = await supabase
    .from('quotes')
    .select(`
      id, number, title, status, total_ht, total_tva, total_ttc, currency,
      client_id, payment_conditions,
      items:quote_items(description, quantity, unit, unit_price, unit_cost_ht, vat_rate, position, is_internal)
    `)
    .eq('id', quoteId)
    .eq('organization_id', orgId)
    .single()

  if (!quote) return { invoiceId: null, error: 'Devis introuvable.' }
  if (quote.status !== 'accepted' && quote.status !== 'converted') {
    return { invoiceId: null, error: 'Le devis doit être accepté pour générer un acompte.' }
  }

  const { data: chantier } = await supabase
    .from('chantiers')
    .select('id')
    .eq('quote_id', quoteId)
    .eq('organization_id', orgId)
    .maybeSingle()

  const ratio = depositRate / 100
  const items = (quote.items ?? []) as any[]
  const previewRows = buildProratedInvoiceRows('preview', items, ratio)
  const rowTotals = previewRows.length > 0
    ? calculateInvoiceTotals(previewRows)
    : {
        totalHt: roundMoney((quote.total_ht ?? 0) * ratio),
        totalTva: roundMoney((quote.total_tva ?? 0) * ratio),
        totalTtc: roundMoney((quote.total_ttc ?? 0) * ratio),
      }

  const quoteNum = quote.number ?? quoteId.slice(0, 8)
  const title = `Acompte ${depositRate}% · ${quote.title ?? `Devis ${quoteNum}`}`

  // Créer la facture d'acompte
  const { data: invoice, error: createErr } = await supabase
    .from('invoices')
    .insert({
      organization_id: orgId,
      client_id: quote.client_id ?? null,
      quote_id: quoteId,
      chantier_id: chantier?.id ?? null,
      invoice_type: 'acompte',
      title,
      currency: quote.currency ?? 'EUR',
      status: 'draft',
      created_by: user.id,
      total_ht: rowTotals.totalHt,
      total_tva: rowTotals.totalTva,
      total_ttc: rowTotals.totalTtc,
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
  if (items.length > 0) {
    const rows = buildProratedInvoiceRows(invoice.id, items, ratio)
    await supabase.from('invoice_items').insert(rows)
  }

  await syncInvoiceMemoryEntry(supabase, orgId, invoice.id)
  revalidatePath('/finances')
  if (chantier?.id) revalidatePath(`/chantiers/${chantier.id}`)
  return { invoiceId: invoice.id, error: null }
}

// ─── Échéancier de paiement ───────────────────────────────────────────────────

export async function savePaymentSchedule(
  invoiceId: string,
  items: { id?: string; label: string; due_date: string; amount: number; amount_type?: 'amount' | 'percentage'; percentage?: number | null; position: number }[],
): Promise<Result> {
  if (!(await hasPermission('invoices.edit'))) return { error: 'Permission refusée.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { data: inv } = await supabase
    .from('invoices')
    .select('id')
    .eq('id', invoiceId)
    .eq('organization_id', orgId)
    .single()
  if (!inv) return { error: 'Facture introuvable.' }

  const { data: paidSchedule, error: paidErr } = await supabase
    .from('invoice_payment_schedule')
    .select('id')
    .eq('invoice_id', invoiceId)
    .eq('organization_id', orgId)
    .not('paid_payment_id', 'is', null)
  if (paidErr) return { error: paidErr.message }

  const paidIds = new Set((paidSchedule ?? []).map(item => item.id))
  const submittedPaidItems = items.filter(item => item.id && paidIds.has(item.id))
  for (const item of submittedPaidItems) {
    const { error } = await supabase
      .from('invoice_payment_schedule')
      .update({ position: item.position })
      .eq('id', item.id)
      .eq('invoice_id', invoiceId)
      .eq('organization_id', orgId)
      .not('paid_payment_id', 'is', null)
    if (error) return { error: error.message }
  }

  const { error: deleteErr } = await supabase
    .from('invoice_payment_schedule')
    .delete()
    .eq('invoice_id', invoiceId)
    .eq('organization_id', orgId)
    .is('paid_payment_id', null)
  if (deleteErr) return { error: deleteErr.message }

  const unpaidItems = items.filter(item => !item.id || !paidIds.has(item.id))
  if (unpaidItems.some(item => !item.label.trim() || !item.due_date || Number(item.amount) <= 0)) {
    return { error: 'Chaque échéance doit avoir un label, une date et un montant supérieur à 0.' }
  }
  if (unpaidItems.some(item => item.amount_type === 'percentage' && (!(Number(item.percentage) > 0) || Number(item.percentage) > 100))) {
    return { error: 'Chaque échéance en pourcentage doit être comprise entre 0 et 100%.' }
  }

  if (unpaidItems.length > 0) {
    const rows = unpaidItems.map(item => ({
      invoice_id: invoiceId,
      organization_id: orgId,
      label: item.label.trim(),
      due_date: item.due_date,
      amount: item.amount,
      amount_type: item.amount_type ?? 'amount',
      percentage: item.amount_type === 'percentage' ? item.percentage ?? null : null,
      position: item.position,
    }))
    const { error } = await supabase.from('invoice_payment_schedule').insert(rows)
    if (error) return { error: error.message }
  }

  revalidatePath('/finances')
  return { error: null }
}

export async function recordScheduledPayment(
  invoiceId: string,
  scheduleItemId: string,
  payment: { amount: number; payment_date: string; method?: string; reference?: string; notes?: string },
): Promise<Result & { status?: 'partial' | 'paid'; total_paid?: number }> {
  if (!(await hasPermission('invoices.record_payment'))) return { error: 'Permission refusée.' }

  if (Number(payment.amount) <= 0) return { error: 'Le montant encaissé doit être supérieur à 0.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('record_invoice_schedule_payment', {
    p_invoice_id: invoiceId,
    p_schedule_item_id: scheduleItemId,
    p_amount: payment.amount,
    p_payment_date: payment.payment_date,
    p_method: payment.method ?? null,
    p_reference: payment.reference ?? null,
    p_notes: payment.notes ?? null,
  })
  if (error) return { error: error.message }

  const result = data as { status?: 'partial' | 'paid'; total_paid?: number } | null

  const orgId = await getCurrentOrganizationId()
  if (orgId) await syncInvoiceMemoryEntry(supabase, orgId, invoiceId)
  revalidatePath('/finances')
  revalidatePath('/dashboard')
  return { error: null, status: result?.status, total_paid: result?.total_paid }
}

// ─── Archive ──────────────────────────────────────────────────────────────────

export async function archiveInvoice(invoiceId: string): Promise<Result> {
  if (!(await hasPermission('invoices.delete'))) return { error: 'Permission refusée.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { error } = await supabase
    .from('invoices')
    .update({ status: 'cancelled', is_archived: true })
    .eq('id', invoiceId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/finances')
  return { error: null }
}
