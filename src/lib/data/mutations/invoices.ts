'use server'

import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
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
import { renderOrganizationEmail } from '@/lib/email/organization'
import { buildInvoicePaidEmail, buildDepositInvoiceEmail } from '@/lib/email/templates'
import { getClientGreetingName } from '@/lib/client'
import { DEFAULT_EMAIL_TEMPLATES } from '@/lib/data/queries/emailTemplates'
import { sendPushToOrg } from '@/lib/push'
import { logAuditEvent } from '@/lib/audit-log'
import { trackServerEvent } from '@/lib/analytics-server'
import { coerceLegalVatRate } from '@/lib/utils'
import { hasPermission } from '@/lib/data/queries/membership'
import { renderInvoicePdfBufferById, renderContractPdfBufferById } from '@/lib/pdf/server'
import { syncInvoiceMemoryEntry } from '@/lib/data/mutations/document-memory'
import { transmitInvoiceViaSuperPdp } from '@/lib/data/mutations/einvoicing'

type Result = { error: string | null; paTransmission?: { success: boolean; messageId?: string; error?: string } }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function interpolate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, v), template)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function wrapHtml(orgName: string, bodyText: string, logoUrl?: string | null): string {
  const bodyHtml = escapeHtml(bodyText).replace(/\n/g, '<br>')
  return renderOrganizationEmail({ subject: orgName, orgName, logoUrl, bodyHtml: `<div style="line-height:1.7;color:#3b3935;font-size:14px">${bodyHtml}</div>` })
}

type ProratedInvoiceRow = {
  invoice_id: string
  description: string
  quantity: number
  unit: string | null
  unit_price: number
  unit_cost_ht?: number | null
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
    isReverseCharge?: boolean
  },
): Promise<Result> {
  if (!(await hasPermission('invoices.edit'))) return { error: 'Permission refusée.' }

  const parsed = SaveInvoiceItemsSchema.safeParse({ invoiceId, items, meta })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Données invalides.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  // Vérifier que la facture appartient à l'org
  const [{ data: inv }, { data: orgVat }] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, status')
      .eq('id', invoiceId)
      .eq('organization_id', orgId)
      .single(),
    supabase
      .from('organizations')
      .select('is_vat_subject')
      .eq('id', orgId)
      .single(),
  ])
  if (!inv) return { error: 'Facture introuvable.' }
  // Intangibilité : une facture émise ne peut plus voir ses lignes modifiées.
  // Corriger par un avoir. (Garde applicatif ; le trigger DB fait foi en dernier ressort.)
  if (inv.status !== 'draft') {
    return { error: 'Cette facture est émise et ne peut plus être modifiée. Créez un avoir pour la corriger.' }
  }
  const isVatSubject = orgVat?.is_vat_subject !== false
  const normalizeVatRate = (rate: number) => isVatSubject ? coerceLegalVatRate(rate, 20) : 0

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
      vat_rate: normalizeVatRate(item.vat_rate),
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
  const normalizedItems = items.map(item => ({ ...item, vat_rate: normalizeVatRate(item.vat_rate) }))
  const clientItems = normalizedItems.filter(i => !i.is_internal)
  const totalHt = clientItems.reduce((sum, i) => sum + i.quantity * i.unit_price, 0)
  const totalTva = isVatSubject && meta.isReverseCharge !== true
    ? clientItems.reduce((sum, i) => sum + i.quantity * i.unit_price * (i.vat_rate / 100), 0)
    : 0
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
      is_reverse_charge: meta.isReverseCharge ?? false,
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
export async function markInvoicePaid(invoiceId: string): Promise<Result & { total_paid?: number; paid_at?: string | null }> {
  if (!(await hasPermission('invoices.record_payment'))) return { error: 'Permission refusée.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { data, error } = await supabase.rpc('mark_invoice_paid', { p_invoice_id: invoiceId })
  if (error || !data) return { error: error?.message ?? 'Impossible de marquer la facture comme payée.' }

  type PaidInvoiceMetadata = {
    id: string
    number: string | null
    title: string | null
    currency: string | null
    client_id: string | null
    total_ttc: number | null
  }
  type PaidInvoiceMutationResult =
    | { changed: true; amount_recorded: number; total_paid: number; paid_at: string; invoice: PaidInvoiceMetadata }
    | { changed: false; amount_recorded: number; total_paid: number; paid_at: string | null; invoice: PaidInvoiceMetadata }
  const payment = data as PaidInvoiceMutationResult

  if (payment.changed) {
    const paidAt = new Date(payment.paid_at)
    const invoice = payment.invoice

    await syncInvoiceMemoryEntry(supabase, orgId, invoiceId)
    logAuditEvent({
      organizationId: orgId,
      actorId: user.id,
      action: 'audit.invoice.paid',
      entityType: 'invoice',
      entityId: invoiceId,
      metadata: { number: invoice.number, amount: payment.amount_recorded, total_paid: payment.total_paid },
    }).catch(() => {})
    await trackServerEvent(user.id, 'invoice_paid', {
      organization_id: orgId,
      amount: payment.amount_recorded,
    })

    if (invoice.client_id) {
      const [{ data: client }, { data: org }, { data: customTpl }] = await Promise.all([
        supabase.from('clients').select('company_name, contact_name, first_name, last_name, email').eq('id', invoice.client_id).single(),
        supabase.from('organizations').select('name, email, email_from_address, email_signature, logo_url').eq('id', orgId).single(),
        supabase.from('email_templates').select('subject, body_text').eq('organization_id', orgId).eq('slug', 'invoice_paid').eq('is_active', true).maybeSingle(),
      ])

      const recipient = client as {
        type?: string | null
        company_name: string | null
        contact_name: string | null
        first_name: string | null
        last_name: string | null
        email: string | null
      } | null
      const sender = org as {
        name: string
        email: string
        email_signature: string | null
        logo_url: string | null
      } | null
      if (recipient && sender && recipient.email) {
        const clientName = getClientGreetingName(recipient)
        let subject: string
        let html: string

        if (customTpl?.body_text) {
          const vars: Record<string, string> = {
            numero_facture: invoice.number ?? '',
            client_nom: clientName,
            montant_ttc: new Intl.NumberFormat('fr-FR', { style: 'currency', currency: invoice.currency ?? 'EUR' }).format(invoice.total_ttc ?? 0),
            entreprise_nom: sender.name,
            email_org: sender.email ?? '',
          }
          const interpolate = (t: string) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, v), t)
          subject = interpolate(customTpl.subject ?? '')
          html = wrapHtml(sender.name, interpolate(customTpl.body_text), sender.logo_url)
        } else {
          const built = buildInvoicePaidEmail({
            orgName: sender.name,
            logoUrl: sender.logo_url,
            orgEmail: sender.email,
            clientName,
            invoiceNumber: invoice.number,
            invoiceTitle: invoice.title,
            totalTtc: invoice.total_ttc,
            currency: invoice.currency ?? 'EUR',
            paidAt,
            emailSignature: sender.email_signature,
          })
          subject = built.subject
          html = built.html
        }

        const paidMail = await sendEmail({
          organizationId: orgId,
          to: recipient.email,
          subject,
          html,
        }).catch((err): { error: string | null } => ({ error: String(err) }))
        if (paidMail.error) console.error('[markInvoicePaid] email error:', paidMail.error)
      }
    }

    const invoiceNum = invoice.number ?? invoiceId.slice(0, 8)
    const clientForPush = invoice.client_id
      ? await supabase.from('clients').select('company_name, contact_name').eq('id', invoice.client_id).maybeSingle().then(r => r.data)
      : null
    const clientLabel = clientForPush?.company_name ?? clientForPush?.contact_name ?? null
    const bodyParts = [
      clientLabel,
      invoice.title,
      `${payment.total_paid.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`,
    ].filter(Boolean)
    sendPushToOrg(orgId, {
      title: `Facture ${invoiceNum} réglée`,
      body: bodyParts.join(' · '),
      url: '/finances',
    }, user.id).catch(() => {})
  }

  revalidatePath('/finances')
  revalidatePath('/clients')
  revalidatePath('/dashboard')
  return { error: null, total_paid: payment.total_paid, paid_at: payment.paid_at }
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
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  // The admin client is created only after session permission and tenant scope
  // have been verified; every privileged query below is organization-scoped.
  const admin = createAdminClient()
  const { data: invoiceData, error: invoiceError } = await admin
    .from('invoices')
    .select(`
      id, number, title, status, invoice_type, total_ht, total_tva, total_ttc, total_paid, currency,
      issue_date, due_date, sent_at, paid_at, created_at,
      notes_client, payment_conditions, aid_label, aid_amount, quote_id, chantier_id, client_id,
      situation_number, cumulative_pct, period_from, period_to, retention_pct, retention_amount, market_reference, is_reverse_charge,
      client:clients(id, company_name, contact_name, first_name, last_name, email, phone,
        address_line1, postal_code, city, siret, siren, vat_number, type),
      items:invoice_items(id, description, quantity, unit, unit_price, unit_cost_ht, vat_rate, position, length_m, width_m, height_m, dim_quantity, is_internal, material_id),
      payment_schedule:invoice_payment_schedule(id, invoice_id, label, due_date, amount, amount_type, percentage, position, paid_payment_id)
    `)
    .eq('id', invoiceId)
    .eq('organization_id', orgId)
    .order('position', { referencedTable: 'invoice_items', ascending: true })
    .order('position', { referencedTable: 'invoice_payment_schedule', ascending: true })
    .single()
  if (invoiceError) {
    console.error('[sendInvoice] invoice lookup error:', invoiceError)
    return { error: `Erreur de chargement de la facture : ${invoiceError.message}` }
  }
  if (!invoiceData) return { error: 'Facture introuvable.' }

  const previousStatus = invoiceData.status
  if (previousStatus === 'sending') return { error: 'Cette facture est déjà en cours d’envoi.' }
  if (previousStatus !== 'draft' && previousStatus !== 'sent' && previousStatus !== 'partial' && previousStatus !== 'paid') {
    return { error: 'Cette facture ne peut pas être envoyée dans son état actuel.' }
  }

  // Draft claims coordinate with the recurring-invoice cron through the
  // existing lifecycle status. Issued resends use a separate service-only
  // claim so they never rewrite the financial lifecycle.
  let resendClaimToken: string | null = null
  if (previousStatus === 'draft') {
    const { data: claimed, error: claimError } = await admin
      .from('invoices')
      .update({ status: 'sending' })
      .eq('id', invoiceId)
      .eq('organization_id', orgId)
      .eq('status', 'draft')
      .select('id')
      .maybeSingle()
    if (claimError) return { error: claimError.message }
    if (!claimed) return { error: 'Cette facture est déjà en cours d’envoi ou son état a changé.' }
  } else {
    const token = randomUUID()
    const { data: claimed, error: claimError } = await admin
      .from('invoice_resend_delivery_claims')
      .insert({ invoice_id: invoiceId, claim_token: token })
      .select('invoice_id')
      .maybeSingle()
    if (claimError) {
      if (claimError.code === '23505') return { error: 'Cette facture est déjà en cours de renvoi ou nécessite une réconciliation.' }
      return { error: claimError.message }
    }
    if (!claimed) return { error: 'Impossible de réserver le renvoi de cette facture.' }
    resendClaimToken = token
  }

  const releaseResendClaim = async () => {
    if (!resendClaimToken) return null
    const { error } = await admin
      .from('invoice_resend_delivery_claims')
      .delete()
      .eq('invoice_id', invoiceId)
      .eq('claim_token', resendClaimToken)
    if (error) {
      console.error('[sendInvoice] release resend claim:', error.message)
      return error.message
    }
    return null
  }

  let deliveryAttempted = false
  try {
    const organization = await getOrganization()
    if (!organization) throw new Error('Organisation introuvable.')
    const invoice = {
      ...invoiceData,
      client: Array.isArray(invoiceData.client) ? invoiceData.client[0] ?? null : invoiceData.client ?? null,
      quote_number: null,
    } as Awaited<ReturnType<typeof getInvoiceById>>
    if (!invoice) throw new Error('Facture introuvable.')

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
      logoUrl: organization.logo_url,
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
    if (!tpl) throw new Error('Template email introuvable.')

    const fmtAmount = new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: invoice.currency ?? 'EUR',
    }).format(invoice.total_ttc ?? 0)

    const vars: Record<string, string> = {
      numero_facture: invoice.number ?? '',
      client_nom: clientName,
      montant_ttc: fmtAmount,
      entreprise_nom: organization.name,
      email_org: organization.email ?? '',
    }

    subject = interpolate(tpl.subject, vars)
    html = wrapHtml(organization.name, interpolate(tpl.body_text, vars), organization.logo_url)
  }

  // Issuing an invoice requires the shared renderer and its immutable authority.
  // Missing snapshots and render failures abort before any provider dispatch.
  const rendered = await renderInvoicePdfBufferById(invoiceId, orgId)
  if (!rendered) throw new Error('Le PDF de la facture est indisponible.')
  let attachments: Array<{ filename: string; content: Buffer }> = [
    { filename: rendered.fileName, content: rendered.buffer },
  ]

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
        attachments.push({ filename: pdf.fileName, content: pdf.buffer })
      }
    }
  }

  // Envoyer l'email
  if (clientEmail) {
    deliveryAttempted = true
    const mail = await sendEmail({ organizationId: orgId, to: clientEmail, subject, html, attachments })
      .catch((err) => {
        console.error('[sendInvoice] email error:', err)
        return { error: "Impossible d'envoyer l'email.", delivery: 'unknown' as const }
      })
    if (mail.error) {
      if (mail.delivery === 'rejected' || mail.delivery === 'not_sent') {
        if (previousStatus === 'draft') {
          const { error: releaseError } = await admin.from('invoices')
            .update({ status: 'draft' })
            .eq('id', invoiceId)
            .eq('organization_id', orgId)
            .eq('status', 'sending')
          if (releaseError) console.error('[sendInvoice] restore rejected send claim:', releaseError.message)
        } else {
          await releaseResendClaim()
        }
      } else if (previousStatus === 'draft') {
        // An ambiguous first send stays in sending to block automatic retries.
        console.error('[sendInvoice] leaving ambiguous first-send claim in sending state', invoiceId)
      } else {
        const { error: ambiguityError } = await admin
          .from('invoice_resend_delivery_claims')
          .update({ state: 'ambiguous', ambiguous_at: new Date().toISOString() })
          .eq('invoice_id', invoiceId)
          .eq('claim_token', resendClaimToken)
        if (ambiguityError) console.error('[sendInvoice] mark ambiguous resend claim:', ambiguityError.message)
      }
      return { error: mail.error }
    }
  }

  // Only a first send updates the financial lifecycle and initial sent_at.
  if (previousStatus === 'draft') {
    const { data: sentInvoice, error: sentError } = await admin
      .from('invoices')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', invoiceId)
      .eq('organization_id', orgId)
      .eq('status', 'sending')
      .select('id')
      .maybeSingle()
    if (sentError) throw new Error(sentError.message)
    if (!sentInvoice) throw new Error('La facture a été envoyée mais son état n’a pas pu être finalisé.')
  } else {
    const releaseError = await releaseResendClaim()
    if (releaseError) throw new Error(`Facture envoyée, mais le verrou de renvoi reste à réconcilier : ${releaseError}`)
  }

  // The PDP applies its own eligibility gate from frozen buyer authority; do
  // not skip it based on mutable client fields from the live client row.
  let paTransmission: Result['paTransmission']
  const transmitResult = await transmitInvoiceViaSuperPdp(invoiceId).catch((err) => {
    console.error('[sendInvoice] Super PDP transmission threw', err)
    return { error: 'Erreur interne lors de la transmission Super PDP.' } as const
  })
  paTransmission = 'success' in transmitResult
    ? { success: true, messageId: transmitResult.messageId }
    : { success: false, error: transmitResult.error }


  const { data: { user: sendingUser } } = await supabase.auth.getUser()

  // confirmed_by distinguishes a manual send (this user) from an automatic
  // recurring-invoice cron send (confirmed_by=null).
  await supabase
    .from('invoice_schedules')
    .update({ status: 'sent', confirmed_at: new Date().toISOString(), confirmed_by: sendingUser?.id ?? null })
    .eq('invoice_id', invoiceId)
    .eq('organization_id', orgId)
    .eq('status', 'pending_confirmation')

  await syncInvoiceMemoryEntry(supabase, orgId, invoiceId)
  if (sendingUser) await trackServerEvent(sendingUser.id, 'invoice_sent', { organization_id: orgId })
  revalidatePath('/finances')
  revalidatePath('/finances/recurring')
  return { error: null, paTransmission }
  } catch (err) {
    console.error('[sendInvoice] send failure:', err)
    if (!deliveryAttempted) {
      if (previousStatus === 'draft') {
        const { error: releaseError } = await admin.from('invoices')
          .update({ status: 'draft' })
          .eq('id', invoiceId)
          .eq('organization_id', orgId)
          .eq('status', 'sending')
        if (releaseError) console.error('[sendInvoice] restore pre-delivery claim:', releaseError.message)
      } else {
        await releaseResendClaim()
      }
    }
    return { error: err instanceof Error ? err.message : 'Erreur lors de l’envoi de la facture.' }
  }
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
  if (orgId) {
    await syncInvoiceMemoryEntry(supabase, orgId, invoiceId)

    const { data: { user } } = await supabase.auth.getUser()
    const { data: invoiceForPush } = await supabase
      .from('invoices')
      .select('number, title, client_id')
      .eq('id', invoiceId)
      .maybeSingle()
    const clientForPush = invoiceForPush?.client_id
      ? await supabase.from('clients').select('company_name, contact_name').eq('id', invoiceForPush.client_id).maybeSingle().then(r => r.data)
      : null
    const clientLabel = clientForPush?.company_name ?? clientForPush?.contact_name ?? null
    const invoiceNum = invoiceForPush?.number ?? invoiceId.slice(0, 8)
    const amountLabel = Number(payment.amount).toLocaleString('fr-FR', { minimumFractionDigits: 2 })
    sendPushToOrg(orgId, {
      title: result?.status === 'paid' ? `Facture ${invoiceNum} soldée` : `Paiement enregistré sur ${invoiceNum}`,
      body: [clientLabel, `${amountLabel} €`].filter(Boolean).join(' · '),
      url: '/finances',
    }, user?.id).catch(() => {})
    logAuditEvent({
      organizationId: orgId,
      actorId: user?.id ?? null,
      action: 'audit.invoice.scheduled_payment',
      entityType: 'invoice',
      entityId: invoiceId,
      metadata: { number: invoiceForPush?.number, amount: payment.amount, status: result?.status },
    }).catch(() => {})
  }
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

  const { data: { user } } = await supabase.auth.getUser()
  const { data: invoiceBefore } = await supabase
    .from('invoices')
    .select('number, status')
    .eq('id', invoiceId)
    .eq('organization_id', orgId)
    .maybeSingle()

  const { error } = await supabase
    .from('invoices')
    .update({ status: 'cancelled', is_archived: true })
    .eq('id', invoiceId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  logAuditEvent({
    organizationId: orgId,
    actorId: user?.id ?? null,
    action: 'audit.invoice.archived',
    entityType: 'invoice',
    entityId: invoiceId,
    metadata: { number: invoiceBefore?.number, previous_status: invoiceBefore?.status },
  }).catch(() => {})
  revalidatePath('/finances')
  return { error: null }
}
