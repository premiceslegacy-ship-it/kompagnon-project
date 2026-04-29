'use server'

import React from 'react'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { CreateQuoteSchema, UpdateQuoteSchema, UpsertQuoteItemSchema } from '@/lib/validations/quotes'
import { getQuoteById } from '@/lib/data/queries/quotes'
import { getOrganization } from '@/lib/data/queries/organization'
import { sendEmail } from '@/lib/email'
import { buildQuoteSentEmail } from '@/lib/email/templates'
import { getClientGreetingName } from '@/lib/client'
import { renderToBuffer } from '@react-pdf/renderer'
import QuotePDF from '@/components/pdf/QuotePDF'
import type { Client } from '@/lib/data/queries/clients'
import { coerceLegalVatRate } from '@/lib/utils'
import { hasPermission } from '@/lib/data/queries/membership'

type Result = { error: string | null }

type AIQuoteDraftInput = {
  title?: string | null
  clientName?: string | null
  sections: Array<{
    title?: string | null
    items: Array<{
      description?: string | null
      quantity: number
      unit?: string | null
      unit_price: number
      vat_rate?: number
      is_internal?: boolean
      is_estimated?: boolean
    }>
  }>
}

function normalizeSearchText(value: string | null | undefined) {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9@.]+/g, ' ')
    .trim()
}

function looksInternalLine(sectionTitle: string | null | undefined, description: string | null | undefined) {
  const haystack = normalizeSearchText(`${sectionTitle ?? ''} ${description ?? ''}`)
  return [
    'main d oeuvre',
    'main d',
    'mo interne',
    'ressource interne',
    'cout interne',
    'cout de revient',
    'deplacement',
    'transport',
    'carburant',
    'frais de route',
    'coordination interne',
    'preparation interne',
  ].some(token => haystack.includes(token))
}

async function ensureQuoteEditable(quoteId: string, orgId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('quotes')
    .select('id')
    .eq('id', quoteId)
    .eq('organization_id', orgId)
    .single()

  return Boolean(data)
}

async function getQuoteIdForSection(sectionId: string, orgId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('quote_sections')
    .select('quote_id, quotes!inner(organization_id)')
    .eq('id', sectionId)
    .eq('quotes.organization_id', orgId)
    .single()

  return data?.quote_id ?? null
}

async function getQuoteIdForItem(itemId: string, orgId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('quote_items')
    .select('quote_id, quotes!inner(organization_id)')
    .eq('id', itemId)
    .eq('quotes.organization_id', orgId)
    .single()

  return data?.quote_id ?? null
}

async function findClientIdBySearch(searchRaw: string | null | undefined): Promise<string | null> {
  const search = normalizeSearchText(searchRaw)
  if (!search) return null

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return null

  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, contact_name, first_name, last_name, email, phone')
    .eq('organization_id', orgId)
    .eq('is_archived', false)

  let best: { id: string; score: number } | null = null
  for (const client of clients ?? []) {
    const fields = [
      client.company_name,
      client.contact_name,
      [client.first_name, client.last_name].filter(Boolean).join(' '),
      client.email,
      client.phone,
    ].filter(Boolean) as string[]

    let score = 0
    for (const field of fields) {
      const normalized = normalizeSearchText(field)
      if (!normalized) continue
      if (normalized === search) score = Math.max(score, 100)
      else if (normalized.includes(search) || search.includes(normalized)) score = Math.max(score, 80)
      else {
        const searchTokens = search.split(' ').filter(token => token.length >= 2)
        const fieldTokens = normalized.split(' ').filter(token => token.length >= 2)
        const matches = searchTokens.filter(token => fieldTokens.some(fieldToken => fieldToken === token || fieldToken.includes(token) || token.includes(fieldToken))).length
        if (matches > 0) score = Math.max(score, Math.round((matches / searchTokens.length) * 70))
      }
    }

    if (!best || score > best.score) best = { id: client.id, score }
  }

  return best && best.score >= 45 ? best.id : null
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createQuote(data: {
  clientId?: string | null
  title?: string
  currency?: string
}): Promise<{ quoteId: string | null; error: string | null }> {
  if (!(await hasPermission('quotes.create'))) return { quoteId: null, error: 'Permission refusée.' }

  const parsed = CreateQuoteSchema.safeParse(data)
  if (!parsed.success) return { quoteId: null, error: parsed.error.issues[0]?.message ?? 'Données invalides.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { quoteId: null, error: 'Non authentifié.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { quoteId: null, error: 'Organisation introuvable.' }

  const { data: quote, error } = await supabase
    .from('quotes')
    .insert({
      organization_id: orgId,
      client_id: data.clientId || null,
      title: data.title ?? 'Nouveau devis',
      currency: data.currency ?? 'EUR',
      status: 'draft',
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createQuote]', error)
    return { quoteId: null, error: 'Erreur lors de la création du devis.' }
  }

  revalidatePath('/finances')
  return { quoteId: quote.id, error: null }
}

export async function createQuoteFromAIResult(aiQuote: AIQuoteDraftInput): Promise<{ quoteId: string | null; clientId: string | null; error: string | null }> {
  const clientId = await findClientIdBySearch(aiQuote.clientName)
  const quoteRes = await createQuote({
    clientId,
    title: aiQuote.title?.trim() || 'Nouveau devis',
  })
  if (quoteRes.error || !quoteRes.quoteId) {
    return { quoteId: null, clientId, error: quoteRes.error ?? 'Impossible de créer le devis.' }
  }

  const quoteId = quoteRes.quoteId
  for (let si = 0; si < aiQuote.sections.length; si++) {
    const section = aiQuote.sections[si]
    const secRes = await upsertQuoteSection({
      quote_id: quoteId,
      title: section.title?.trim() || `Section ${si + 1}`,
      position: si + 1,
    })
    if (!secRes.sectionId) continue

    for (let ii = 0; ii < section.items.length; ii++) {
      const item = section.items[ii]
      await upsertQuoteItem({
        quote_id: quoteId,
        section_id: secRes.sectionId,
        type: 'custom',
        description: item.description ?? '',
        quantity: item.quantity,
        unit: item.unit ?? 'u',
        unit_price: item.unit_price,
        vat_rate: item.vat_rate,
        position: ii + 1,
        is_internal: item.is_internal === true || looksInternalLine(section.title, item.description),
      })
    }
  }

  return { quoteId, clientId, error: null }
}

// ─── Update header ────────────────────────────────────────────────────────────

export async function updateQuote(
  quoteId: string,
  updates: {
    title?: string
    client_id?: string | null
    currency?: string
    validity_days?: number
    notes_client?: string | null
    payment_conditions?: string | null
    discount_rate?: number | null
    deposit_rate?: number | null
    client_request_visible_on_pdf?: boolean
    aid_label?: string | null
    aid_amount?: number | null
  },
): Promise<Result> {
  if (!(await hasPermission('quotes.edit'))) return { error: 'Permission refusée.' }

  const parsed = UpdateQuoteSchema.safeParse(updates)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Données invalides.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { error } = await supabase
    .from('quotes')
    .update(updates)
    .eq('id', quoteId)
    .eq('organization_id', orgId)

  if (error) {
    console.error('[updateQuote]', error)
    return { error: 'Erreur lors de la mise à jour.' }
  }

  revalidatePath('/finances')
  return { error: null }
}

// ─── Sections ─────────────────────────────────────────────────────────────────

export async function upsertQuoteSection(section: {
  id?: string
  quote_id: string
  title: string
  position: number
}): Promise<{ sectionId: string | null; error: string | null }> {
  if (!(await hasPermission('quotes.edit'))) return { sectionId: null, error: 'Permission refusée.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { sectionId: null, error: 'Non authentifié.' }
  if (!(await ensureQuoteEditable(section.quote_id, orgId))) {
    return { sectionId: null, error: 'Devis introuvable.' }
  }

  const payload = section.id
    ? { id: section.id, quote_id: section.quote_id, title: section.title, position: section.position }
    : { quote_id: section.quote_id, title: section.title, position: section.position }

  const { data, error } = await supabase
    .from('quote_sections')
    .upsert(payload)
    .select('id')
    .single()

  if (error) return { sectionId: null, error: error.message }
  return { sectionId: data.id, error: null }
}

export async function deleteQuoteSection(sectionId: string): Promise<Result> {
  if (!(await hasPermission('quotes.edit'))) return { error: 'Permission refusée.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const quoteId = await getQuoteIdForSection(sectionId, orgId)
  if (!quoteId) return { error: 'Section introuvable.' }

  const { error } = await supabase.from('quote_sections').delete().eq('id', sectionId)
  if (error) return { error: error.message }
  await recalcQuoteTotals(quoteId, orgId)
  revalidatePath('/finances')
  return { error: null }
}

// ─── Items ────────────────────────────────────────────────────────────────────

export async function upsertQuoteItem(item: {
  id?: string
  quote_id: string
  section_id?: string | null
  type: 'material' | 'labor' | 'custom'
  material_id?: string | null
  labor_rate_id?: string | null
  description?: string | null
  quantity: number
  unit?: string | null
  unit_price: number
  vat_rate?: number
  position: number
  length_m?: number | null
  width_m?: number | null
  height_m?: number | null
  is_internal?: boolean
}): Promise<{ itemId: string | null; error: string | null }> {
  if (!(await hasPermission('quotes.edit'))) return { itemId: null, error: 'Permission refusée.' }

  const parsed = UpsertQuoteItemSchema.safeParse(item)
  if (!parsed.success) return { itemId: null, error: parsed.error.issues[0]?.message ?? 'Données invalides.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { itemId: null, error: 'Non authentifié.' }
  if (!(await ensureQuoteEditable(item.quote_id, orgId))) {
    return { itemId: null, error: 'Devis introuvable.' }
  }
  if (item.section_id) {
    const sectionQuoteId = await getQuoteIdForSection(item.section_id, orgId)
    if (sectionQuoteId !== item.quote_id) {
      return { itemId: null, error: 'Section introuvable pour ce devis.' }
    }
  }

  const total_ht = item.quantity * item.unit_price

  const payload = {
    ...item,
    total_ht,
    vat_rate: coerceLegalVatRate(item.vat_rate, 20),
  }

  const { data, error } = await supabase
    .from('quote_items')
    .upsert(payload)
    .select('id')
    .single()

  if (error) {
    console.error('[upsertQuoteItem]', error)
    return { itemId: null, error: error.message }
  }

  // Recalcul des totaux du devis
  await recalcQuoteTotals(item.quote_id, orgId)
  return { itemId: data.id, error: null }
}

export async function deleteQuoteItem(itemId: string, quoteId: string): Promise<Result> {
  if (!(await hasPermission('quotes.edit'))) return { error: 'Permission refusée.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const itemQuoteId = await getQuoteIdForItem(itemId, orgId)
  if (itemQuoteId !== quoteId) return { error: 'Ligne introuvable.' }

  const { error } = await supabase.from('quote_items').delete().eq('id', itemId)
  if (error) return { error: error.message }
  await recalcQuoteTotals(quoteId, orgId)
  return { error: null }
}

// ─── Recalcul totaux ──────────────────────────────────────────────────────────

async function recalcQuoteTotals(quoteId: string, orgId: string) {
  const supabase = await createClient()
  if (!(await ensureQuoteEditable(quoteId, orgId))) return

  const { data: items } = await supabase
    .from('quote_items')
    .select('quantity, unit_price, vat_rate, is_internal')
    .eq('quote_id', quoteId)

  if (!items) return

  // Les lignes internes (is_internal=true) ne comptent pas dans le total client
  const visible = items.filter(i => !i.is_internal)
  const total_ht = visible.reduce((sum, i) => sum + (i.quantity * i.unit_price), 0)
  const total_tva = visible.reduce((sum, i) => sum + (i.quantity * i.unit_price * (i.vat_rate ?? 20) / 100), 0)
  const total_ttc = total_ht + total_tva

  await supabase
    .from('quotes')
    .update({ total_ht, total_tva, total_ttc })
    .eq('id', quoteId)
    .eq('organization_id', orgId)
}

// ─── Send ─────────────────────────────────────────────────────────────────────

export async function sendQuote(quoteId: string): Promise<Result & { signUrl?: string }> {
  if (!(await hasPermission('quotes.send'))) return { error: 'Permission refusée.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  // Générer un token de signature unique
  const signatureToken = crypto.randomUUID()

  const { error } = await supabase
    .from('quotes')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      signature_token: signatureToken,
    })
    .eq('id', quoteId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

  // Construire le lien de signature
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const signUrl = `${appUrl}/sign/${signatureToken}`

  // Forcer le recalcul des totaux avant lecture (garantit que total_ttc est à jour)
  await recalcQuoteTotals(quoteId, orgId)

  // Charger les infos du devis + client + org pour l'email
  const { data: quote } = await supabase
    .from('quotes')
    .select('number, title, total_ttc, currency, valid_until, client_id')
    .eq('id', quoteId)
    .single()

  if (quote?.client_id) {
    const [{ data: client }, { data: customTpl }, organization, fullQuote] = await Promise.all([
      supabase.from('clients').select('*').eq('id', quote.client_id).single(),
      supabase.from('email_templates').select('subject, body_text').eq('organization_id', orgId).eq('slug', 'quote_sent').eq('is_active', true).maybeSingle(),
      getOrganization(),
      getQuoteById(quoteId),
    ])

    if (client?.email && organization) {
      const clientName = getClientGreetingName(client as any)

      let subject: string
      let html: string

      if (customTpl?.body_text) {
        const vars: Record<string, string> = {
          numero_devis: quote.number ?? '',
          client_nom: clientName,
          montant_ttc: new Intl.NumberFormat('fr-FR', { style: 'currency', currency: quote.currency ?? 'EUR' }).format(quote.total_ttc ?? 0),
          entreprise_nom: organization.name,
          lien_signature: signUrl,
        }
        const interpolate = (t: string) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, v), t)
        subject = interpolate(customTpl.subject ?? '')
        const bodyHtml = interpolate(customTpl.body_text).replace(/\n/g, '<br>')
        html = `<div style="max-width:560px;margin:0 auto;font-family:sans-serif"><div style="background:#0a0a0a;padding:24px 32px;border-radius:12px 12px 0 0"><p style="color:white;font-weight:bold;margin:0;font-size:16px">${organization.name}</p></div><div style="background:white;padding:32px;border-radius:0 0 12px 12px;border:1px solid #eee;border-top:none;line-height:1.7;color:#333;font-size:14px">${bodyHtml}</div></div>`
      } else {
        const built = buildQuoteSentEmail({
          orgName: organization.name,
          orgEmail: organization.email,
          clientName,
          quoteNumber: quote.number,
          quoteTitle: quote.title,
          totalTtc: quote.total_ttc,
          currency: quote.currency ?? 'EUR',
          validUntil: quote.valid_until,
          signUrl,
          emailSignature: organization.email_signature ?? null,
        })
        subject = built.subject
        html = built.html
      }

      // ── Générer le PDF en pièce jointe ──────────────────────────────────────
      let attachments: Array<{ filename: string; content: Buffer }> | undefined
      if (fullQuote) {
        const { data: quoteExtra } = await supabase
          .from('quotes')
          .select('notes_client, payment_conditions')
          .eq('id', quoteId)
          .single()

        const fullQuoteWithExtras = {
          ...fullQuote,
          notes_client: quoteExtra?.notes_client ?? null,
          payment_conditions: quoteExtra?.payment_conditions ?? null,
        }

        try {
          const pdfBuffer = await renderToBuffer(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            React.createElement(QuotePDF, {
              quote: fullQuoteWithExtras,
              organization,
              client: client as unknown as Client,
            }) as any,
          )
          attachments = [{
            filename: `devis-${quote.number ?? quoteId}.pdf`,
            content: Buffer.from(pdfBuffer),
          }]
        } catch (pdfErr) {
          console.error('[sendQuote] PDF generation error:', pdfErr)
        }
      }

      const emailResult = await sendEmail({ organizationId: orgId, to: client.email, subject, html, attachments })
      if (emailResult.error) {
        console.error('[sendQuote] email error:', emailResult.error)
        revalidatePath('/finances')
        return { error: emailResult.error, signUrl }
      }
    } else if (!client?.email) {
      revalidatePath('/finances')
      return { error: 'Ce client n\'a pas d\'adresse email. Ajoutez-en une dans sa fiche.', signUrl }
    }
  }

  revalidatePath('/finances')
  return { error: null, signUrl }
}

// ─── Mark as accepted ─────────────────────────────────────────────────────────

/**
 * Marque un devis comme accepté manuellement.
 * Met le statut à 'accepted' et enregistre signed_at.
 */
export async function markQuoteAccepted(quoteId: string): Promise<Result> {
  if (!(await hasPermission('quotes.edit'))) return { error: 'Permission refusée.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { error } = await supabase
    .from('quotes')
    .update({ status: 'accepted', signed_at: new Date().toISOString() })
    .eq('id', quoteId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/finances')
  revalidatePath('/clients')
  return { error: null }
}

// ─── Duplicate ────────────────────────────────────────────────────────────────

export async function duplicateQuote(quoteId: string): Promise<{ quoteId: string | null; error: string | null }> {
  if (!(await hasPermission('quotes.create'))) return { quoteId: null, error: 'Permission refusée.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  const { data: { user } } = await supabase.auth.getUser()
  if (!orgId || !user) return { quoteId: null, error: 'Non authentifié.' }

  // Charger le devis original
  const { data: original, error: fetchError } = await supabase
    .from('quotes')
    .select('title, client_id, currency, validity_days, notes_client, payment_conditions, discount_rate, deposit_rate')
    .eq('id', quoteId)
    .eq('organization_id', orgId)
    .single()

  if (fetchError || !original) return { quoteId: null, error: 'Devis introuvable.' }

  // Créer le nouveau devis
  const { data: newQuote, error: createError } = await supabase
    .from('quotes')
    .insert({
      organization_id: orgId,
      created_by: user.id,
      client_id: original.client_id,
      title: `${original.title ?? 'Devis'} (Copie)`,
      currency: original.currency ?? 'EUR',
      validity_days: original.validity_days,
      notes_client: original.notes_client,
      payment_conditions: original.payment_conditions,
      discount_rate: original.discount_rate,
      deposit_rate: original.deposit_rate,
      status: 'draft',
    })
    .select('id')
    .single()

  if (createError || !newQuote) return { quoteId: null, error: 'Erreur lors de la duplication.' }

  const newId = newQuote.id

  // Charger sections + items de l'original
  const [{ data: sections }, { data: items }] = await Promise.all([
    supabase.from('quote_sections').select('*').eq('quote_id', quoteId).order('position'),
    supabase.from('quote_items').select('*').eq('quote_id', quoteId).order('position'),
  ])

  // Dupliquer les sections et construire un mapping old_id → new_id
  const sectionMap: Record<string, string> = {}
  if (sections && sections.length > 0) {
    for (const sec of sections) {
      const { data: newSec } = await supabase
        .from('quote_sections')
        .insert({ quote_id: newId, title: sec.title, position: sec.position })
        .select('id')
        .single()
      if (newSec) sectionMap[sec.id] = newSec.id
    }
  }

  // Dupliquer les items
  if (items && items.length > 0) {
    const newItems = items.map(({ id: _id, quote_id: _qid, created_at: _ca, updated_at: _ua, ...rest }) => ({
      ...rest,
      quote_id: newId,
      section_id: rest.section_id ? (sectionMap[rest.section_id] ?? null) : null,
    }))
    await supabase.from('quote_items').insert(newItems)
    await recalcQuoteTotals(newId, orgId)
  }

  revalidatePath('/finances')
  return { quoteId: newId, error: null }
}

// ─── Archive ──────────────────────────────────────────────────────────────────

export async function archiveQuote(quoteId: string): Promise<Result> {
  if (!(await hasPermission('quotes.delete'))) return { error: 'Permission refusée.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { error } = await supabase
    .from('quotes')
    .update({ is_archived: true })
    .eq('id', quoteId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/finances')
  return { error: null }
}

// ─── Quote items for AI suggestions ──────────────────────────────────────────

export type QuoteSuggestionItems = {
  visible: Array<{ description: string }>
  internal: Array<{ designation: string; quantity: number; unit: string; rate: number }>
}

export async function getQuoteItemsForSuggestions(quoteId: string): Promise<QuoteSuggestionItems> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { visible: [], internal: [] }
  const orgId = await getCurrentOrganizationId()
  if (!orgId || !(await ensureQuoteEditable(quoteId, orgId))) return { visible: [], internal: [] }

  const { data } = await supabase
    .from('quote_items')
    .select('description, is_internal, quantity, unit, unit_price')
    .eq('quote_id', quoteId)
    .order('position')

  if (!data) return { visible: [], internal: [] }

  return {
    visible: data
      .filter(i => !i.is_internal && (i.description ?? '').trim())
      .map(i => ({ description: i.description as string })),
    internal: data
      .filter(i => i.is_internal && (i.description ?? '').trim())
      .map(i => ({ designation: i.description as string, quantity: i.quantity, unit: i.unit ?? 'h', rate: i.unit_price })),
  }
}
