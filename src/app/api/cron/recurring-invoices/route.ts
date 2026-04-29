import { NextRequest, NextResponse } from 'next/server'
import React from 'react'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic';
import { verifyCronSecret } from '@/lib/cron-auth'
import { sendEmail } from '@/lib/email'
import { computeNextSendDate } from '@/lib/data/recurring-utils'
import type { RecurringFrequency } from '@/lib/data/recurring-utils'
import { APP_SIGNATURE } from '@/lib/brand'
import { dateParis } from '@/lib/utils'
import { DEFAULT_EMAIL_TEMPLATES } from '@/lib/data/queries/emailTemplates'
import { renderToBuffer } from '@react-pdf/renderer'
import InvoicePDF from '@/components/pdf/InvoicePDF'

// ─── POST /api/cron/recurring-invoices ────────────────────────────────────────
// Appelé chaque matin par le Cloudflare Worker cron (x-cron-secret).
//
// Deux passes par exécution :
//   1. Créer les brouillons pour les modèles dont next_send_date est atteinte
//      → status='pending_confirmation' + notif email à l'artisan
//   2. Auto-envoyer les brouillons en pending_confirmation depuis trop longtemps
//      → si auto_send_delay_days est défini sur le modèle et le délai est écoulé

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get('x-cron-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  let created = 0
  let autoSent = 0
  let errors = 0

  // ── PASSE 1 : Créer les brouillons ────────────────────────────────────────────

  const { data: models, error: modelsError } = await admin
    .from('recurring_invoices')
    .select(`
      id, organization_id, client_id, title, frequency, send_day,
      custom_interval_days, next_send_date, requires_confirmation,
      confirmation_delay_days, auto_send_delay_days, currency,
      items:recurring_invoice_items(description, quantity, unit, unit_price, vat_rate, position)
    `)
    .eq('is_active', true)
    .is('cancelled_at', null)

  if (modelsError) {
    console.error('[cron/recurring] fetch models error:', modelsError)
    return NextResponse.json({ error: modelsError.message }, { status: 500 })
  }

  for (const model of models ?? []) {
    try {
      const nextSendDate = new Date(model.next_send_date)
      nextSendDate.setUTCHours(0, 0, 0, 0)

      const delayDays = model.requires_confirmation ? (model.confirmation_delay_days ?? 3) : 0
      const triggerDate = new Date(nextSendDate)
      triggerDate.setDate(triggerDate.getDate() - delayDays)

      if (today < triggerDate) continue

      // Vérifier qu'on n'a pas déjà créé un schedule pour cette occurrence
      const { count } = await admin
        .from('invoice_schedules')
        .select('id', { count: 'exact', head: true })
        .eq('recurring_invoice_id', model.id)
        .eq('scheduled_date', model.next_send_date)
        .in('status', ['pending_confirmation', 'confirmed', 'sent'])

      if ((count ?? 0) > 0) continue

      // Créer le brouillon facture
      const totalHt = (model.items ?? []).reduce(
        (sum: number, i: { quantity: number; unit_price: number }) => sum + i.quantity * i.unit_price,
        0,
      )
      const totalTva = (model.items ?? []).reduce(
        (sum: number, i: { quantity: number; unit_price: number; vat_rate: number }) =>
          sum + i.quantity * i.unit_price * (i.vat_rate / 100),
        0,
      )

      const { data: invoiceRow } = await admin
        .from('invoices')
        .insert({
          organization_id: model.organization_id,
          client_id: model.client_id,
          title: model.title,
          currency: model.currency ?? 'EUR',
          status: 'draft',
          issue_date: model.next_send_date,
          due_date: model.next_send_date,
          total_ht: totalHt,
          total_tva: totalTva,
          total_ttc: totalHt + totalTva,
        })
        .select('id')
        .single()

      if (!invoiceRow) { errors++; continue }

      if ((model.items ?? []).length > 0) {
        await admin.from('invoice_items').insert(
          (model.items as any[]).map((i: any) => ({
            invoice_id: invoiceRow.id,
            description: i.description,
            quantity: i.quantity,
            unit: i.unit ?? null,
            unit_price: i.unit_price,
            vat_rate: i.vat_rate,
            position: i.position,
          })),
        )
      }

      await admin.from('invoice_schedules').insert({
        organization_id: model.organization_id,
        recurring_invoice_id: model.id,
        scheduled_date: model.next_send_date,
        status: model.requires_confirmation ? 'pending_confirmation' : 'confirmed',
        invoice_id: invoiceRow.id,
        amount_ht: totalHt,
        notified_at: new Date().toISOString(),
      })

      // Calculer et enregistrer la prochaine occurrence
      const nextDate = computeNextSendDate(
        new Date(model.next_send_date),
        model.frequency as RecurringFrequency,
        model.send_day,
        model.custom_interval_days,
      )
      await admin
        .from('recurring_invoices')
        .update({ next_send_date: dateParis(nextDate.getTime()) })
        .eq('id', model.id)

      // Notifier l'artisan si confirmation requise
      if (model.requires_confirmation) {
        await notifyArtisan(admin, model.organization_id, {
          invoiceId: invoiceRow.id,
          invoiceTitle: model.title,
          scheduledDate: model.next_send_date,
          totalHt,
          currency: model.currency ?? 'EUR',
          autoSendDelayDays: model.auto_send_delay_days ?? null,
        })
      }

      created++
    } catch (err) {
      console.error(`[cron/recurring] model ${model.id}:`, err)
      errors++
    }
  }

  // ── PASSE 2 : Auto-envoi des brouillons expirés ───────────────────────────────

  // Récupérer les schedules pending depuis trop longtemps sur des modèles avec auto_send_delay_days
  const { data: pendingSchedules, error: pendingError } = await admin
    .from('invoice_schedules')
    .select(`
      id, invoice_id, organization_id, notified_at, recurring_invoice_id,
      recurring_invoice:recurring_invoices(auto_send_delay_days)
    `)
    .eq('status', 'pending_confirmation')
    .not('invoice_id', 'is', null)

  if (pendingError) {
    console.error('[cron/recurring] fetch pending schedules error:', pendingError)
  } else {
    for (const schedule of pendingSchedules ?? []) {
      try {
        const ri = schedule.recurring_invoice as any
        const autoSendDelay: number | null = ri?.auto_send_delay_days ?? null
        if (autoSendDelay === null) continue

        const notifiedAt = schedule.notified_at ? new Date(schedule.notified_at) : null
        if (!notifiedAt) continue

        const daysSinceCreation = Math.floor((today.getTime() - notifiedAt.getTime()) / 86400000)
        if (daysSinceCreation < autoSendDelay) continue

        // Délai écoulé — envoyer la facture au client avec PDF
        const sent = await autoSendInvoice(admin, schedule.organization_id, schedule.invoice_id!)
        if (sent) {
          await admin
            .from('invoice_schedules')
            .update({ status: 'sent', confirmed_at: new Date().toISOString() })
            .eq('id', schedule.id)
          autoSent++
        } else {
          errors++
        }
      } catch (err) {
        console.error(`[cron/recurring] auto-send schedule ${schedule.id}:`, err)
        errors++
      }
    }
  }

  console.log(`[cron/recurring] done: created=${created} autoSent=${autoSent} errors=${errors}`)
  return NextResponse.json({ created, autoSent, errors })
}

// ─── Envoi automatique de la facture avec PDF ─────────────────────────────────

async function autoSendInvoice(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  invoiceId: string,
): Promise<boolean> {
  try {
    // Charger la facture avec toutes les données nécessaires au PDF
    const { data: invoice } = await admin
      .from('invoices')
      .select(`
        id, number, title, status, invoice_type, total_ht, total_tva, total_ttc,
        currency, issue_date, due_date, notes_client, notes_internal,
        client:clients(id, company_name, contact_name, first_name, last_name, email,
          address_line1, address_line2, postal_code, city, country, siren),
        items:invoice_items(
          id, description, quantity, unit, unit_price, vat_rate, position, is_internal,
          material_id, width_m, height_m, length_m, area_m2, volume_m3, linear_m, resolved_unit_price
        )
      `)
      .eq('id', invoiceId)
      .eq('organization_id', orgId)
      .single()

    if (!invoice || invoice.status !== 'draft') return false

    const client = invoice.client as any
    const clientEmail: string | null = client?.email ?? null
    if (!clientEmail) return false

    // Charger l'organisation
    const { data: org } = await admin
      .from('organizations')
      .select(`
        id, name, email, email_from_address, email_from_name,
        address_line1, address_line2, postal_code, city, country,
        phone, website, siren, siret, vat_number, logo_url,
        default_vat_rate, currency, payment_terms_days,
        iban, bic, bank_name, legal_form, capital, rcs_city
      `)
      .eq('id', orgId)
      .single()

    if (!org) return false

    const fromAddress = org.email_from_address ?? org.email
    if (!fromAddress) return false

    // Template email
    const { data: customTpl } = await admin
      .from('email_templates')
      .select('subject, body_text')
      .eq('organization_id', orgId)
      .eq('slug', 'invoice_sent')
      .eq('is_active', true)
      .maybeSingle()

    const defaultTpl = DEFAULT_EMAIL_TEMPLATES.find(t => t.slug === 'invoice_sent')
    const tpl = customTpl ?? defaultTpl!

    const clientName = client?.company_name
      || [client?.first_name, client?.last_name].filter(Boolean).join(' ')
      || 'Client'

    const fmtAmount = new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: invoice.currency ?? 'EUR',
    }).format(invoice.total_ttc ?? 0)

    function interpolate(template: string, vars: Record<string, string>): string {
      return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, v), template)
    }
    function wrapHtml(orgName: string, bodyText: string): string {
      const bodyHtml = bodyText.replace(/\n/g, '<br>')
      return `<div style="max-width:560px;margin:0 auto;font-family:sans-serif"><div style="background:#0a0a0a;padding:24px 32px;border-radius:12px 12px 0 0"><p style="color:white;font-weight:bold;margin:0;font-size:16px">${orgName}</p></div><div style="background:white;padding:32px;border-radius:0 0 12px 12px;border:1px solid #eee;border-top:none;line-height:1.7;color:#333;font-size:14px">${bodyHtml}</div></div>`
    }

    const vars: Record<string, string> = {
      numero_facture: invoice.number ?? '',
      client_nom: clientName,
      montant_ttc: fmtAmount,
      entreprise_nom: org.name,
    }

    const subject = interpolate(tpl.subject, vars)
    const html = wrapHtml(org.name, interpolate(tpl.body_text, vars))

    // Générer le PDF
    let attachments: Array<{ filename: string; content: Buffer }> | undefined
    try {
      const pdfBuffer = await renderToBuffer(
        React.createElement(InvoicePDF, { invoice: invoice as any, organization: org as any }) as any,
      )
      attachments = [{ filename: `facture-${invoice.number ?? invoiceId}.pdf`, content: Buffer.from(pdfBuffer) }]
    } catch (pdfErr) {
      console.error('[cron/recurring] PDF generation error:', pdfErr)
    }

    await sendEmail({
      organizationId: orgId,
      to: clientEmail,
      subject,
      html,
      attachments,
    })

    // Marquer comme envoyée
    await admin
      .from('invoices')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', invoiceId)

    return true
  } catch (err) {
    console.error('[cron/recurring] autoSendInvoice error:', err)
    return false
  }
}

// ─── Notification email à l'artisan ──────────────────────────────────────────

async function notifyArtisan(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  data: {
    invoiceId: string
    invoiceTitle: string
    scheduledDate: string
    totalHt: number
    currency: string
    autoSendDelayDays: number | null
  },
) {
  try {
    const { data: org } = await admin
      .from('organizations')
      .select('name, email, email_from_address')
      .eq('id', orgId)
      .single()

    if (!org?.email) return

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.example.com'
    const fmtDate = new Date(data.scheduledDate).toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'long', year: 'numeric',
    })
    const fmtAmount = new Intl.NumberFormat('fr-FR', {
      style: 'currency', currency: data.currency,
    }).format(data.totalHt)

    const autoSendNote = data.autoSendDelayDays !== null
      ? `\n\n⚠️ Si vous ne validez pas dans ${data.autoSendDelayDays} jour${data.autoSendDelayDays > 1 ? 's' : ''}, la facture sera envoyée automatiquement au client.`
      : ''

    const subject = `Facture récurrente à valider : ${data.invoiceTitle}`
    const bodyText = `Bonjour,\n\nUne facture récurrente a été préparée automatiquement et attend votre validation avant envoi.\n\nFacture : ${data.invoiceTitle}\nDate d'envoi prévue : ${fmtDate}\nMontant HT : ${fmtAmount}${autoSendNote}\n\nVous pouvez la vérifier ici :\n${appUrl}/finances/invoice-editor?id=${data.invoiceId}\n\nAu plaisir de vous simplifier le suivi,\n${APP_SIGNATURE}`
    const bodyHtml = bodyText.replace(/\n/g, '<br>')
    const html = `<div style="max-width:560px;margin:0 auto;font-family:sans-serif"><div style="background:#0a0a0a;padding:24px 32px;border-radius:12px 12px 0 0"><p style="color:white;font-weight:bold;margin:0;font-size:16px">${org.name}</p></div><div style="background:white;padding:32px;border-radius:0 0 12px 12px;border:1px solid #eee;border-top:none;line-height:1.7;color:#333;font-size:14px">${bodyHtml}</div></div>`

    await sendEmail({
      organizationId: orgId,
      to: org.email,
      subject,
      html,
    })
  } catch (err) {
    console.error('[cron/recurring] notifyArtisan error:', err)
  }
}
