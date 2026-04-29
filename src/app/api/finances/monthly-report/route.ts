import React from 'react'
import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import JSZip from 'jszip'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { renderInvoicePdfBufferById } from '@/lib/pdf/server'
import MonthlyReportPDF, { type MonthlyReportData, type ReportInvoice, type ReportQuote } from '@/components/pdf/MonthlyReportPDF'

async function fetchLogoAsDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const ct = res.headers.get('content-type') ?? 'image/png'
    return `data:${ct};base64,${Buffer.from(buf).toString('base64')}`
  } catch {
    return null
  }
}

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Non authentifié', { status: 401 })

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return new NextResponse('Organisation introuvable', { status: 403 })

  const month = new URL(req.url).searchParams.get('month') // YYYY-MM
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return new NextResponse('Paramètre month invalide (format YYYY-MM attendu)', { status: 400 })
  }

  const monthStart = `${month}-01`
  const [y, m] = month.split('-').map(Number)
  const nextMonth = new Date(y, m, 1) // 1er du mois suivant
  const monthEnd = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`

  const admin = createAdminClient()

  // ── Charger organisation ──────────────────────────────────────────────────
  const { data: orgData } = await admin
    .from('organizations')
    .select('id, name, slug, siret, siren, vat_number, email, phone, address_line1, address_line2, city, postal_code, country, logo_url, email_from_name, email_from_address, forme_juridique, capital_social, rcs, rcs_ville, insurance_info, certifications, primary_color, payment_terms_days, late_penalty_rate, court_competent, iban, bic, bank_name, recovery_indemnity_text, auto_reminder_enabled, invoice_reminder_days, quote_reminder_days, reminder_hour_utc, sector, business_profile, business_activity_id, label_set, unit_set, default_categories, starter_presets, is_vat_subject, default_vat_rate, public_form_enabled, public_form_welcome_message, public_form_catalog_item_ids, public_form_custom_mode_enabled, public_form_notification_email, decennale_enabled, decennale_assureur, decennale_police, decennale_couverture, decennale_date_debut, decennale_date_fin')
    .eq('id', orgId)
    .single()

  if (!orgData) return new NextResponse('Organisation introuvable', { status: 500 })

  // ── Charger factures du mois ──────────────────────────────────────────────
  const { data: rawInvoices } = await admin
    .from('invoices')
    .select(`
      id, number, title, status, invoice_type, total_ht, total_tva, total_ttc, currency,
      issue_date, due_date, created_at,
      client:clients(company_name, contact_name, first_name, last_name, email),
      items:invoice_items(unit_price, quantity, is_internal)
    `)
    .eq('organization_id', orgId)
    .neq('status', 'cancelled')
    .gte('created_at', monthStart)
    .lt('created_at', monthEnd)
    .order('created_at', { ascending: true })

  // ── Charger devis du mois ─────────────────────────────────────────────────
  const { data: rawQuotes } = await admin
    .from('quotes')
    .select(`
      id, number, title, status, total_ht, currency, created_at,
      client:clients(company_name, contact_name, first_name, last_name, email)
    `)
    .eq('organization_id', orgId)
    .gte('created_at', monthStart)
    .lt('created_at', monthEnd)
    .order('created_at', { ascending: true })

  // ── Normaliser les données ─────────────────────────────────────────────────
  function clientName(client: Record<string, string | null> | null): string | null {
    if (!client) return null
    return client.company_name ?? ([client.first_name, client.last_name].filter(Boolean).join(' ') || client.contact_name || client.email || null)
  }

  const invoices: ReportInvoice[] = (rawInvoices ?? []).map((inv: any) => {
    const c = Array.isArray(inv.client) ? inv.client[0] : inv.client
    const items = (Array.isArray(inv.items) ? inv.items : []) as Array<{ unit_price: number; quantity: number; is_internal: boolean }>
    const internalTotal = items.filter(i => i.is_internal).reduce((s, i) => s + i.unit_price * i.quantity, 0)
    return {
      id: inv.id,
      number: inv.number,
      title: inv.title,
      status: inv.status,
      invoice_type: inv.invoice_type,
      total_ht: inv.total_ht ?? 0,
      total_tva: inv.total_tva ?? 0,
      total_ttc: inv.total_ttc ?? 0,
      currency: inv.currency ?? 'EUR',
      issue_date: inv.issue_date,
      due_date: inv.due_date,
      created_at: inv.created_at,
      client_name: clientName(c),
      items_internal_total: internalTotal,
    }
  })

  const quotes: ReportQuote[] = (rawQuotes ?? []).map((q: any) => {
    const c = Array.isArray(q.client) ? q.client[0] : q.client
    return {
      id: q.id,
      number: q.number,
      title: q.title,
      status: q.status,
      total_ht: q.total_ht ?? 0,
      currency: q.currency ?? 'EUR',
      created_at: q.created_at,
      client_name: clientName(c),
    }
  })

  const logoDataUrl = await fetchLogoAsDataUrl(orgData.logo_url)
  const organization = { ...orgData, logo_url: logoDataUrl ?? orgData.logo_url } as MonthlyReportData['organization']

  // ── Générer le PDF de synthèse ────────────────────────────────────────────
  const reportData: MonthlyReportData = { month, organization, invoices, quotes }
  const reportBuffer = await renderToBuffer(
    React.createElement(MonthlyReportPDF, { data: reportData }) as any,
  )

  // ── Construire le ZIP ─────────────────────────────────────────────────────
  const zip = new JSZip()
  zip.file(`rapport-${month}.pdf`, reportBuffer)

  const facturesFolder = zip.folder('factures')!
  await Promise.all(
    invoices.map(async inv => {
      const result = await renderInvoicePdfBufferById(inv.id, orgId)
      if (result) {
        facturesFolder.file(result.fileName, result.buffer)
      }
    }),
  )

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

  const MONTHS_FR = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre']
  const [yr, mo] = month.split('-').map(Number)
  const zipName = `atelier-${MONTHS_FR[mo - 1]}-${yr}.zip`

  return new NextResponse(zipBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipName}"`,
    },
  })
}
