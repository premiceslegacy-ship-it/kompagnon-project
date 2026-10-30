'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasPermission } from '@/lib/data/queries/membership'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'

// ─── Import job tracker ───────────────────────────────────────────────────────

async function trackImportJob(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  orgId: string
  userId: string
  type: 'invoices' | 'quotes' | 'clients'
  totalRows: number
  importedRows: number
  skippedRows: number
  skippedReasons: string[]
}) {
  const { supabase, orgId, userId, type, totalRows, importedRows, skippedRows, skippedReasons } = params
  await supabase.from('import_jobs').insert({
    organization_id: orgId,
    type,
    status: importedRows > 0 ? 'completed' : 'failed',
    total_rows: totalRows,
    imported_rows: importedRows,
    skipped_rows: skippedRows,
    error_rows: skippedRows,
    error_details: skippedReasons.length > 0 ? skippedReasons : null,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    created_by: userId,
  })
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ImportDocumentRow = {
  // Identification du document
  numero?: string           // numero_facture ou numero_devis
  date_emission: string     // DD/MM/YYYY ou YYYY-MM-DD
  date_echeance?: string    // pour factures
  date_validite?: string    // pour devis
  titre_projet?: string

  // Client
  client_nom: string
  client_type?: string      // 'professionnel' | 'particulier'
  client_email?: string
  client_telephone?: string
  client_siret?: string
  client_adresse?: string

  // Ligne
  designation: string
  quantite?: string
  unite?: string
  prix_unitaire_ht: string
  tva?: string

  // Meta
  statut?: string
  recurrente?: string       // 'oui' | 'non'
  frequence?: string        // 'mensuelle' | 'trimestrielle' | 'hebdomadaire' | 'annuelle'
  notes?: string
}

export type ImportDocumentsResult = {
  error: string | null
  imported: number
  skipped: number
  clients_created: number
  memory_entries: number
  skipped_reasons: string[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDate(raw: string): string | null {
  if (!raw?.trim()) return null
  const s = raw.trim()
  let normalized: string | null = null
  const ddmm = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const ddmm2 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (ddmm) normalized = `${ddmm[3]}-${ddmm[2].padStart(2, '0')}-${ddmm[1].padStart(2, '0')}`
  else if (iso) normalized = s
  else if (ddmm2) normalized = `${ddmm2[3]}-${ddmm2[2].padStart(2, '0')}-${ddmm2[1].padStart(2, '0')}`
  if (!normalized) return null

  const [year, month, day] = normalized.split('-').map(Number)
  const checked = new Date(0)
  checked.setUTCFullYear(year, month - 1, day)
  checked.setUTCHours(0, 0, 0, 0)
  return checked.getUTCFullYear() === year
    && checked.getUTCMonth() === month - 1
    && checked.getUTCDate() === day
    ? normalized
    : null
}

type HistoricalImportItem = {
  description: string
  quantity: number
  unit: string
  unit_price: number
  vat_rate: number
}

function parseCsvNumber(raw: string | undefined, fallback?: number): number | null {
  const value = raw?.trim()
  if (!value) return fallback ?? null

  let normalized = value.replace(/\s/g, '').replace(/[€%]$/, '')
  const comma = normalized.lastIndexOf(',')
  const dot = normalized.lastIndexOf('.')
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot
      ? normalized.replace(/\./g, '').replace(',', '.')
      : normalized.replace(/,/g, '')
  } else if (comma >= 0) {
    normalized = normalized.replace(',', '.')
  }
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function prepareHistoricalItems(rows: ImportDocumentRow[]): HistoricalImportItem[] | null {
  const items: HistoricalImportItem[] = []
  for (const row of rows) {
    const quantity = parseCsvNumber(row.quantite, 1)
    const unitPrice = parseCsvNumber(row.prix_unitaire_ht)
    const vatRate = parseCsvNumber(row.tva, 20)
    if (quantity === null || unitPrice === null || vatRate === null) return null
    items.push({
      description: row.designation?.trim() || '-',
      quantity,
      unit: row.unite?.trim() || 'u',
      unit_price: unitPrice,
      vat_rate: vatRate,
    })
  }
  return items.length > 0 ? items : null
}

function importDenied(): ImportDocumentsResult {
  return { error: 'Action non autorisée.', imported: 0, skipped: 0, clients_created: 0, memory_entries: 0, skipped_reasons: [] }
}

function mapInvoiceStatus(raw?: string): string {
  const s = (raw ?? '').toLowerCase().trim()
  if (s === 'payee' || s === 'payée' || s === 'paid') return 'paid'
  if (s === 'envoyee' || s === 'envoyée' || s === 'sent') return 'sent'
  return 'draft'
}

function mapQuoteStatus(raw?: string): string {
  const s = (raw ?? '').toLowerCase().trim()
  if (s === 'accepte' || s === 'accepté' || s === 'accepted') return 'accepted'
  if (s === 'refuse' || s === 'refusé' || s === 'refused') return 'refused'
  if (s === 'envoye' || s === 'envoyé' || s === 'sent') return 'sent'
  return 'draft'
}

function mapFrequency(raw?: string): string {
  const s = (raw ?? '').toLowerCase().trim()
  if (s === 'trimestrielle' || s === 'quarterly') return 'quarterly'
  if (s === 'hebdomadaire' || s === 'weekly') return 'weekly'
  if (s === 'annuelle' || s === 'yearly') return 'custom'
  return 'monthly'
}

// ─── Import Factures ──────────────────────────────────────────────────────────

export async function importInvoices(
  rows: ImportDocumentRow[],
): Promise<ImportDocumentsResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.', imported: 0, skipped: 0, clients_created: 0, memory_entries: 0, skipped_reasons: [] }
  if (!(await hasPermission('import.history')) || !(await hasPermission('invoices.create'))) return importDenied()

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.', imported: 0, skipped: 0, clients_created: 0, memory_entries: 0, skipped_reasons: [] }
  const admin = createAdminClient()

  const { data: org } = await supabase
    .from('organizations')
    .select('business_activity_id')
    .eq('id', orgId)
    .single()
  const activityId: string | null = org?.business_activity_id ?? null

  // Grouper les lignes par numéro de facture (ou par client+date si pas de numéro)
  const groups = new Map<string, ImportDocumentRow[]>()
  for (const row of rows) {
    const key = row.numero?.trim()
      || `${row.client_nom?.trim()}_${row.date_emission?.trim()}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }

  // Cache clients de l'org
  const { data: existingClients } = await supabase
    .from('clients')
    .select('id, email, company_name, first_name, last_name')
    .eq('organization_id', orgId)

  const clientCache = new Map<string, string>() // email/nom → id
  for (const c of existingClients ?? []) {
    if (c.email) clientCache.set(c.email.toLowerCase(), c.id)
    const name = c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ')
    if (name) clientCache.set(name.toLowerCase(), c.id)
  }

  let imported = 0, skipped = 0, clientsCreated = 0, memoryEntries = 0
  const skippedReasons: string[] = []

  for (const [key, lineRows] of groups) {
    const first = lineRows[0]
    if (!first.client_nom?.trim() || !first.date_emission?.trim()) {
      skippedReasons.push(`Document "${key}" ignoré : client ou date d'émission manquant`)
      skipped++; continue
    }

    const issueDate = parseDate(first.date_emission)
    if (!issueDate) {
      skippedReasons.push(`Document "${first.numero ?? first.client_nom}" ignoré : date invalide (${first.date_emission})`)
      skipped++; continue
    }

    const itemRows = prepareHistoricalItems(lineRows)
    if (!itemRows) {
      skippedReasons.push(`Facture "${first.numero ?? first.client_nom}" ignorée : une ligne contient un montant, une quantité ou une TVA invalide`)
      skipped++; continue
    }

    // Trouver ou créer le client
    const emailKey = first.client_email?.toLowerCase()?.trim()
    const nameKey = first.client_nom.trim().toLowerCase()
    let clientId = (emailKey && clientCache.get(emailKey)) || clientCache.get(nameKey)

    if (!clientId) {
      const isCompany = (first.client_type ?? 'professionnel').toLowerCase() !== 'particulier'
      const nameParts = first.client_nom.trim().split(/\s+/)
      const { data: newClient } = await supabase
        .from('clients')
        .insert({
          organization_id: orgId,
          type: isCompany ? 'company' : 'individual',
          company_name: isCompany ? first.client_nom.trim() : null,
          first_name: !isCompany && nameParts.length > 1 ? nameParts[0] : null,
          last_name: !isCompany ? (nameParts.length > 1 ? nameParts.slice(1).join(' ') : first.client_nom.trim()) : null,
          email: first.client_email?.trim() || null,
          phone: first.client_telephone?.trim() || null,
          siret: first.client_siret?.trim() || null,
          address_line1: first.client_adresse?.trim() || null,
          status: 'active',
          created_by: user.id,
        })
        .select('id')
        .single()
      if (newClient) {
        clientId = newClient.id
        if (emailKey) clientCache.set(emailKey, newClient.id)
        clientCache.set(nameKey, newClient.id)
        clientsCreated++
      }
    }
    if (!clientId) {
      skippedReasons.push(`Facture "${first.numero ?? first.client_nom}" ignorée : client introuvable et création impossible`)
      skipped++; continue
    }


    // Générer un numéro de facture
    let invoiceNumber = first.numero?.trim() || null
    if (!invoiceNumber) {
      const { data: gen } = await supabase.rpc('generate_invoice_number', { org_id: orgId })
      invoiceNumber = typeof gen === 'string' ? gen : null
    }
    if (!invoiceNumber) {
      skippedReasons.push(`Facture "${first.client_nom}" ignorée : numéro indisponible`)
      skipped++; continue
    }

    const title = first.titre_projet?.trim() || first.designation?.trim() || invoiceNumber
    const dueDate = parseDate(first.date_echeance ?? '')
    const recurrenceDate = dueDate ?? issueDate
    const status = mapInvoiceStatus(first.statut)
    const isRecurring = (first.recurrente ?? 'non').toLowerCase() === 'oui'

    // The privileged RPC stages the header and every line before finalizing,
    // keeping imported status without fabricating payment or issuance authority.
    const { data: invoiceId, error: invErr } = await admin.rpc('import_historical_document', {
      p_kind: 'invoice',
      p_organization_id: orgId,
      p_created_by: user.id,
      p_document: {
        client_id: clientId,
        number: invoiceNumber,
        title,
        status,
        issue_date: issueDate,
        due_date: dueDate,
        notes_client: first.notes?.trim() || null,
        currency: 'EUR',
      },
      p_items: itemRows,
    })

    if (invErr || !invoiceId) {
      skippedReasons.push(`Facture "${invoiceNumber}" ignorée : erreur lors de l'enregistrement du document historique`)
      skipped++; continue
    }

    const totalHt = itemRows.reduce((s, i) => s + Math.round(i.quantity * i.unit_price * 100) / 100, 0)
    const totalTva = itemRows.reduce((s, i) => s + Math.round(i.quantity * i.unit_price * i.vat_rate) / 100, 0)

    // Récurrence
    if (isRecurring) {
      const freq = mapFrequency(first.frequence)
      const { data: ri } = await supabase
        .from('recurring_invoices')
        .insert({
          organization_id: orgId,
          client_id: clientId,
          title: first.titre_projet?.trim() || first.designation?.trim() || 'Facture récurrente',
          frequency: freq,
          next_send_date: recurrenceDate,
          base_amount_ht: totalHt,
          currency: 'EUR',
          requires_confirmation: true,
          created_by: user.id,
        })
        .select('id')
        .single()

      if (ri) {
        await supabase.from('recurring_invoice_items').insert(
          itemRows.map((row, idx) => ({
            recurring_invoice_id: ri.id,
            description: row.description,
            quantity: row.quantity,
            unit: row.unit,
            unit_price: row.unit_price,
            vat_rate: row.vat_rate,
            position: idx + 1,
          }))
        )
      }
    }

    // Mémoire d'entreprise
    const clientLabel = first.client_nom.trim()
    const itemsSummary = itemRows.map(i => `${i.description} (${i.quantity} ${i.unit} × ${i.unit_price}€ HT)`).join(', ')
    const statusLabel = status === 'paid' ? 'payée' : status === 'sent' ? 'envoyée' : 'brouillon'
    const memContent = `Facture ${invoiceNumber} émise le ${issueDate} pour ${clientLabel} - ${itemsSummary} - Total HT : ${totalHt.toFixed(2)}€ - Statut : ${statusLabel}${isRecurring ? ' - récurrente' : ''}`

    await supabase.from('company_memory').insert({
      organization_id: orgId,
      type: 'invoice',
      content: memContent,
      metadata: { invoice_id: invoiceId, client_id: clientId, total_ht: totalHt, status, date: issueDate, ...(activityId ? { activity_id: activityId } : {}) },
      source: 'import',
      confidence: 1.0,
    })
    memoryEntries++

    imported++
  }


  await trackImportJob({ supabase, orgId, userId: user.id, type: 'invoices', totalRows: groups.size, importedRows: imported, skippedRows: skipped, skippedReasons })
  revalidatePath('/finances')
  return { error: null, imported, skipped, clients_created: clientsCreated, memory_entries: memoryEntries, skipped_reasons: skippedReasons }
}

// ─── Import Devis ─────────────────────────────────────────────────────────────

export async function importQuotes(
  rows: ImportDocumentRow[],
): Promise<ImportDocumentsResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.', imported: 0, skipped: 0, clients_created: 0, memory_entries: 0, skipped_reasons: [] }
  if (!(await hasPermission('import.history')) || !(await hasPermission('quotes.create'))) return importDenied()

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.', imported: 0, skipped: 0, clients_created: 0, memory_entries: 0, skipped_reasons: [] }
  const admin = createAdminClient()

  const { data: org } = await supabase
    .from('organizations')
    .select('business_activity_id')
    .eq('id', orgId)
    .single()
  const activityId: string | null = org?.business_activity_id ?? null

  const groups = new Map<string, ImportDocumentRow[]>()
  for (const row of rows) {
    const key = row.numero?.trim()
      || `${row.client_nom?.trim()}_${row.date_emission?.trim()}_${row.titre_projet?.trim() || ''}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }

  const { data: existingClients } = await supabase
    .from('clients')
    .select('id, email, company_name, first_name, last_name')
    .eq('organization_id', orgId)

  const clientCache = new Map<string, string>()
  for (const c of existingClients ?? []) {
    if (c.email) clientCache.set(c.email.toLowerCase(), c.id)
    const name = c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ')
    if (name) clientCache.set(name.toLowerCase(), c.id)
  }

  let imported = 0, skipped = 0, clientsCreated = 0, memoryEntries = 0
  const skippedReasons: string[] = []

  for (const [key, lineRows] of groups) {
    const first = lineRows[0]
    if (!first.client_nom?.trim() || !first.date_emission?.trim()) {
      skippedReasons.push(`Devis "${key}" ignoré : client ou date d'émission manquant`)
      skipped++; continue
    }

    const issueDate = parseDate(first.date_emission)
    if (!issueDate) {
      skippedReasons.push(`Devis "${first.numero ?? first.client_nom}" ignoré : date invalide (${first.date_emission})`)
      skipped++; continue
    }

    const itemRows = prepareHistoricalItems(lineRows)
    if (!itemRows) {
      skippedReasons.push(`Devis "${first.numero ?? first.client_nom}" ignoré : une ligne contient un montant, une quantité ou une TVA invalide`)
      skipped++; continue
    }

    const emailKey = first.client_email?.toLowerCase()?.trim()
    const nameKey = first.client_nom.trim().toLowerCase()
    let clientId = (emailKey && clientCache.get(emailKey)) || clientCache.get(nameKey)

    if (!clientId) {
      const isCompany = (first.client_type ?? 'professionnel').toLowerCase() !== 'particulier'
      const nameParts = first.client_nom.trim().split(/\s+/)
      const { data: newClient } = await supabase
        .from('clients')
        .insert({
          organization_id: orgId,
          type: isCompany ? 'company' : 'individual',
          company_name: isCompany ? first.client_nom.trim() : null,
          first_name: !isCompany && nameParts.length > 1 ? nameParts[0] : null,
          last_name: !isCompany ? (nameParts.length > 1 ? nameParts.slice(1).join(' ') : first.client_nom.trim()) : null,
          email: first.client_email?.trim() || null,
          phone: first.client_telephone?.trim() || null,
          siret: first.client_siret?.trim() || null,
          address_line1: first.client_adresse?.trim() || null,
          status: 'active',
          created_by: user.id,
        })
        .select('id')
        .single()
      if (newClient) {
        clientId = newClient.id
        if (emailKey) clientCache.set(emailKey, newClient.id)
        clientCache.set(nameKey, newClient.id)
        clientsCreated++
      }
    }
    if (!clientId) {
      skippedReasons.push(`Devis "${first.numero ?? first.client_nom}" ignoré : client introuvable et création impossible`)
      skipped++; continue
    }

    let quoteNumber = first.numero?.trim() || null
    if (!quoteNumber) {
      const { data: gen } = await supabase.rpc('generate_quote_number', { org_id: orgId })
      quoteNumber = typeof gen === 'string' ? gen : null
    }
    if (!quoteNumber) {
      skippedReasons.push(`Devis "${first.client_nom}" ignoré : numéro indisponible`)
      skipped++; continue
    }

    const status = mapQuoteStatus(first.statut)
    const validityDate = parseDate(first.date_validite ?? '')
    const validityDays = validityDate
      ? Math.round((new Date(validityDate).getTime() - new Date(issueDate).getTime()) / 86400000)
      : 30
    const title = first.titre_projet?.trim() || first.designation?.trim() || quoteNumber

    const { data: quoteId, error: quoteError } = await admin.rpc('import_historical_document', {
      p_kind: 'quote',
      p_organization_id: orgId,
      p_created_by: user.id,
      p_document: {
        client_id: clientId,
        number: quoteNumber,
        title,
        status,
        issue_date: issueDate,
        valid_until: validityDate,
        validity_days: validityDays,
        notes_client: first.notes?.trim() || null,
        currency: 'EUR',
      },
      p_items: itemRows,
    })

    if (quoteError || !quoteId) {
      skippedReasons.push(`Devis "${quoteNumber}" ignoré : erreur lors de l'enregistrement du document historique`)
      skipped++; continue
    }

    const totalHt = itemRows.reduce((s, item) => s + Math.round(item.quantity * item.unit_price * 100) / 100, 0)
    const statusLabel = status === 'accepted' ? 'accepté' : status === 'refused' ? 'refusé' : status === 'sent' ? 'envoyé' : 'brouillon'
    const itemsSummary = itemRows.map(item => `${item.description} (${item.quantity} × ${item.unit_price}€ HT)`).join(', ')
    const clientLabel = first.client_nom.trim()
    const memContent = `Devis ${quoteNumber} émis le ${issueDate} pour ${clientLabel}${first.titre_projet ? ` - Projet : ${first.titre_projet.trim()}` : ''} - ${itemsSummary} - Total HT : ${totalHt.toFixed(2)}€ - Statut : ${statusLabel}`

    await supabase.from('company_memory').insert({
      organization_id: orgId,
      type: 'quote',
      content: memContent,
      metadata: { quote_id: quoteId, client_id: clientId, total_ht: totalHt, status, date: issueDate, ...(activityId ? { activity_id: activityId } : {}) },
      source: 'import',
      confidence: 1.0,
    })
    memoryEntries++

    imported++
  }


  await trackImportJob({ supabase, orgId, userId: user.id, type: 'quotes', totalRows: groups.size, importedRows: imported, skippedRows: skipped, skippedReasons })
  revalidatePath('/finances')
  return { error: null, imported, skipped, clients_created: clientsCreated, memory_entries: memoryEntries, skipped_reasons: skippedReasons }
}
