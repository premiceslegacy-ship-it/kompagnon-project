'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getCatalogDocumentVatRate, getInternalResourceUnitCost } from '@/lib/catalog-ui'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { buildMaterialSelectionPricing, type DimensionPricingMode, type MaterialPriceVariant } from '@/lib/catalog-pricing'
import { sendAuthEmail } from '@/lib/email'
import { buildQuoteRequestNotificationEmail } from '@/lib/email/templates'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

function splitContactName(fullName: string | null | undefined): { firstName: string | null; lastName: string | null } {
  const trimmed = fullName?.trim() ?? ''
  if (!trimmed) return { firstName: null, lastName: null }
  const [firstName, ...rest] = trimmed.split(/\s+/)
  return {
    firstName: firstName || null,
    lastName: rest.length > 0 ? rest.join(' ') : null,
  }
}

function buildClientPayloadFromRequest(req: {
  company_name?: string | null
  name?: string | null
  email?: string | null
  phone?: string | null
}) {
  const companyName = req.company_name?.trim() || null
  const contactName = req.name?.trim() || null
  const { firstName, lastName } = splitContactName(contactName)

  if (companyName) {
    return {
      company_name: companyName,
      contact_name: contactName,
      first_name: firstName,
      last_name: lastName,
      type: 'company' as const,
      source: 'web' as const,
    }
  }

  return {
    company_name: null,
    contact_name: null,
    first_name: firstName,
    last_name: lastName,
    type: 'individual' as const,
    source: 'web' as const,
  }
}

// ─── Submit (public — pas d'auth requise) ─────────────────────────────────────

export type SubmitRequestState = {
  error: string | null
  success: boolean
}

export async function submitQuoteRequest(
  _prevState: SubmitRequestState,
  formData: FormData,
): Promise<SubmitRequestState> {
  // ── Honeypot anti-bot : si le champ caché est rempli, on simule un succès
  const honeypot = (formData.get('_hp_website') as string) ?? ''
  if (honeypot.length > 0) return { error: null, success: true }

  const orgSlug = (formData.get('org_slug') as string)?.trim()
  if (!orgSlug) return { error: "Organisation introuvable.", success: false }

  const name = (formData.get('name') as string)?.trim()
  const email = (formData.get('email') as string)?.trim()
  const description = (formData.get('description') as string)?.trim()

  if (!name || !email || !description) {
    return { error: "Veuillez remplir tous les champs obligatoires.", success: false }
  }

  // Validation email stricte : format + domaine avec extension
  const emailRe = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/
  if (!emailRe.test(email)) {
    return { error: "L'adresse email n'est pas valide.", success: false }
  }
  // Bloquer les domaines jetables les plus courants
  const domain = email.split('@')[1].toLowerCase()
  const blockedDomains = [
    // Boites jetables classiques
    'mailinator.com', 'guerrillamail.com', 'guerrillamailblock.com', 'sharklasers.com',
    'guerrillamail.info', 'grr.la', 'guerrillamail.biz', 'guerrillamail.de', 'guerrillamail.net', 'guerrillamail.org',
    'tempmail.com', 'throwam.com', 'trashmail.com', 'trashmail.at', 'trashmail.io', 'trashmail.me', 'trashmail.net',
    'yopmail.com', 'yopmail.fr', 'cool.fr.nf', 'jetable.fr.nf', 'nospam.ze.tc', 'nomail.xl.cx', 'mega.zik.dj',
    'speed.1s.fr', 'courriel.fr.nf', 'moncourrier.fr.nf', 'monemail.fr.nf', 'monmail.fr.nf',
    'fakeinbox.com', 'dispostable.com', 'maildrop.cc', 'mailnull.com', 'spamgourmet.com',
    'tempr.email', 'tempinbox.com', 'mailtemp.net', 'temp-mail.org', 'temp-mail.ru',
    'throwam.com', 'throwaway.email', 'spamfree24.org', 'spam4.me', 'spamgob.com',
    'getnada.com', 'mailnesia.com', 'mailzilla.com', 'spamevader.com', 'incognitomail.com',
    'anonymbox.com', 'crap.handspam.com', 'spam.la', 'nospamfor.us', 'tempemail.net',
    'notmailinator.com', 'putthisinyourspamdatabase.com', 'spamavert.com', 'mailscrap.com',
    'filzmail.com', 'e4ward.com', 'mytrashmail.com', 'sogetthis.com', 'trashdevil.com',
    'wegwerfmail.de', 'wegwerfmail.net', 'wegwerfmail.org', 'objectmail.com', 'spamherelots.com',
  ]
  if (blockedDomains.includes(domain)) {
    return { error: "Les adresses email temporaires ne sont pas acceptées.", success: false }
  }

  const phone = (formData.get('phone') as string)?.trim() || null
  const company_name = (formData.get('company_name') as string)?.trim() || null
  const chantier_address_line1 = (formData.get('chantier_address_line1') as string)?.trim() || null
  const chantier_postal_code = (formData.get('chantier_postal_code') as string)?.trim() || null
  const chantier_city = (formData.get('chantier_city') as string)?.trim() || null
  const subject = (formData.get('subject') as string)?.trim() || null
  const prestation_type = (formData.get('prestation_type') as string)?.trim() || null
  const dimensions = (formData.get('dimensions') as string)?.trim() || null
  const attachment_url = (formData.get('attachment_url') as string)?.trim() || null
  const type = (formData.get('type') as string)?.trim() || 'custom'

  let catalog_items = null
  const catalogItemsRaw = formData.get('catalog_items') as string | null
  if (catalogItemsRaw) {
    try { catalog_items = JSON.parse(catalogItemsRaw) } catch { /* ignore */ }
  }

  let attachments = null
  const attachmentsRaw = formData.get('attachments') as string | null
  if (attachmentsRaw) {
    try {
      const parsed = JSON.parse(attachmentsRaw)
      attachments = Array.isArray(parsed) ? parsed : null
    } catch {
      attachments = null
    }
  }

  const admin = createAdminClient()
  const { data: org, error: orgError } = await admin
    .from('organizations')
    .select('id, name, public_form_notification_email')
    .eq('slug', orgSlug)
    .single()

  if (orgError || !org) {
    return { error: "Organisation introuvable. Vérifiez le lien utilisé.", success: false }
  }

  const requestHeaders = await headers()
  const ip = getClientIp(requestHeaders)
  const publicFormLimit = await checkRateLimit({
    scope: 'public_quote_request',
    identifier: `${org.id}:${email.toLowerCase()}:${ip}`,
    limit: Number.parseInt(process.env.PUBLIC_FORM_RATE_LIMIT_PER_HOUR ?? '5', 10),
    windowSeconds: 60 * 60,
  })

  if (!publicFormLimit.allowed) {
    return { error: "Trop de demandes envoyées récemment. Veuillez réessayer plus tard ou contacter directement l'entreprise.", success: false }
  }

  // ── Rate limiting : max 3 soumissions par email par 24h
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count: emailCount } = await admin
    .from('quote_requests')
    .select('id', { count: 'exact', head: true })
    .eq('email', email)
    .eq('organization_id', org.id)
    .gte('created_at', since24h)

  if ((emailCount ?? 0) >= 3) {
    return { error: "Une demande a déjà été envoyée récemment avec cet email. Veuillez réessayer demain ou contacter directement l'entreprise.", success: false }
  }

  const { error } = await admin.from('quote_requests').insert({
    organization_id: org.id,
    name, email, phone, company_name, subject, description,
    prestation_type, dimensions, attachment_url,
    chantier_address_line1, chantier_postal_code, chantier_city,
    type, catalog_items, attachments,
    status: 'new',
  })

  if (error) {
    console.error('[submitQuoteRequest]', error)
    return { error: "Une erreur est survenue. Veuillez réessayer.", success: false }
  }

  // ── Email de notification à l'artisan
  const notifEmail = (org as { public_form_notification_email?: string | null }).public_form_notification_email
  if (notifEmail) {
    const chantierAddress = chantier_city
      ? [chantier_address_line1, chantier_postal_code, chantier_city].filter(Boolean).join(', ')
      : null
    const { subject: notifSubject, html: notifHtml } = buildQuoteRequestNotificationEmail({
      orgName: org.name,
      name,
      email,
      phone,
      companyName: company_name,
      chantierAddress,
      description,
    })
    await sendAuthEmail({ to: notifEmail, subject: notifSubject, html: notifHtml })
  }

  return { error: null, success: true }
}

// ─── Actions in-app ───────────────────────────────────────────────────────────

export async function markRequestRead(requestId: string): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { error } = await supabase
    .from('quote_requests')
    .update({ status: 'read' })
    .eq('id', requestId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/requests')
  return { error: null }
}

export async function archiveRequest(requestId: string): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { error } = await supabase
    .from('quote_requests')
    .update({ status: 'archived' })
    .eq('id', requestId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/requests')
  return { error: null }
}

// ─── Conversion demande → lead + devis auto ───────────────────────────────────

export type ConvertRequestResult = {
  error: string | null
  clientId: string | null
  quoteId: string | null
}

/**
 * Convertit une demande de devis en client lead_hot + génère un devis brouillon.
 * Matching par mots-clés entre la description et le catalogue de l'organisation.
 */
export async function convertRequestToLeadAndQuote(
  requestId: string,
): Promise<ConvertRequestResult> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.', clientId: null, quoteId: null }

  // 1. Récupérer la demande
  const { data: req, error: reqErr } = await supabase
    .from('quote_requests')
    .select('*')
    .eq('id', requestId)
    .eq('organization_id', orgId)
    .single()

  if (reqErr || !req) return { error: 'Demande introuvable.', clientId: null, quoteId: null }
  if (req.client_id) return { error: null, clientId: req.client_id, quoteId: req.quote_id }

  // 2. Créer le client (lead_hot)
  const { data: { user } } = await supabase.auth.getUser()
  const clientPayload = buildClientPayloadFromRequest(req)
  const { data: newClient, error: clientErr } = await supabase
    .from('clients')
    .insert({
      organization_id: orgId,
      ...clientPayload,
      email: req.email,
      phone: req.phone || null,
      status: 'lead_hot',
      created_by: user!.id,
    })
    .select('id')
    .single()

  if (clientErr || !newClient) {
    console.error('[convertRequest] client insert error', clientErr)
    return { error: 'Erreur lors de la création du client.', clientId: null, quoteId: null }
  }

  // 3. Keyword matching contre le catalogue
  const text = [req.subject, req.description, req.prestation_type, req.dimensions]
    .filter(Boolean).join(' ').toLowerCase()
  const words = text.split(/\W+/).filter(w => w.length >= 3)

  const [{ data: materials }, { data: laborRates }, { data: orgConfig }] = await Promise.all([
    supabase.from('materials').select('id, name, reference, unit, sale_price').eq('organization_id', orgId).eq('is_active', true),
    supabase.from('labor_rates').select('id, designation, reference, unit, rate, cost_rate').eq('organization_id', orgId).eq('is_active', true),
    supabase.from('organizations').select('is_vat_subject, default_vat_rate').eq('id', orgId).single(),
  ])
  const defaultVatRate = getCatalogDocumentVatRate({
    isVatSubject: orgConfig?.is_vat_subject ?? true,
    defaultVatRate: orgConfig?.default_vat_rate ?? 20,
  })

  function score(name: string, ref: string | null) {
    const haystack = `${name} ${ref ?? ''}`.toLowerCase()
    return words.filter(w => haystack.includes(w)).length
  }

  const matchedMaterials = (materials ?? [])
    .map(m => ({ ...m, _score: score(m.name, m.reference) }))
    .filter(m => m._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, 8)

  const matchedLabor = (laborRates ?? [])
    .map(l => ({ ...l, _score: score(l.designation, l.reference) }))
    .filter(l => l._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, 4)

  // 4. Créer le devis brouillon
  const title = req.subject || `Demande de ${req.company_name || req.name}`
  const admin = createAdminClient()
  const { data: newQuote, error: quoteErr } = await admin
    .from('quotes')
    .insert({
      organization_id: orgId,
      client_id: newClient.id,
      title,
      ai_generated: true,
      status: 'draft',
      created_by: user!.id,
      client_request_description: req.description || null,
    })
    .select('id')
    .single()

  if (quoteErr || !newQuote) {
    console.error('[convertRequest] quote insert error', quoteErr)
    return { error: 'Erreur lors de la création du devis.', clientId: newClient.id, quoteId: null }
  }

  // 5. Créer une section + les lignes matchées
  const { data: section, error: sectionErr } = await admin
    .from('quote_sections')
    .insert({ quote_id: newQuote.id, title: 'Proposition automatique', position: 1 })
    .select('id')
    .single()

  if (sectionErr || !section) {
    console.error('[convertRequest] section insert error', sectionErr)
  } else {
    const items = [
      ...matchedMaterials.map((m, i) => ({
        quote_id: newQuote.id,
        section_id: section.id,
        type: 'material' as const,
        material_id: m.id,
        description: m.name,
        unit: m.unit ?? 'u',
        quantity: 1,
        unit_price: m.sale_price ?? 0,
        vat_rate: defaultVatRate,
        position: i + 1,
        is_internal: false,
      })),
      ...matchedLabor.map((l, i) => ({
        quote_id: newQuote.id,
        section_id: section.id,
        type: 'labor' as const,
        labor_rate_id: l.id,
        description: l.designation,
        unit: l.unit ?? 'h',
        quantity: 1,
        unit_price: getInternalResourceUnitCost(l),
        vat_rate: defaultVatRate,
        position: matchedMaterials.length + i + 1,
        is_internal: true,
      })),
    ]
    if (items.length > 0) {
      await admin.from('quote_items').insert(items)
    }
  }

  // 6. Mettre à jour la demande
  await supabase
    .from('quote_requests')
    .update({ status: 'converted', client_id: newClient.id, quote_id: newQuote.id })
    .eq('id', requestId)

  revalidatePath('/requests')
  revalidatePath('/clients')
  revalidatePath('/finances')

  return { error: null, clientId: newClient.id, quoteId: newQuote.id }
}

// ─── Conversion demande catalogue → client + devis avec items catalogue ────────

type CatalogItem = {
  id: string
  item_type: 'material' | 'labor' | 'prestation'
  description: string
  unit: string | null
  quantity: number
  length_m?: number | null
  width_m?: number | null
  height_m?: number | null
  dimension_pricing_mode?: DimensionPricingMode | null
  dimension_pricing_enabled?: boolean
  base_length_m?: number | null
  base_width_m?: number | null
  base_height_m?: number | null
  lines?: Array<{
    id: string
    item_type: 'material' | 'service' | 'labor' | 'transport' | 'free'
    material_id: string | null
    labor_rate_id: string | null
    designation: string
    quantity: number
    unit: string
    unit_price_ht: number
    details?: string
    length_m?: number | null
    width_m?: number | null
    height_m?: number | null
    dimension_pricing_mode?: DimensionPricingMode | null
    dimension_pricing_enabled: boolean
    base_length_m: number | null
    base_width_m: number | null
    base_height_m?: number | null
  }>
}

function getCatalogItemMode(
  mode: DimensionPricingMode | null | undefined,
  enabled: boolean | null | undefined,
): DimensionPricingMode {
  if (mode && mode !== 'none') return mode
  return enabled ? 'area' : 'none'
}

export async function createQuoteFromCatalogRequest(
  requestId: string,
): Promise<ConvertRequestResult> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.', clientId: null, quoteId: null }

  const { data: req, error: reqErr } = await supabase
    .from('quote_requests')
    .select('*')
    .eq('id', requestId)
    .eq('organization_id', orgId)
    .single()

  if (reqErr || !req) return { error: 'Demande introuvable.', clientId: null, quoteId: null }
  if (req.client_id) return { error: null, clientId: req.client_id, quoteId: req.quote_id }

  const { data: { user } } = await supabase.auth.getUser()
  const clientPayload = buildClientPayloadFromRequest(req)
  const adminClient = createAdminClient()

  const { data: newClient, error: clientErr } = await adminClient
    .from('clients')
    .insert({
      organization_id: orgId,
      ...clientPayload,
      email: req.email,
      phone: req.phone || null,
      status: 'lead_hot',
      created_by: user!.id,
    })
    .select('id')
    .single()

  if (clientErr || !newClient) {
    console.error('[createQuoteFromCatalogRequest] client error', clientErr)
    return { error: 'Erreur lors de la création du client.', clientId: null, quoteId: null }
  }

  const catalogItems: CatalogItem[] = Array.isArray(req.catalog_items) ? req.catalog_items : []
  const itemsLabel = catalogItems.length > 0
    ? catalogItems.map(i => i.description).filter(Boolean).join(', ')
    : null
  const title = req.subject || itemsLabel || req.description?.slice(0, 80) || `Devis ${req.company_name || req.name}`
  const { data: newQuote, error: quoteErr } = await adminClient
    .from('quotes')
    .insert({
      organization_id: orgId,
      client_id: newClient.id,
      title,
      status: 'draft',
      created_by: user!.id,
      client_request_description: req.description || null,
    })
    .select('id')
    .single()

  if (quoteErr || !newQuote) {
    console.error('[createQuoteFromCatalogRequest] quote error', quoteErr)
    return { error: 'Erreur lors de la création du devis.', clientId: newClient.id, quoteId: null }
  }
  const { data: orgConfig } = await adminClient
    .from('organizations')
    .select('is_vat_subject, default_vat_rate')
    .eq('id', orgId)
    .single()
  const defaultVatRate = getCatalogDocumentVatRate({
    isVatSubject: orgConfig?.is_vat_subject ?? true,
    defaultVatRate: orgConfig?.default_vat_rate ?? 20,
  })

  if (catalogItems.length > 0) {
    const materialIds = catalogItems.filter(ci => ci.item_type === 'material').map(ci => ci.id)
    const laborIds = catalogItems.filter(ci => ci.item_type === 'labor').map(ci => ci.id)
    const prestationMaterialIds = catalogItems.flatMap(ci =>
      ci.item_type === 'prestation'
        ? (ci.lines ?? []).map(line => line.material_id).filter((id): id is string => Boolean(id))
        : [],
    )
    const allMaterialIds = Array.from(new Set([...materialIds, ...prestationMaterialIds]))

    const { data: materialsData } = allMaterialIds.length > 0
      ? await adminClient
          .from('materials')
          .select('id, name, unit, sale_price, purchase_price, dimension_pricing_mode, dimension_pricing_enabled, base_length_m, base_width_m, base_height_m, price_variants:material_price_variants(*)')
          .in('id', allMaterialIds)
      : { data: [] }

    const matMap = new Map((materialsData ?? []).map(m => [m.id, m]))

    const { data: laborData } = laborIds.length > 0
      ? await adminClient
          .from('labor_rates')
          .select('id, designation, unit, rate, cost_rate')
          .in('id', laborIds)
      : { data: [] }

    const laborMap = new Map((laborData ?? []).map(l => [l.id, l]))

    const { data: section, error: sectionErr } = await adminClient
      .from('quote_sections')
      .insert({ quote_id: newQuote.id, title: 'Prestations demandées', position: 1 })
      .select('id')
      .single()

    if (sectionErr || !section) {
      console.error('[createQuoteFromCatalogRequest] section insert error', sectionErr)
      return { error: 'Erreur lors de la création de la section.', clientId: newClient.id, quoteId: newQuote.id }
    }

    const visibleItems: Array<Record<string, unknown>> = []
    const internalItems: Array<Record<string, unknown>> = []
    let position = 1

    for (const ci of catalogItems) {
      if (ci.item_type === 'material') {
        const mat = matMap.get(ci.id)
        const itemMode = getCatalogItemMode(
          ci.dimension_pricing_mode ?? (mat as { dimension_pricing_mode?: DimensionPricingMode | null } | undefined)?.dimension_pricing_mode,
          ci.dimension_pricing_enabled ?? (mat as { dimension_pricing_enabled?: boolean | null } | undefined)?.dimension_pricing_enabled,
        )
        const usesDimensionPricing = itemMode !== 'none'
        const pricing = buildMaterialSelectionPricing({
          item: {
            sale_price: mat?.sale_price ?? null,
            purchase_price: mat?.purchase_price ?? null,
            unit: mat?.unit ?? ci.unit ?? 'u',
            dimension_pricing_mode: itemMode,
            base_length_m: ci.base_length_m ?? mat?.base_length_m ?? null,
            base_width_m: ci.base_width_m ?? mat?.base_width_m ?? null,
            base_height_m: ci.base_height_m ?? (mat as { base_height_m?: number | null } | undefined)?.base_height_m ?? null,
            price_variants: ((mat as { price_variants?: MaterialPriceVariant[] } | undefined)?.price_variants ?? []) as MaterialPriceVariant[],
          },
          requestedLengthM: ci.length_m ?? null,
          requestedWidthM: ci.width_m ?? null,
          requestedHeightM: ci.height_m ?? null,
        })

        visibleItems.push({
          quote_id: newQuote.id,
          section_id: section.id,
          type: 'material',
          material_id: ci.id,
          description: ci.description,
          unit: pricing.unit,
          quantity: usesDimensionPricing ? pricing.quantity : ci.quantity,
          unit_price: usesDimensionPricing ? pricing.unitPrice : (mat?.sale_price ?? 0),
          vat_rate: defaultVatRate,
          position: position++,
          length_m: usesDimensionPricing ? pricing.lengthM : null,
          width_m: usesDimensionPricing ? pricing.widthM : null,
          height_m: usesDimensionPricing ? pricing.heightM : null,
          is_internal: false,
        })

        if (pricing.purchaseUnitPrice > 0 || mat?.purchase_price) {
          internalItems.push({
            quote_id: newQuote.id,
            section_id: section.id,
            type: 'material',
            material_id: ci.id,
            description: ci.description,
            unit: pricing.unit,
            quantity: usesDimensionPricing ? pricing.quantity : ci.quantity,
            unit_price: usesDimensionPricing ? pricing.purchaseUnitPrice : (mat?.purchase_price ?? 0),
            vat_rate: defaultVatRate,
            position: position++,
            length_m: usesDimensionPricing ? pricing.lengthM : null,
            width_m: usesDimensionPricing ? pricing.widthM : null,
            height_m: usesDimensionPricing ? pricing.heightM : null,
            is_internal: true,
          })
        }
        continue
      }

      if (ci.item_type === 'labor') {
        const labor = laborMap.get(ci.id)
        visibleItems.push({
          quote_id: newQuote.id,
          section_id: section.id,
          type: 'labor',
          labor_rate_id: ci.id,
          description: ci.description,
          unit: labor?.unit ?? ci.unit ?? 'h',
          quantity: ci.quantity,
          unit_price: labor?.rate ?? 0,
          vat_rate: defaultVatRate,
          position: position++,
          is_internal: false,
        })

        if (labor?.cost_rate) {
          internalItems.push({
            quote_id: newQuote.id,
            section_id: section.id,
            type: 'labor',
            labor_rate_id: ci.id,
            description: ci.description,
            unit: labor.unit ?? ci.unit ?? 'h',
            quantity: ci.quantity,
            unit_price: labor.cost_rate,
            vat_rate: defaultVatRate,
            position: position++,
            is_internal: true,
          })
        }
        continue
      }

      for (const line of ci.lines ?? []) {
        const mat = line.material_id ? matMap.get(line.material_id) : null
        const lineMode = getCatalogItemMode(
          line.dimension_pricing_mode ?? (mat as { dimension_pricing_mode?: DimensionPricingMode | null } | undefined)?.dimension_pricing_mode,
          line.dimension_pricing_enabled ?? (mat as { dimension_pricing_enabled?: boolean | null } | undefined)?.dimension_pricing_enabled,
        )
        const usesDimensionPricing = lineMode !== 'none'
        const pricing = usesDimensionPricing
          ? buildMaterialSelectionPricing({
              item: {
                sale_price: mat?.sale_price ?? line.unit_price_ht,
                purchase_price: mat?.purchase_price ?? null,
                unit: line.unit,
                dimension_pricing_mode: lineMode,
                base_length_m: line.base_length_m,
                base_width_m: line.base_width_m,
                base_height_m: line.base_height_m ?? (mat as { base_height_m?: number | null } | undefined)?.base_height_m ?? null,
                price_variants: ((mat as { price_variants?: MaterialPriceVariant[] } | undefined)?.price_variants ?? []) as MaterialPriceVariant[],
              },
              requestedLengthM: line.length_m ?? null,
              requestedWidthM: line.width_m ?? null,
              requestedHeightM: line.height_m ?? null,
            })
          : null

        visibleItems.push({
          quote_id: newQuote.id,
          section_id: section.id,
          type: line.item_type === 'labor' ? 'labor' : line.item_type === 'material' || line.item_type === 'service' ? 'material' : 'custom',
          material_id: line.material_id,
          labor_rate_id: line.labor_rate_id,
          description: line.designation,
          unit: pricing?.unit ?? line.unit,
          quantity: pricing?.quantity ?? line.quantity,
          unit_price: pricing?.unitPrice ?? line.unit_price_ht,
          vat_rate: defaultVatRate,
          position: position++,
          length_m: pricing?.lengthM ?? null,
          width_m: pricing?.widthM ?? null,
          height_m: pricing?.heightM ?? null,
          is_internal: false,
        })

        if ((line.item_type === 'material' || line.item_type === 'service') && ((pricing?.purchaseUnitPrice ?? 0) > 0 || mat?.purchase_price)) {
          internalItems.push({
            quote_id: newQuote.id,
            section_id: section.id,
            type: 'material',
            material_id: line.material_id,
            description: `${line.designation}`,
            unit: pricing?.unit ?? line.unit,
            quantity: pricing?.quantity ?? line.quantity,
            unit_price: pricing?.purchaseUnitPrice ?? mat?.purchase_price ?? 0,
            vat_rate: defaultVatRate,
            position: position++,
            length_m: pricing?.lengthM ?? null,
            width_m: pricing?.widthM ?? null,
            height_m: pricing?.heightM ?? null,
            is_internal: true,
          })
        }
      }
    }

    if (visibleItems.length > 0) await adminClient.from('quote_items').insert(visibleItems)
    if (internalItems.length > 0) await adminClient.from('quote_items').insert(internalItems)
  }

  await adminClient
    .from('quote_requests')
    .update({ status: 'converted', client_id: newClient.id, quote_id: newQuote.id })
    .eq('id', requestId)

  revalidatePath('/requests')
  revalidatePath('/clients')
  revalidatePath('/finances')

  return { error: null, clientId: newClient.id, quoteId: newQuote.id }
}

// ─── Paramètres du formulaire public ─────────────────────────────────────────

export type PublicFormSettings = {
  public_form_enabled: boolean
  public_form_welcome_message: string | null
  public_form_catalog_item_ids: Array<{ id: string; item_type: 'material' | 'labor' | 'prestation' }>
  public_form_custom_mode_enabled: boolean
  public_form_notification_email: string | null
}

export async function updatePublicFormSettings(
  settings: PublicFormSettings,
): Promise<{ error: string | null }> {
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  // Utiliser l'admin client pour bypasser le RLS et garantir la mise à jour
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('organizations')
    .update({
      public_form_enabled: settings.public_form_enabled,
      public_form_welcome_message: settings.public_form_welcome_message || null,
      public_form_catalog_item_ids: settings.public_form_catalog_item_ids,
      public_form_custom_mode_enabled: settings.public_form_custom_mode_enabled,
      public_form_notification_email: settings.public_form_notification_email || null,
    })
    .eq('id', orgId)
    .select('id')
    .single()

  if (error || !data) {
    console.error('[updatePublicFormSettings] échec mise à jour', { error, orgId })
    return { error: error?.message ?? 'Mise à jour échouée. Veuillez réessayer.' }
  }

  revalidatePath('/settings')
  revalidatePath('/demande', 'layout')
  return { error: null }
}
