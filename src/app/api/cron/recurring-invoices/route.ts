import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic';
import { verifyCronSecret } from '@/lib/cron-auth'
import { sendEmail } from '@/lib/email'
import { computeNextSendDate, computeRecurringInvoiceDueDate, normalizePaymentTermsDays } from '@/lib/data/recurring-utils'
import type { RecurringFrequency } from '@/lib/data/recurring-utils'
import { APP_SIGNATURE } from '@/lib/brand'
import { dateParis } from '@/lib/utils'
import { DEFAULT_EMAIL_TEMPLATES } from '@/lib/data/queries/emailTemplates'
import { renderInvoicePdfBufferById } from '@/lib/pdf/server'
import { renderOrganizationEmail } from '@/lib/email/organization'
import { escHtml } from '@/lib/email/layout'

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
      client:clients(payment_terms_days),
      organization:organizations(payment_terms_days, is_vat_subject),
      items:recurring_invoice_items(description, quantity, unit, unit_price, vat_rate, position, is_internal)
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
      const client = Array.isArray(model.client) ? model.client[0] : model.client
      const organization = Array.isArray(model.organization) ? model.organization[0] : model.organization
      const clientItems = (model.items ?? []).filter((i: { is_internal?: boolean | null }) => !i.is_internal)
      const totalHt = clientItems.reduce(
        (sum: number, i: { quantity: number; unit_price: number }) => sum + i.quantity * i.unit_price,
        0,
      )
      const totalTva = organization?.is_vat_subject === false
        ? 0
        : clientItems.reduce(
            (sum: number, i: { quantity: number; unit_price: number; vat_rate: number }) =>
              sum + i.quantity * i.unit_price * (i.vat_rate / 100),
            0,
          )
      const paymentTermsDays = normalizePaymentTermsDays(
        client?.payment_terms_days,
        organization?.payment_terms_days,
      )
      const dueDate = computeRecurringInvoiceDueDate(model.next_send_date, paymentTermsDays, null)

      const { data: invoiceRow } = await admin
        .from('invoices')
        .insert({
          organization_id: model.organization_id,
          client_id: model.client_id,
          title: model.title,
          currency: model.currency ?? 'EUR',
          status: 'draft',
          issue_date: model.next_send_date,
          due_date: dueDate,
          payment_terms_days: paymentTermsDays,
          total_ht: totalHt,
          total_tva: totalTva,
          total_ttc: totalHt + totalTva,
        })
        .select('id')
        .single()

      if (!invoiceRow) { errors++; continue }

      if ((model.items ?? []).length > 0) {
        const { error: itemsError } = await admin.from('invoice_items').insert(
          (model.items as any[]).map((i: any) => ({
            invoice_id: invoiceRow.id,
            description: i.description,
            quantity: i.quantity,
            unit: i.unit ?? null,
            unit_price: i.unit_price,
            vat_rate: i.vat_rate,
            position: i.position,
            is_internal: i.is_internal ?? false,
          })),
        )
        if (itemsError) {
          console.error('[cron/recurring] items insert:', itemsError.message)
          await admin.from('invoices').delete().eq('id', invoiceRow.id)
          errors++
          continue
        }
      }

      const { error: scheduleError } = await admin.from('invoice_schedules').insert({
        organization_id: model.organization_id,
        recurring_invoice_id: model.id,
        scheduled_date: model.next_send_date,
        status: model.requires_confirmation ? 'pending_confirmation' : 'confirmed',
        invoice_id: invoiceRow.id,
        amount_ht: totalHt,
        // Renseigné après la notification : un `notified_at` posé d'avance
        // déclenchait l'auto-envoi sans que l'artisan ait jamais été prévenu.
        notified_at: null,
      })
      if (scheduleError) {
        console.error('[cron/recurring] schedule insert:', scheduleError.message)
        await admin.from('invoices').delete().eq('id', invoiceRow.id)
        errors++
        continue
      }

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

      // Lier la facture à l'intervention planifiée du contrat d'entretien associé
      const { data: linkedContract } = await admin
        .from('maintenance_contracts')
        .select('id, chantier_id')
        .eq('recurring_invoice_id', model.id)
        .single()
      if (linkedContract) {
        if (linkedContract.chantier_id) {
          await admin
            .from('invoices')
            .update({ chantier_id: linkedContract.chantier_id, generation_source: 'maintenance_recurring' })
            .eq('id', invoiceRow.id)
        }
        const { data: nextIntervention } = await admin
          .from('maintenance_interventions')
          .select('id')
          .eq('maintenance_contract_id', linkedContract.id)
          .eq('statut', 'planifiée')
          .is('invoice_id', null)
          .order('date_intervention', { ascending: true })
          .limit(1)
          .single()
        if (nextIntervention) {
          await admin
            .from('maintenance_interventions')
            .update({ invoice_id: invoiceRow.id })
            .eq('id', nextIntervention.id)
        }
      }

      // Notifier l'artisan si confirmation requise
      if (model.requires_confirmation) {
        const notified = await notifyArtisan(admin, model.organization_id, {
          invoiceId: invoiceRow.id,
          invoiceTitle: model.title,
          scheduledDate: model.next_send_date,
          totalHt,
          currency: model.currency ?? 'EUR',
          autoSendDelayDays: model.auto_send_delay_days ?? null,
        })
        if (notified) {
          await admin
            .from('invoice_schedules')
            .update({ notified_at: new Date().toISOString() })
            .eq('recurring_invoice_id', model.id)
            .eq('scheduled_date', model.next_send_date)
            .is('notified_at', null)
        }
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

        // Comparaison en durée réelle : `today` est ramené à minuit, donc
        // `minuit - notified_at` valait 0 le lendemain pour un délai de 1 jour
        // et l'envoi n'arrivait qu'au deuxième passage.
        const dueAt = notifiedAt.getTime() + autoSendDelay * 86_400_000
        if (Date.now() < dueAt) continue

        // Délai écoulé - envoyer la facture au client avec PDF
        const sent = await autoSendInvoice(admin, schedule.organization_id, schedule.invoice_id!)
        if (sent) {
          const { data: closedSchedule, error: closeError } = await admin
            .from('invoice_schedules')
            .update({ status: 'sent', confirmed_at: new Date().toISOString() })
            .eq('id', schedule.id)
            .eq('status', 'pending_confirmation')
            .select('id')
            .maybeSingle()
          if (closeError) {
            console.error('[cron/recurring] close schedule:', closeError.message)
            errors++
          } else if (closedSchedule) {
            autoSent++
          }
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
  // Revendication AVANT toute lecture : le PDF doit être rendu sur l'état
  // figé. Revendiquer après le rendu laissait une sauvegarde concurrente
  // modifier la facture entre le rendu et l'envoi.
  const { data: claimed } = await admin
    .from('invoices')
    .update({ status: 'sending' })
    .eq('id', invoiceId)
    .eq('organization_id', orgId)
    .eq('status', 'draft')
    .select('id')
    .maybeSingle()
  if (!claimed) {
    // A previous attempt may have sent the provider email but failed while
    // closing its schedule. Close that schedule on retry without resending.
    const { data: existingInvoice } = await admin
      .from('invoices')
      .select('status')
      .eq('id', invoiceId)
      .eq('organization_id', orgId)
      .maybeSingle()
    return existingInvoice?.status === 'sent'
  }

  let deliveryAttempted = false
  try {
    // The first-send claim transactionally created the issuance snapshot. Render
    // it through the shared PDF/A-3 + Factur-X path; never dispatch an invoice
    // email without its fiscal attachment.
    const rendered = await renderInvoicePdfBufferById(invoiceId, orgId)
    if (!rendered) throw new Error('Facture introuvable après revendication')
    const invoice = rendered.authority.invoice
    const client = invoice.client
    const clientEmail: string | null = client?.email ?? null
    if (!clientEmail) throw new Error('Adresse email client absente de l’autorité d’émission')

    const org = rendered.authority.organization
    const fromAddress = org.email_from_address ?? org.email
    if (!fromAddress) throw new Error('Adresse email expéditeur absente de l’autorité d’émission')

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
    function wrapHtml(orgName: string, bodyText: string, logoUrl?: string | null): string {
      const bodyHtml = escHtml(bodyText).replace(/\n/g, '<br>')
      return renderOrganizationEmail({ subject: orgName, orgName, logoUrl, bodyHtml: `<div style=\"line-height:1.7;color:#3b3935;font-size:14px\">${bodyHtml}</div>` })
    }

    const vars: Record<string, string> = {
      numero_facture: invoice.number ?? '',
      client_nom: clientName,
      montant_ttc: fmtAmount,
      entreprise_nom: org.name,
    }

    const subject = interpolate(tpl.subject, vars)
    const html = wrapHtml(org.name, interpolate(tpl.body_text, vars), org.logo_url)

    deliveryAttempted = true
    const mail = await sendEmail({
      organizationId: orgId,
      to: clientEmail,
      subject,
      html,
      attachments: [{ filename: rendered.fileName, content: rendered.buffer }],
    })
    // A provider-returned rejection is definitive, so release the claim.
    // A thrown transport error is ambiguous and must keep `sending` to avoid
    // issuing a duplicate email if Resend accepted it before the connection broke.
    if (mail.error) {
      if (mail.delivery === 'rejected' || mail.delivery === 'not_sent') {
        deliveryAttempted = false
        const { data: released, error: releaseError } = await admin.from('invoices')
          .update({ status: 'draft' })
          .eq('id', invoiceId)
          .eq('status', 'sending')
          .select('id')
          .maybeSingle()
        if (releaseError || !released) console.error('[cron/recurring] release rejected send:', releaseError?.message ?? 'claim not released')
      } else {
        console.error('[cron/recurring] leaving ambiguous email claim in sending state', invoiceId)
      }
      return false
    }

    const { data: sentInvoice, error: sentError } = await admin
      .from('invoices')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', invoiceId)
      .eq('status', 'sending')
      .select('id')
      .maybeSingle()

    if (sentError || !sentInvoice) {
      console.error('[cron/recurring] mark sent:', sentError?.message ?? 'claim not updated after delivery')
      return false
    }

    return true
  } catch (err) {
    console.error('[cron/recurring] autoSendInvoice error:', err)
    if (!deliveryAttempted) {
      const { error: releaseError } = await admin.from('invoices')
        .update({ status: 'draft' })
        .eq('id', invoiceId)
        .eq('status', 'sending')
      if (releaseError) console.error('[cron/recurring] rollback send claim:', releaseError.message)
    } else {
      // Provider outcome is unknown; keeping `sending` is safer than retrying
      // and possibly sending the same invoice twice.
      console.error('[cron/recurring] leaving ambiguous email claim in sending state', invoiceId)
    }
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
      .select('name, email, email_from_address, logo_url')
      .eq('id', orgId)
      .single()

    if (!org?.email) return false

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
    const bodyHtml = escHtml(bodyText).replace(/\n/g, '<br>')
    const html = renderOrganizationEmail({ subject, orgName: org.name, logoUrl: org.logo_url, bodyHtml: `<div style="line-height:1.7;color:#3b3935;font-size:14px">${bodyHtml}</div>` })

    const { error: sendError } = await sendEmail({
      organizationId: orgId,
      to: org.email,
      subject,
      html,
    })
    if (sendError) {
      console.error('[cron/recurring] notifyArtisan send:', sendError)
      return false
    }
    return true
  } catch (err) {
    console.error('[cron/recurring] notifyArtisan error:', err)
    return false
  }
}
