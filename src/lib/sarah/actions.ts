import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembershipContext, hasPermission } from '@/lib/data/queries/membership'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { createPlanningSlot, deletePlanningSlot, updatePlanningSlot } from '@/lib/data/mutations/planning'
import { declareMemberAbsence } from '@/lib/data/mutations/absences'
import { createQuote, upsertQuoteItem, upsertQuoteSection, markQuoteAccepted, sendQuote } from '@/lib/data/mutations/quotes'
import { createInvoice, saveInvoiceItems, markInvoicePaid, sendInvoice } from '@/lib/data/mutations/invoices'
import { createClientInline } from '@/lib/data/mutations/clients'
import { createChantier, createTache, createChantierNote } from '@/lib/data/mutations/chantiers'
import { createChantierExpense } from '@/lib/data/mutations/chantier-expenses'
import { sendQuoteFollowup, markQuoteRefused } from '@/lib/data/mutations/reminders'
import { getPlanningRecipientUserIds, sendPushToPlanningRecipients } from '@/lib/push'
import { getMaterials, getLaborRates, getPrestationTypes, type CatalogLaborRate, type CatalogMaterial, type PrestationType } from '@/lib/data/queries/catalog'
import { getCatalogSaleUnitPrice, getInternalResourceUnitCost } from '@/lib/catalog-ui'
import { dateParis, todayParis } from '@/lib/utils'
import { Resend } from 'resend'
import { APP_SIGNATURE, defaultBrandedSenderName } from '@/lib/brand'

export type SarahActionRisk = 'low' | 'medium' | 'high'
export type SarahActionStatus = 'pending' | 'executed' | 'dismissed' | 'expired' | 'failed'

export type SarahActionProposalInput = {
  organizationId: string
  userId?: string | null
  type: string
  risk?: SarahActionRisk
  title: string
  description: string
  payload?: Record<string, unknown>
  deepLink?: string | null
  dedupeKey?: string | null
  expiresAt?: string | null
}

export type SarahActionProposal = {
  id: string
  organization_id: string
  user_id: string | null
  type: string
  risk: SarahActionRisk
  title: string
  description: string
  payload: Record<string, unknown>
  deep_link: string | null
  status: SarahActionStatus
  dedupe_key: string | null
  expires_at: string
  created_at: string
  error: string | null
}

const SARAH_EMAIL_MAX_RECIPIENTS = 50

export function normalizeSarahDeepLink(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.startsWith('/')) return null
  if (trimmed.startsWith('//')) return null
  return trimmed
}

function normalizeSarahActionType(type: string): string {
  const normalized = type.trim().toLowerCase()
  if (['create_quote', 'quote_create', 'quote_draft', 'create_draft_quote', 'devis_create', 'create_devis', 'draft_devis'].includes(normalized)) {
    return 'draft_quote'
  }
  if (['create_invoice', 'invoice_create', 'invoice_draft', 'create_draft_invoice', 'facture_create', 'create_facture', 'draft_facture'].includes(normalized)) {
    return 'draft_invoice'
  }
  if (['planning_week', 'create_week_planning', 'plan_week', 'planning_brief', 'brief_planning'].includes(normalized)) {
    return 'brief_nora'
  }
  if (['create_client', 'new_client', 'add_client', 'client_add'].includes(normalized)) return 'client_create'
  if (['create_chantier', 'new_chantier', 'add_chantier'].includes(normalized)) return 'chantier_create'
  if (['create_task', 'add_task', 'tache_create', 'create_tache'].includes(normalized)) return 'task_create'
  if (['add_note', 'note_add', 'chantier_note', 'create_note'].includes(normalized)) return 'chantier_note_add'
  if (['mark_invoice_paid', 'invoice_paid'].includes(normalized)) return 'invoice_mark_paid'
  if (['mark_quote_accepted', 'quote_accepted'].includes(normalized)) return 'quote_mark_accepted'
  if (['mark_quote_refused', 'quote_refused'].includes(normalized)) return 'quote_mark_refused'
  if (['send_quote'].includes(normalized)) return 'quote_send'
  if (['send_invoice'].includes(normalized)) return 'invoice_send'
  if (['quote_reminder', 'relance_devis', 'followup_quote'].includes(normalized)) return 'quote_followup'
  if (['add_expense', 'create_expense', 'expense_create', 'depense_record'].includes(normalized)) return 'expense_record'
  return type
}

function isMissingSarahActionProposalTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as { code?: string; message?: string }
  return err.code === 'PGRST205' || Boolean(err.message?.includes("sarah_action_proposals"))
}

export function deepLinkForSarahAction(type: string, payload: Record<string, unknown> = {}): string {
  type = normalizeSarahActionType(type)
  const direct = normalizeSarahDeepLink(payload.deep_link ?? payload.deepLink ?? payload.url ?? payload.redirect_url)
  if (direct) return direct

  const chantierId = typeof payload.chantier_id === 'string' ? payload.chantier_id : typeof payload.chantierId === 'string' ? payload.chantierId : null
  const clientId = typeof payload.client_id === 'string' ? payload.client_id : typeof payload.clientId === 'string' ? payload.clientId : null
  const quoteId = typeof payload.quote_id === 'string' ? payload.quote_id : typeof payload.quoteId === 'string' ? payload.quoteId : null
  const invoiceId = typeof payload.invoice_id === 'string' ? payload.invoice_id : typeof payload.invoiceId === 'string' ? payload.invoiceId : null

  if (type === 'open_quote_editor' || type === 'brief_chloe' || type === 'draft_quote') return quoteId ? `/finances/quote-editor?id=${quoteId}` : '/finances/quote-editor'
  if (type === 'open_invoice_editor' || type === 'invoice_reminder' || type === 'draft_invoice') return invoiceId ? `/finances/invoice-editor?id=${invoiceId}` : '/finances'
  if (type === 'client_create') return '/clients'
  if (type === 'chantier_create') return '/chantiers'
  if (type === 'task_create' || type === 'chantier_note_add' || type === 'expense_record') return chantierId ? `/chantiers/${chantierId}` : '/chantiers'
  if (type === 'invoice_mark_paid' || type === 'invoice_send') return '/finances'
  if (type === 'quote_mark_accepted' || type === 'quote_mark_refused' || type === 'quote_send') return '/finances'
  if (type === 'quote_followup') return '/reminders'
  if (type === 'brief_nora') return '/chantiers/planning'
  if (type === 'draft_email' || type === 'email_broadcast') return '/clients'
  if (type === 'absence_declare') return '/chantiers/planning'
  if (type === 'planning_replacement_suggest') return '/chantiers/planning'
  if (type === 'pointage_reminder_prepare') return '/chantiers/heures'
  if (type.startsWith('planning_')) return '/chantiers/planning'
  if (type === 'task_complete' && chantierId) return `/chantiers/${chantierId}`
  if (type === 'brief_marco' && chantierId) return `/chantiers/${chantierId}`
  if (type === 'open_client' && clientId) return `/clients/${clientId}`
  if (type === 'open_chantier' && chantierId) return `/chantiers/${chantierId}`
  if (clientId) return `/clients/${clientId}`
  if (chantierId) return `/chantiers/${chantierId}`
  return '/dashboard'
}

export async function proposeSarahAction(input: SarahActionProposalInput): Promise<SarahActionProposal | null> {
  const admin = createAdminClient()
  const type = normalizeSarahActionType(input.type)
  const deepLink = normalizeSarahDeepLink(input.deepLink) ?? deepLinkForSarahAction(type, input.payload ?? {})
  const expiresAt = input.expiresAt ?? new Date(Date.now() + 7 * 86400000).toISOString()

  if (input.dedupeKey) {
    const { data: existing, error: existingError } = await admin
      .from('sarah_action_proposals')
      .select('*')
      .eq('organization_id', input.organizationId)
      .eq('dedupe_key', input.dedupeKey)
      .eq('status', 'pending')
      .maybeSingle()

    if (existingError && isMissingSarahActionProposalTable(existingError)) {
      return null
    }

    if (existing) {
      const existingProposal = existing as SarahActionProposal
      if (new Date(existingProposal.expires_at).getTime() >= Date.now()) {
        return existingProposal
      }
      await admin
        .from('sarah_action_proposals')
        .update({ status: 'expired' })
        .eq('id', existingProposal.id)
    }
  }

  const { data, error } = await admin
    .from('sarah_action_proposals')
    .insert({
      organization_id: input.organizationId,
      user_id: input.userId ?? null,
      type,
      risk: input.risk ?? 'low',
      title: input.title,
      description: input.description,
      payload: input.payload ?? {},
      deep_link: deepLink,
      dedupe_key: input.dedupeKey ?? null,
      expires_at: expiresAt,
    })
    .select('*')
    .single()

  if (error) {
    if (isMissingSarahActionProposalTable(error)) {
      return null
    }
    if (input.dedupeKey && error.code === '23505') {
      const { data: existing } = await admin
        .from('sarah_action_proposals')
        .select('*')
        .eq('organization_id', input.organizationId)
        .eq('dedupe_key', input.dedupeKey)
        .eq('status', 'pending')
        .maybeSingle()
      return existing as SarahActionProposal | null
    }
    console.error('[proposeSarahAction]', error)
    return null
  }

  return data as SarahActionProposal
}

export async function executeSarahActionPayload(
  type: string,
  payload: Record<string, unknown> = {},
  opts: { title?: string; deepLink?: string | null } = {},
): Promise<{ ok: boolean; message: string; deepLink?: string | null; error?: string }> {
  if (!await hasPermission('ai.sarah')) {
    return { ok: false, message: 'Accès non autorisé.', error: 'permission_denied' }
  }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { ok: false, message: 'Non connecté.', error: 'unauthenticated' }

  const normalizedType = normalizeSarahActionType(type)
  const deepLink = normalizeSarahDeepLink(opts.deepLink) ?? deepLinkForSarahAction(normalizedType, payload)
  const proposal: SarahActionProposal = {
    id: 'direct',
    organization_id: orgId,
    user_id: null,
    type: normalizedType,
    risk: 'medium',
    title: opts.title ?? 'Action Sarah',
    description: opts.title ?? 'Action Sarah',
    payload,
    deep_link: deepLink,
    status: 'pending',
    dedupe_key: null,
    expires_at: new Date(Date.now() + 60000).toISOString(),
    created_at: new Date().toISOString(),
    error: null,
  }

  try {
    const result = await executeProposalSideEffect(proposal, orgId)
    return { ok: true, message: result.message, deepLink: result.deepLink }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Action impossible.'
    return { ok: false, message, error: 'execution_failed' }
  }
}

export async function listPendingSarahActions(): Promise<SarahActionProposal[]> {
  if (!await hasPermission('ai.sarah')) return []
  const membership = await getCurrentMembershipContext()
  if (!membership) return []

  const supabase = await createClient()
  const now = new Date().toISOString()
  const { data } = await supabase
    .from('sarah_action_proposals')
    .select('*')
    .eq('organization_id', membership.organizationId)
    .eq('status', 'pending')
    .or(`user_id.is.null,user_id.eq.${membership.userId}`)
    .gte('expires_at', now)
    .order('created_at', { ascending: false })
    .limit(12)

  return (data ?? []) as SarahActionProposal[]
}

async function saveAIBriefFromSarah(
  orgId: string,
  targetAssistant: 'chloe' | 'nora' | 'marco',
  payload: Record<string, unknown>,
) {
  const supabase = await createClient()
  await supabase.from('ai_briefs').insert({
    organization_id: orgId,
    source_assistant: 'sarah',
    target_assistant: targetAssistant,
    payload,
    status: 'pending',
  })
}

function textToHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

function resolveClientGreeting(client: {
  type: string | null
  first_name: string | null
  last_name: string | null
  contact_name: string | null
  company_name: string | null
}): string {
  if (client.type === 'individual') {
    const name = [client.first_name, client.last_name].filter(Boolean).join(' ').trim()
    if (name) return `Bonjour ${name},`
  }
  if (client.contact_name?.trim()) return `Bonjour ${client.contact_name.trim()},`
  if (client.company_name?.trim()) return `Bonjour l'équipe ${client.company_name.trim()},`
  return 'Bonjour,'
}

function buildSarahEmailHtml(opts: {
  orgName: string
  contactEmail: string
  body: string
  orgSignature: string | null
  greeting: string
}): string {
  const lines = opts.body.split('\n')
  const salutationPattern = /^\s*(bonjour\b.*|salut\b.*|madame[,.].*|monsieur[,.].*)$/i
  if (lines.length > 0 && salutationPattern.test(lines[0])) {
    lines[0] = opts.greeting
  }

  const bodyHtml = textToHtml(lines.join('\n'))
  const signatureHtml = opts.orgSignature
    ? textToHtml(opts.orgSignature)
    : `${textToHtml(opts.orgName)}<br><a href="mailto:${opts.contactEmail}" style="color:#666">${textToHtml(opts.contactEmail)}</a>`

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:600px">
        <tr><td style="padding:32px 40px 24px">
          <div style="font-size:15px;color:#111;line-height:1.6">${bodyHtml}</div>
        </td></tr>
        <tr><td style="padding:24px 40px 32px;border-top:1px solid #eee">
          <p style="margin:0;font-size:13px;color:#555;line-height:1.6">${signatureHtml}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

async function sendSarahDraftEmail(orgId: string, payload: Record<string, unknown>): Promise<{ sent: number; errors: number }> {
  const canSend = await hasPermission('clients.edit') || await hasPermission('reminders.send_manual')
  if (!canSend) throw new Error('Permission email insuffisante.')

  const subject = typeof payload.subject === 'string' ? payload.subject.trim() : ''
  const body = typeof payload.body === 'string'
    ? payload.body.trim()
    : typeof payload.bodyHtml === 'string'
      ? payload.bodyHtml.trim()
      : ''
  if (!subject || !body) throw new Error('Objet ou contenu email manquant.')

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('Configuration email manquante (RESEND_API_KEY).')

  const admin = createAdminClient()
  const { data: org } = await admin
    .from('organizations')
    .select('name, email, email_from_name, email_from_address, email_signature')
    .eq('id', orgId)
    .single()

  if (!org?.email_from_address) {
    throw new Error("L'adresse email expéditeur n'est pas configurée. Allez dans Paramètres > Email.")
  }

  const filter = (payload.recipient_filter && typeof payload.recipient_filter === 'object'
    ? payload.recipient_filter
    : {}) as Record<string, unknown>
  const mode = typeof filter.mode === 'string' ? filter.mode : null
  const clientIds = [
    ...stringArray(payload.client_ids),
    ...(typeof payload.client_id === 'string' ? [payload.client_id] : []),
    ...stringArray(filter.ids),
  ]
  const statuses = stringArray(filter.statuses)

  let query = admin
    .from('clients')
    .select('id, email, first_name, last_name, company_name, contact_name, type, status')
    .eq('organization_id', orgId)
    .eq('is_archived', false)
    .not('email', 'is', null)
    .neq('email', '')
    .limit(SARAH_EMAIL_MAX_RECIPIENTS + 1)

  if (clientIds.length > 0 || mode === 'manual') {
    const ids = clientIds.slice(0, SARAH_EMAIL_MAX_RECIPIENTS)
    if (ids.length === 0) throw new Error('Aucun client destinataire renseigné.')
    query = query.in('id', ids)
  } else if (mode === 'all_active') {
    query = query.eq('status', 'active')
  } else if (mode === 'by_status') {
    if (statuses.length === 0) throw new Error('Aucun statut destinataire renseigné.')
    query = query.in('status', statuses.slice(0, 6))
  } else if (mode === 'all') {
    // Autorisé mais plafonné pour protéger le free tier.
  } else {
    throw new Error('Destinataires email manquants. Sarah doit choisir des clients ou un statut.')
  }

  const { data: clients, error } = await query
  if (error) throw new Error('Erreur lors de la récupération des destinataires.')
  if (!clients?.length) throw new Error('Aucun destinataire avec email valide.')
  if (clients.length > SARAH_EMAIL_MAX_RECIPIENTS) {
    throw new Error(`Trop de destinataires. Maximum ${SARAH_EMAIL_MAX_RECIPIENTS} par envoi Sarah.`)
  }

  const { data: { user } } = await createClient().then(client => client.auth.getUser())
  const { data: broadcast } = await admin
    .from('email_broadcasts')
    .insert({
      organization_id: orgId,
      subject,
      body_html: body,
      recipient_filter: clientIds.length > 0 ? { mode: 'manual', ids: clientIds } : filter,
      recipient_count: clients.length,
      sent_at: new Date().toISOString(),
      created_by: user?.id ?? null,
    })
    .select('id')
    .single()

  const resend = new Resend(apiKey)
  const fromName = defaultBrandedSenderName(org.email_from_name || org.name || APP_SIGNATURE)
  const from = `${fromName} <${org.email_from_address}>`
  const contactEmail = org.email || org.email_from_address
  let sent = 0
  let errors = 0
  const logs: Array<{ broadcast_id: string; client_id: string; email: string; status: string; error_message?: string }> = []

  for (const client of clients) {
    const html = buildSarahEmailHtml({
      orgName: org.name ?? APP_SIGNATURE,
      contactEmail,
      body,
      orgSignature: org.email_signature ?? null,
      greeting: resolveClientGreeting(client),
    })
    const { error: sendError } = await resend.emails.send({
      from,
      to: client.email as string,
      subject,
      html,
      replyTo: contactEmail,
    })
    if (sendError) {
      errors++
      if (broadcast?.id) logs.push({ broadcast_id: broadcast.id, client_id: client.id, email: client.email as string, status: 'error', error_message: sendError.message })
    } else {
      sent++
      if (broadcast?.id) logs.push({ broadcast_id: broadcast.id, client_id: client.id, email: client.email as string, status: 'sent' })
    }
    if (clients.length > 10) await new Promise(resolve => setTimeout(resolve, 50))
  }

  if (logs.length > 0) await admin.from('broadcast_logs').insert(logs)
  return { sent, errors }
}

type SarahDraftLine = {
  description: string
  quantity: number
  unit: string
  unit_price: number
  unit_cost_ht?: number | null
  vat_rate: number
  type: 'material' | 'labor' | 'custom'
  material_id?: string | null
  labor_rate_id?: string | null
  is_internal?: boolean
}

function normalizeText(value: unknown): string {
  return typeof value === 'string'
    ? value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, ' ').trim()
    : ''
}

function numberOr(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(',', '.')) : NaN
  return Number.isFinite(n) ? n : fallback
}

async function findClientIdForSarahDraft(orgId: string, payload: Record<string, unknown>): Promise<string | null> {
  const explicit = typeof payload.client_id === 'string'
    ? payload.client_id
    : typeof payload.clientId === 'string'
      ? payload.clientId
      : null
  const admin = createAdminClient()
  if (explicit) {
    const { data } = await admin.from('clients').select('id').eq('id', explicit).eq('organization_id', orgId).maybeSingle()
    if (data?.id) return data.id
  }

  const search = normalizeText(payload.client_name ?? payload.clientName)
  if (!search) return null
  const { data: clients } = await admin
    .from('clients')
    .select('id, company_name, contact_name, first_name, last_name, email')
    .eq('organization_id', orgId)
    .eq('is_archived', false)
    .limit(80)

  let best: { id: string; score: number } | null = null
  for (const client of clients ?? []) {
    const fields = [client.company_name, client.contact_name, [client.first_name, client.last_name].filter(Boolean).join(' '), client.email]
    let score = 0
    for (const field of fields) {
      const normalized = normalizeText(field)
      if (!normalized) continue
      if (normalized === search) score = Math.max(score, 100)
      else if (normalized.includes(search) || search.includes(normalized)) score = Math.max(score, 80)
    }
    if (!best || score > best.score) best = { id: client.id, score }
  }
  return best && best.score >= 70 ? best.id : null
}

function findCatalogMatch<T extends { id: string }>(
  items: T[],
  raw: Record<string, unknown>,
  fields: Array<keyof T>,
): T | null {
  const explicit = typeof raw.catalog_id === 'string'
    ? raw.catalog_id
    : typeof raw.catalogId === 'string'
      ? raw.catalogId
      : typeof raw.id === 'string'
        ? raw.id
        : null
  if (explicit) {
    const byId = items.find(item => item.id === explicit)
    if (byId) return byId
  }

  const search = normalizeText(raw.name ?? raw.designation ?? raw.description ?? raw.catalog_name ?? raw.catalogName)
  if (!search) return null
  return items.find(item => fields.some(field => {
    const value = item[field]
    return normalizeText(value).includes(search) || search.includes(normalizeText(value))
  })) ?? null
}

function lineFromMaterial(material: CatalogMaterial, raw: Record<string, unknown>): SarahDraftLine {
  return {
    description: typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim() : material.name,
    quantity: numberOr(raw.quantity ?? raw.qty, 1),
    unit: typeof raw.unit === 'string' && raw.unit.trim() ? raw.unit.trim() : material.unit ?? 'u',
    unit_price: numberOr(raw.unit_price ?? raw.unitPrice, getCatalogSaleUnitPrice(material)),
    unit_cost_ht: material.purchase_price ?? null,
    vat_rate: numberOr(raw.vat_rate ?? raw.vatRate, material.vat_rate ?? 20),
    type: 'material',
    material_id: material.id,
    labor_rate_id: null,
    is_internal: false,
  }
}

function lineFromLabor(labor: CatalogLaborRate, raw: Record<string, unknown>): SarahDraftLine {
  return {
    description: typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim() : labor.designation,
    quantity: numberOr(raw.quantity ?? raw.qty, 1),
    unit: typeof raw.unit === 'string' && raw.unit.trim() ? raw.unit.trim() : labor.unit ?? 'h',
    unit_price: numberOr(raw.unit_price ?? raw.unitPrice, getInternalResourceUnitCost(labor)),
    unit_cost_ht: labor.cost_rate ?? null,
    vat_rate: numberOr(raw.vat_rate ?? raw.vatRate, labor.vat_rate ?? 20),
    type: 'labor',
    material_id: null,
    labor_rate_id: labor.id,
    is_internal: Boolean(raw.is_internal ?? raw.internal ?? true),
  }
}

function linesFromPrestation(prestation: PrestationType, raw: Record<string, unknown>): SarahDraftLine[] {
  const multiplier = numberOr(raw.quantity ?? raw.qty, 1)
  if (!prestation.items?.length) {
    return [{
      description: prestation.name,
      quantity: multiplier,
      unit: prestation.unit ?? 'u',
      unit_price: numberOr(raw.unit_price ?? raw.unitPrice, prestation.base_price_ht),
      unit_cost_ht: prestation.base_cost_ht ?? null,
      vat_rate: numberOr(raw.vat_rate ?? raw.vatRate, prestation.vat_rate ?? 20),
      type: 'custom',
      is_internal: false,
    }]
  }
  return [...prestation.items].sort((a, b) => a.position - b.position).map(item => ({
    description: item.designation,
    quantity: (Number(item.quantity) || 1) * multiplier,
    unit: item.unit ?? 'u',
    unit_price: Number(item.unit_price_ht) || 0,
    unit_cost_ht: item.unit_cost_ht ?? null,
    vat_rate: numberOr(raw.vat_rate ?? raw.vatRate, prestation.vat_rate ?? 20),
    type: item.item_type === 'labor' ? 'labor' : item.item_type === 'material' || item.item_type === 'service' ? 'material' : 'custom',
    material_id: item.material_id,
    labor_rate_id: item.labor_rate_id,
    is_internal: item.is_internal || item.item_type === 'equipment' || item.item_type === 'transport',
  }))
}

async function resolveSarahDraftLines(payload: Record<string, unknown>): Promise<SarahDraftLine[]> {
  const [materials, laborRates, prestations] = await Promise.all([getMaterials(), getLaborRates(), getPrestationTypes()])
  const sections = Array.isArray(payload.sections) ? payload.sections : []
  const rawItems = [
    ...(Array.isArray(payload.items) ? payload.items : []),
    ...sections.flatMap(section => {
      if (!section || typeof section !== 'object') return []
      return Array.isArray((section as Record<string, unknown>).items) ? (section as Record<string, unknown>).items as unknown[] : []
    }),
  ].filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))

  const lines: SarahDraftLine[] = []
  for (const raw of rawItems) {
    const kind = normalizeText(raw.kind ?? raw.type ?? raw.catalog_type ?? raw.catalogType)
    const explicitCatalogId = typeof raw.catalog_id === 'string'
      ? raw.catalog_id
      : typeof raw.catalogId === 'string'
        ? raw.catalogId
        : typeof raw.id === 'string'
          ? raw.id
          : null
    const prestation = (kind.includes('prestation') || kind.includes('bundle'))
      ? findCatalogMatch(prestations, raw, ['name', 'category'])
      : findCatalogMatch(prestations, raw, ['name'])
    if (prestation && (kind.includes('prestation') || kind.includes('bundle') || explicitCatalogId === prestation.id)) {
      lines.push(...linesFromPrestation(prestation, raw))
      continue
    }

    const labor = (kind.includes('mo') || kind.includes('labor') || kind.includes('main') || kind.includes('oeuvre'))
      ? findCatalogMatch(laborRates, raw, ['designation', 'reference', 'category'])
      : null
    if (labor) {
      lines.push(lineFromLabor(labor, raw))
      continue
    }

    const material = findCatalogMatch(materials, raw, ['name', 'reference', 'category'])
    if (material) {
      lines.push(lineFromMaterial(material, raw))
      continue
    }

    const description = typeof raw.description === 'string' && raw.description.trim()
      ? raw.description.trim()
      : typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim()
        : null
    if (description) {
      lines.push({
        description,
        quantity: numberOr(raw.quantity ?? raw.qty, 1),
        unit: typeof raw.unit === 'string' && raw.unit.trim() ? raw.unit.trim() : 'u',
        unit_price: numberOr(raw.unit_price ?? raw.unitPrice, 0),
        unit_cost_ht: typeof raw.unit_cost_ht === 'number' ? raw.unit_cost_ht : null,
        vat_rate: numberOr(raw.vat_rate ?? raw.vatRate, 20),
        type: 'custom',
        is_internal: Boolean(raw.is_internal ?? raw.internal ?? false),
      })
    }
  }
  return lines
}

function truncateTitle(value: string, max = 60): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean
}

// Titre par défaut basé sur la prestation : on prend l'objet du devis (les
// lignes principales) plutôt qu'un libellé générique type "Brouillon Sarah".
function resolveSarahDraftTitle(
  payload: Record<string, unknown>,
  lines: SarahDraftLine[],
  fallback: string,
): string {
  const explicit = typeof payload.title === 'string' ? payload.title.trim() : ''
  if (explicit) return truncateTitle(explicit)

  // On privilégie les prestations / fournitures (pas la main d'œuvre interne).
  const meaningful = lines.filter(line => line.type !== 'labor' && line.description.trim())
  const source = (meaningful.length > 0 ? meaningful : lines).filter(line => line.description.trim())

  if (source.length === 1) return truncateTitle(source[0].description)
  if (source.length === 2) return truncateTitle(`${source[0].description} et ${source[1].description}`)
  if (source.length > 2) return truncateTitle(`${source[0].description} et ${source.length - 1} autres prestations`)

  return fallback
}

async function createSarahQuoteDraft(orgId: string, payload: Record<string, unknown>): Promise<{ quoteId: string; lineCount: number }> {
  const clientId = await findClientIdForSarahDraft(orgId, payload)
  const lines = await resolveSarahDraftLines(payload)
  const title = resolveSarahDraftTitle(payload, lines, 'Nouveau devis')
  const quote = await createQuote({
    clientId,
    title,
    briefNotes: typeof payload.notes === 'string' ? payload.notes : 'Devis préparé par Sarah. À vérifier avant envoi.',
  })
  if (quote.error || !quote.quoteId) throw new Error(quote.error ?? 'Création du devis impossible.')
  if (lines.length > 0) {
    const section = await upsertQuoteSection({ quote_id: quote.quoteId, title: title || 'Prestations', position: 1 })
    if (!section.sectionId) throw new Error(section.error ?? 'Création de section impossible.')
    for (const [idx, line] of lines.entries()) {
      const res = await upsertQuoteItem({
        quote_id: quote.quoteId,
        section_id: section.sectionId,
        type: line.type,
        material_id: line.material_id ?? null,
        labor_rate_id: line.labor_rate_id ?? null,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unit_price: line.unit_price,
        unit_cost_ht: line.unit_cost_ht ?? null,
        vat_rate: line.vat_rate,
        position: idx + 1,
        is_internal: line.is_internal ?? false,
        ai_source: line.material_id || line.labor_rate_id ? 'catalog' : 'client_input',
      })
      if (res.error) throw new Error(res.error)
    }
  }
  return { quoteId: quote.quoteId, lineCount: lines.length }
}

async function createSarahInvoiceDraft(orgId: string, payload: Record<string, unknown>): Promise<{ invoiceId: string; lineCount: number }> {
  const clientId = await findClientIdForSarahDraft(orgId, payload)
  const lines = await resolveSarahDraftLines(payload)
  const title = resolveSarahDraftTitle(payload, lines, 'Nouvelle facture')
  const invoice = await createInvoice({ clientId, title })
  if (invoice.error || !invoice.invoiceId) throw new Error(invoice.error ?? 'Création de la facture impossible.')
  const issueDate = typeof payload.issue_date === 'string' ? payload.issue_date : typeof payload.issueDate === 'string' ? payload.issueDate : todayParis()
  const dueDate = typeof payload.due_date === 'string' ? payload.due_date : typeof payload.dueDate === 'string' ? payload.dueDate : dateParis(Date.now() + 30 * 86400000)
  const res = await saveInvoiceItems(invoice.invoiceId, lines.map(line => ({
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    unit_price: line.unit_price,
    unit_cost_ht: line.unit_cost_ht ?? null,
    vat_rate: line.vat_rate,
    is_internal: line.is_internal ?? false,
    material_id: line.material_id ?? null,
  })), {
    clientId,
    issueDate,
    dueDate,
    title,
  })
  if (res.error) throw new Error(res.error)
  return { invoiceId: invoice.invoiceId, lineCount: lines.length }
}

async function executeProposalSideEffect(proposal: SarahActionProposal, orgId: string): Promise<{ message: string; deepLink?: string | null }> {
  const p = proposal.payload ?? {}

  switch (proposal.type) {
    case 'task_complete': {
      const tacheId = typeof p.tache_id === 'string' ? p.tache_id : null
      if (!tacheId) throw new Error('Identifiant de tâche manquant.')
      const supabase = await createClient()
      const { data: tache } = await supabase
        .from('chantier_taches')
        .select('id, chantier:chantiers!inner(organization_id)')
        .eq('id', tacheId)
        .eq('chantier.organization_id', orgId)
        .single()
      if (!tache) throw new Error('Tâche introuvable.')
      const { error } = await supabase
        .from('chantier_taches')
        .update({ status: 'termine', updated_at: new Date().toISOString() })
        .eq('id', tacheId)
      if (error) throw new Error('Mise à jour impossible.')
      return { message: 'La tâche a bien été marquée comme terminée.', deepLink: proposal.deep_link }
    }

    case 'brief_chloe':
      await saveAIBriefFromSarah(orgId, 'chloe', p)
      return { message: "Le brief a été transmis à Chloé. Aucun devis n'a encore été créé : Chloé va reprendre le contexte dans l'éditeur.", deepLink: proposal.deep_link ?? '/finances/quote-editor' }

    case 'brief_nora':
      await saveAIBriefFromSarah(orgId, 'nora', p)
      return { message: "Le planning a été transmis à Nora. J'ouvre le planning global.", deepLink: proposal.deep_link ?? '/chantiers/planning' }

    case 'brief_marco':
      await saveAIBriefFromSarah(orgId, 'marco', p)
      return { message: "Le contexte a été transmis à Marco.", deepLink: proposal.deep_link }

    case 'draft_quote': {
      if (p.requires_chloe === true || p.requiresChloe === true) {
        await saveAIBriefFromSarah(orgId, 'chloe', p)
        return { message: "Ce devis demande l'œil de Chloé. Je lui transmets le brief et j'ouvre l'éditeur.", deepLink: '/finances/quote-editor' }
      }
      const result = await createSarahQuoteDraft(orgId, p)
      return {
        message: `Brouillon de devis créé avec ${result.lineCount} ligne${result.lineCount > 1 ? 's' : ''}. J'ouvre l'éditeur.`,
        deepLink: `/finances/quote-editor?id=${result.quoteId}`,
      }
    }

    case 'draft_invoice': {
      const result = await createSarahInvoiceDraft(orgId, p)
      return {
        message: `Brouillon de facture créé avec ${result.lineCount} ligne${result.lineCount > 1 ? 's' : ''}. J'ouvre l'éditeur.`,
        deepLink: `/finances/invoice-editor?id=${result.invoiceId}`,
      }
    }

    case 'planning_create': {
      const { error } = await createPlanningSlot({
        chantierId: String(p.chantierId ?? ''),
        plannedDate: String(p.plannedDate ?? ''),
        startTime: typeof p.startTime === 'string' ? p.startTime : null,
        endTime: typeof p.endTime === 'string' ? p.endTime : null,
        label: String(p.label ?? p.memberName ?? p.equipeName ?? 'Équipe'),
        teamSize: typeof p.teamSize === 'number' ? p.teamSize : 1,
        notes: typeof p.notes === 'string' ? p.notes : null,
        memberId: typeof p.memberId === 'string' ? p.memberId : null,
        equipeId: typeof p.equipeId === 'string' ? p.equipeId : null,
      })
      if (error) throw new Error(error)
      await saveAIBriefFromSarah(orgId, 'nora', { description: `Créneau créé par Sarah : ${proposal.title}`, original_payload: p })
      return { message: 'Le créneau planning a bien été créé.', deepLink: proposal.deep_link }
    }

    case 'planning_update': {
      const slotId = typeof p.slotId === 'string' ? p.slotId : null
      if (!slotId) throw new Error('Identifiant de créneau manquant.')
      const patch: Record<string, unknown> = {}
      for (const key of ['plannedDate', 'startTime', 'endTime', 'label', 'teamSize', 'notes', 'memberId', 'equipeId']) {
        if (p[key] !== undefined) patch[key] = p[key]
      }
      const { error } = await updatePlanningSlot(slotId, patch as any)
      if (error) throw new Error(error)
      await saveAIBriefFromSarah(orgId, 'nora', { description: `Créneau modifié par Sarah : ${proposal.title}`, original_payload: p })
      return { message: 'Le créneau planning a bien été mis à jour.', deepLink: proposal.deep_link }
    }

    case 'planning_delete': {
      const slotId = typeof p.slotId === 'string' ? p.slotId : null
      if (!slotId) throw new Error('Identifiant de créneau manquant.')
      const { error } = await deletePlanningSlot(slotId)
      if (error) throw new Error(error)
      await saveAIBriefFromSarah(orgId, 'nora', { description: `Créneau supprimé par Sarah : ${proposal.title}`, original_payload: p })
      return { message: 'Le créneau planning a bien été supprimé.', deepLink: proposal.deep_link }
    }

    case 'absence_declare': {
      const memberId = typeof p.memberId === 'string' ? p.memberId : null
      const startDate = typeof p.startDate === 'string' ? p.startDate : null
      const endDate = typeof p.endDate === 'string' ? p.endDate : startDate
      if (!memberId || !startDate || !endDate) throw new Error('Informations d\'absence incomplètes.')

      const result = await declareMemberAbsence({
        memberId,
        startDate,
        endDate,
        reason: typeof p.reason === 'string' ? p.reason : null,
      })
      if (result.error) throw new Error(result.error)

      await saveAIBriefFromSarah(orgId, 'nora', { description: `Absence déclarée par Sarah : ${proposal.title}`, original_payload: p })

      const conflictCount = result.conflictingSlots?.length ?? 0
      const message = conflictCount > 0
        ? `Absence enregistrée. Attention, ${conflictCount} créneau${conflictCount > 1 ? 'x' : ''} déjà planifié${conflictCount > 1 ? 's' : ''} sur cette période reste${conflictCount > 1 ? 'nt' : ''} à traiter.`
        : 'Absence enregistrée. Aucun créneau existant sur cette période.'
      return { message, deepLink: proposal.deep_link }
    }

    case 'planning_replacement_suggest': {
      const slotId = typeof p.slotId === 'string' ? p.slotId : null
      const memberId = typeof p.memberId === 'string' ? p.memberId : null
      if (!memberId) throw new Error('Membre remplaçant manquant.')

      if (slotId) {
        const patch: Record<string, unknown> = { memberId, equipeId: null }
        const { error } = await updatePlanningSlot(slotId, patch as any)
        if (error) throw new Error(error)
      } else {
        const { error } = await createPlanningSlot({
          chantierId: String(p.chantierId ?? ''),
          plannedDate: String(p.plannedDate ?? ''),
          startTime: typeof p.startTime === 'string' ? p.startTime : null,
          endTime: typeof p.endTime === 'string' ? p.endTime : null,
          label: String(p.label ?? p.memberName ?? 'Remplacement'),
          teamSize: 1,
          notes: typeof p.notes === 'string' ? p.notes : null,
          memberId,
          equipeId: null,
        })
        if (error) throw new Error(error)
      }

      await saveAIBriefFromSarah(orgId, 'nora', { description: `Remplacement mis en place par Sarah : ${proposal.title}`, original_payload: p })
      return { message: 'Le remplacement a bien été mis en place.', deepLink: proposal.deep_link }
    }

    case 'pointage_reminder_prepare': {
      const memberId = typeof p.memberId === 'string' ? p.memberId : null
      const memberName = typeof p.memberName === 'string' ? p.memberName : 'ce membre'
      await saveAIBriefFromSarah(orgId, 'nora', { description: `Rappel de pointage préparé par Sarah pour ${memberName}.`, original_payload: p })
      if (memberId) {
        const recipients = await getPlanningRecipientUserIds(orgId, { memberId })
        if (recipients.userIds.length > 0 || recipients.memberIds.length > 0) {
          await sendPushToPlanningRecipients(recipients, {
            title: 'Rappel de pointage',
            body: typeof p.reminderText === 'string' ? p.reminderText : 'Pense à enregistrer ton pointage pour le créneau prévu.',
            url: '/mon-espace/dashboard',
          }).catch(() => {})
        }
      }
      return { message: 'Le rappel de pointage a été envoyé.', deepLink: proposal.deep_link }
    }

    case 'invoice_reminder':
      if (typeof p.invoice_id === 'string' && typeof p.draft_text === 'string') {
        const admin = createAdminClient()
        const { data: invoice } = await admin
          .from('invoices')
          .select('id, client_id, number, title')
          .eq('id', p.invoice_id)
          .eq('organization_id', orgId)
          .maybeSingle()

        if (!invoice?.client_id) throw new Error('Cette facture n’est pas liée à un client joignable.')
        const ref = invoice.number ?? invoice.title ?? 'facture'
        const result = await sendSarahDraftEmail(orgId, {
          client_ids: [invoice.client_id],
          subject: typeof p.subject === 'string' ? p.subject : `Relance facture ${ref}`,
          body: p.draft_text,
          recipient_filter: { mode: 'manual', ids: [invoice.client_id] },
        })
        return {
          message: `${result.sent} relance envoyée.${result.errors > 0 ? ` ${result.errors} échec.` : ''}`,
          deepLink: proposal.deep_link,
        }
      }
      return {
        message: typeof p.draft_text === 'string'
          ? `Voici le brouillon de relance :\n\n${p.draft_text}`
          : 'La relance est prête à être vérifiée.',
        deepLink: proposal.deep_link,
      }

    case 'draft_email':
    case 'email_broadcast': {
      const result = await sendSarahDraftEmail(orgId, p)
      return {
        message: `${result.sent} email${result.sent > 1 ? 's' : ''} envoyé${result.sent > 1 ? 's' : ''}.${result.errors > 0 ? ` ${result.errors} échec${result.errors > 1 ? 's' : ''}.` : ''}`,
        deepLink: proposal.deep_link ?? '/clients',
      }
    }

    case 'client_create': {
      const type = p.type === 'individual' ? 'individual' : 'company'
      const result = await createClientInline({
        type,
        company_name: typeof p.company_name === 'string' ? p.company_name : undefined,
        contact_name: typeof p.contact_name === 'string' ? p.contact_name : undefined,
        first_name: typeof p.first_name === 'string' ? p.first_name : undefined,
        last_name: typeof p.last_name === 'string' ? p.last_name : undefined,
        email: typeof p.email === 'string' ? p.email : undefined,
        phone: typeof p.phone === 'string' ? p.phone : undefined,
        siret: typeof p.siret === 'string' ? p.siret : undefined,
        address_line1: typeof p.address_line1 === 'string' ? p.address_line1 : undefined,
        postal_code: typeof p.postal_code === 'string' ? p.postal_code : undefined,
        city: typeof p.city === 'string' ? p.city : undefined,
        status: (['active', 'prospect', 'lead_hot', 'lead_cold', 'subcontractor', 'inactive'] as const).find(s => s === p.status),
        source: 'sarah',
      })
      if (result.error || !result.id) throw new Error(result.error ?? 'Création du client impossible.')
      return { message: 'La fiche client a bien été créée. Je vous ouvre sa fiche.', deepLink: `/clients/${result.id}` }
    }

    case 'chantier_create': {
      const title = typeof p.title === 'string' ? p.title.trim() : ''
      if (!title) throw new Error('Le titre du chantier est requis.')
      const clientId = await findClientIdForSarahDraft(orgId, p)
      const result = await createChantier({
        title,
        clientId,
        description: typeof p.description === 'string' ? p.description : null,
        addressLine1: typeof p.address_line1 === 'string' ? p.address_line1 : null,
        postalCode: typeof p.postal_code === 'string' ? p.postal_code : null,
        city: typeof p.city === 'string' ? p.city : null,
        startDate: typeof p.start_date === 'string' ? p.start_date : typeof p.startDate === 'string' ? p.startDate : null,
        estimatedEndDate: typeof p.estimated_end_date === 'string' ? p.estimated_end_date : null,
        budgetHt: typeof p.budget_ht === 'number' ? p.budget_ht : undefined,
      })
      if (result.error || !result.chantierId) throw new Error(result.error ?? 'Création du chantier impossible.')
      return { message: 'Le chantier a bien été créé. Je vous ouvre sa fiche.', deepLink: `/chantiers/${result.chantierId}` }
    }

    case 'task_create': {
      const chantierId = typeof p.chantierId === 'string' ? p.chantierId : typeof p.chantier_id === 'string' ? p.chantier_id : null
      const title = typeof p.title === 'string' ? p.title.trim() : ''
      if (!chantierId) throw new Error('Chantier de la tâche manquant.')
      if (!title) throw new Error('Le titre de la tâche est requis.')
      const result = await createTache(chantierId, {
        title,
        description: typeof p.description === 'string' ? p.description : null,
        dueDate: typeof p.due_date === 'string' ? p.due_date : typeof p.dueDate === 'string' ? p.dueDate : null,
        memberIds: stringArray(p.member_ids ?? p.memberIds),
        equipeIds: stringArray(p.equipe_ids ?? p.equipeIds),
      })
      if (result.error) throw new Error(result.error)
      return { message: 'La tâche a bien été ajoutée au chantier.', deepLink: `/chantiers/${chantierId}` }
    }

    case 'chantier_note_add': {
      const chantierId = typeof p.chantierId === 'string' ? p.chantierId : typeof p.chantier_id === 'string' ? p.chantier_id : null
      const content = typeof p.content === 'string' ? p.content.trim() : typeof p.note === 'string' ? p.note.trim() : ''
      if (!chantierId) throw new Error('Chantier de la note manquant.')
      if (!content) throw new Error('Le contenu de la note est requis.')
      const result = await createChantierNote(chantierId, content)
      if (result.error) throw new Error(result.error)
      return { message: 'La note a bien été ajoutée au chantier.', deepLink: `/chantiers/${chantierId}` }
    }

    case 'expense_record': {
      const chantierId = typeof p.chantierId === 'string' ? p.chantierId : typeof p.chantier_id === 'string' ? p.chantier_id : null
      const label = typeof p.label === 'string' ? p.label.trim() : typeof p.description === 'string' ? p.description.trim() : ''
      const amountHt = numberOr(p.amount_ht ?? p.amountHt ?? p.amount, NaN)
      if (!chantierId) throw new Error('Chantier de la dépense manquant.')
      if (!label) throw new Error('Le libellé de la dépense est requis.')
      if (!Number.isFinite(amountHt) || amountHt <= 0) throw new Error('Le montant HT de la dépense est requis.')
      const category = (['materiel', 'sous_traitance', 'location', 'transport', 'autre'] as const)
        .find(c => c === p.category) ?? 'materiel'
      const result = await createChantierExpense({
        chantierId,
        label,
        amountHt,
        category,
        vatRate: numberOr(p.vat_rate ?? p.vatRate, 20),
        expenseDate: typeof p.expense_date === 'string' ? p.expense_date : todayParis(),
        supplierName: typeof p.supplier_name === 'string' ? p.supplier_name : null,
        notes: typeof p.notes === 'string' ? p.notes : null,
      })
      if (result.error) throw new Error(result.error)
      return { message: 'La dépense a bien été enregistrée sur le chantier.', deepLink: `/chantiers/${chantierId}` }
    }

    case 'invoice_mark_paid': {
      const invoiceId = typeof p.invoice_id === 'string' ? p.invoice_id : typeof p.invoiceId === 'string' ? p.invoiceId : null
      if (!invoiceId) throw new Error('Identifiant de facture manquant.')
      const result = await markInvoicePaid(invoiceId)
      if (result.error) throw new Error(result.error)
      return { message: 'La facture a bien été marquée comme payée.', deepLink: '/finances' }
    }

    case 'invoice_send': {
      const invoiceId = typeof p.invoice_id === 'string' ? p.invoice_id : typeof p.invoiceId === 'string' ? p.invoiceId : null
      if (!invoiceId) throw new Error('Identifiant de facture manquant.')
      const result = await sendInvoice(invoiceId)
      if (result.error) throw new Error(result.error)
      return { message: 'La facture a bien été envoyée au client par email.', deepLink: '/finances' }
    }

    case 'quote_send': {
      const quoteId = typeof p.quote_id === 'string' ? p.quote_id : typeof p.quoteId === 'string' ? p.quoteId : null
      if (!quoteId) throw new Error('Identifiant de devis manquant.')
      const result = await sendQuote(quoteId)
      if (result.error) throw new Error(result.error)
      return { message: 'Le devis a bien été envoyé au client pour signature.', deepLink: '/finances' }
    }

    case 'quote_mark_accepted': {
      const quoteId = typeof p.quote_id === 'string' ? p.quote_id : typeof p.quoteId === 'string' ? p.quoteId : null
      if (!quoteId) throw new Error('Identifiant de devis manquant.')
      const result = await markQuoteAccepted(quoteId)
      if (result.error) throw new Error(result.error)
      return { message: 'Le devis a bien été marqué comme accepté.', deepLink: '/finances' }
    }

    case 'quote_mark_refused': {
      const quoteId = typeof p.quote_id === 'string' ? p.quote_id : typeof p.quoteId === 'string' ? p.quoteId : null
      if (!quoteId) throw new Error('Identifiant de devis manquant.')
      if (!await hasPermission('quotes.edit')) throw new Error('Permission refusée.')
      const result = await markQuoteRefused(quoteId)
      if (result.error) throw new Error(result.error)
      return { message: 'Le devis a bien été marqué comme refusé.', deepLink: '/finances' }
    }

    case 'quote_followup': {
      const quoteId = typeof p.quote_id === 'string' ? p.quote_id : typeof p.quoteId === 'string' ? p.quoteId : null
      if (!quoteId) throw new Error('Identifiant de devis manquant.')
      if (!await hasPermission('reminders.send_manual') && !await hasPermission('quotes.send')) {
        throw new Error('Permission refusée.')
      }
      const subject = typeof p.subject === 'string' ? p.subject.trim() : ''
      const body = typeof p.draft_text === 'string' ? p.draft_text.trim() : typeof p.body === 'string' ? p.body.trim() : ''
      const result = await sendQuoteFollowup(quoteId, subject && body ? { subject, body } : undefined)
      if (result.error) throw new Error(result.error)
      return { message: 'La relance du devis a bien été envoyée au client.', deepLink: '/reminders' }
    }

    case 'open_url':
    case 'open_quote_editor':
    case 'open_invoice_editor':
    case 'open_client':
    case 'open_chantier':
      return { message: 'Je vous redirige vers le bon écran.', deepLink: proposal.deep_link }

    default:
      throw new Error(`Action Sarah non reconnue : ${proposal.type}.`)
  }
}

export async function confirmSarahAction(proposalId: string): Promise<{ ok: boolean; message: string; deepLink?: string | null; error?: string }> {
  if (!await hasPermission('ai.sarah')) {
    return { ok: false, message: 'Accès non autorisé.', error: 'permission_denied' }
  }

  const membership = await getCurrentMembershipContext()
  const orgId = await getCurrentOrganizationId()
  if (!membership || !orgId) return { ok: false, message: 'Non connecté.', error: 'unauthenticated' }

  const supabase = await createClient()
  const admin = createAdminClient()
  const { data } = await supabase
    .from('sarah_action_proposals')
    .select('*')
    .eq('id', proposalId)
    .eq('organization_id', orgId)
    .eq('status', 'pending')
    .or(`user_id.is.null,user_id.eq.${membership.userId}`)
    .maybeSingle()

  const proposal = data as SarahActionProposal | null
  if (!proposal) {
    // Plus aucune ligne "pending" : soit elle a déjà été traitée (double-clic,
    // retry après timeout réseau), soit elle n'existe pas. On regarde l'état réel
    // pour répondre de façon idempotente sans relancer l'action.
    const { data: existing } = await admin
      .from('sarah_action_proposals')
      .select('*')
      .eq('id', proposalId)
      .eq('organization_id', orgId)
      .maybeSingle()
    const already = existing as SarahActionProposal | null
    if (already?.status === 'executed') {
      return { ok: true, message: 'Cette action a déjà été effectuée.', deepLink: already.deep_link }
    }
    if (already?.status === 'failed') {
      return { ok: false, message: already.error ?? 'Action impossible.', error: 'execution_failed' }
    }
    return { ok: false, message: 'Proposition introuvable ou déjà traitée.', error: 'not_found' }
  }
  if (new Date(proposal.expires_at).getTime() < Date.now()) {
    await admin
      .from('sarah_action_proposals')
      .update({ status: 'expired' })
      .eq('id', proposalId)
      .eq('organization_id', orgId)
    return { ok: false, message: 'Cette proposition a expiré.', error: 'expired' }
  }

  // Réservation atomique : on tente de basculer pending → executed AVANT
  // d'exécuter l'effet de bord. Si une requête concurrente (double-clic, retry)
  // a déjà pris la proposition, le filtre status='pending' ne renvoie aucune
  // ligne et on s'arrête sans recréer un second devis/facture.
  const { data: claimed } = await admin
    .from('sarah_action_proposals')
    .update({ status: 'executed', executed_at: new Date().toISOString(), error: null })
    .eq('id', proposalId)
    .eq('organization_id', orgId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (!claimed) {
    const { data: existing } = await admin
      .from('sarah_action_proposals')
      .select('status, deep_link, error')
      .eq('id', proposalId)
      .eq('organization_id', orgId)
      .maybeSingle()
    const already = existing as Pick<SarahActionProposal, 'status' | 'deep_link' | 'error'> | null
    if (already?.status === 'failed') {
      return { ok: false, message: already.error ?? 'Action impossible.', error: 'execution_failed' }
    }
    return { ok: true, message: 'Cette action a déjà été effectuée.', deepLink: already?.deep_link ?? proposal.deep_link }
  }

  try {
    const result = await executeProposalSideEffect(proposal, orgId)
    // L'effet de bord peut produire un deep link plus précis (id du devis créé) :
    // on le persiste pour que les retours suivants pointent au bon endroit.
    if (result.deepLink && result.deepLink !== proposal.deep_link) {
      await admin
        .from('sarah_action_proposals')
        .update({ deep_link: result.deepLink })
        .eq('id', proposalId)
        .eq('organization_id', orgId)
    }
    return { ok: true, message: result.message, deepLink: result.deepLink }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Action impossible.'
    // L'effet de bord a échoué : on repasse en "failed" pour autoriser un nouvel essai.
    await admin
      .from('sarah_action_proposals')
      .update({ status: 'failed', error: message, executed_at: null })
      .eq('id', proposalId)
      .eq('organization_id', orgId)
    return { ok: false, message, error: 'execution_failed' }
  }
}

export async function dismissSarahAction(proposalId: string): Promise<{ ok: boolean }> {
  if (!await hasPermission('ai.sarah')) return { ok: false }
  const membership = await getCurrentMembershipContext()
  const orgId = await getCurrentOrganizationId()
  if (!membership || !orgId) return { ok: false }

  const supabase = await createClient()
  await supabase
    .from('sarah_action_proposals')
    .update({ status: 'dismissed', dismissed_at: new Date().toISOString() })
    .eq('id', proposalId)
    .eq('organization_id', orgId)
    .eq('status', 'pending')
    .or(`user_id.is.null,user_id.eq.${membership.userId}`)

  return { ok: true }
}
