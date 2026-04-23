import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email'
import { DEFAULT_EMAIL_TEMPLATES } from '@/lib/data/queries/emailTemplates'
import { getClientGreetingName } from '@/lib/client'

// ─── Interpolation ─────────────────────────────────────────────────────────────

function interpolate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, v), template)
}

function wrapHtml(orgName: string, bodyText: string): string {
  const bodyHtml = bodyText.replace(/\n/g, '<br>')
  return `<div style="max-width:560px;margin:0 auto;font-family:sans-serif"><div style="background:#0a0a0a;padding:24px 32px;border-radius:12px 12px 0 0"><p style="color:white;font-weight:bold;margin:0;font-size:16px">${orgName}</p></div><div style="background:white;padding:32px;border-radius:0 0 12px 12px;border:1px solid #eee;border-top:none;line-height:1.7;color:#333;font-size:14px">${bodyHtml}</div></div>`
}

// ─── GET /api/cron/reminders ───────────────────────────────────────────────────
// Appelé par Vercel Cron chaque matin à 9h (UTC 8h).
// Protégé par le header Authorization: Bearer CRON_SECRET.

export async function GET(req: NextRequest) {
  // Vérification du secret cron
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]

  let invoicesSent = 0
  let quotesSent = 0
  let errors = 0

  // ── 1. Charger toutes les orgs avec les relances auto activées ────────────────

  const currentHour = new Date().getUTCHours()

  const { data: orgs } = await admin
    .from('organizations')
    .select('id, name, email, email_from_address, auto_reminder_enabled, invoice_reminder_days, quote_reminder_days, reminder_hour_utc')
    .eq('auto_reminder_enabled', true)

  if (!orgs || orgs.length === 0) {
    return NextResponse.json({ message: 'Aucune organisation avec relances auto activées.', invoicesSent, quotesSent })
  }

  for (const org of orgs) {
    // Vérifier que l'heure UTC courante correspond à l'heure configurée pour cette org
    const orgHour = (org.reminder_hour_utc as number) ?? 8
    if (currentHour !== orgHour) continue

    const invoiceDays: number[] = (org.invoice_reminder_days as number[]) ?? [2, 7]
    const quoteDays: number[] = (org.quote_reminder_days as number[]) ?? [3, 10]

    // ── Charger les templates personnalisés de l'org ──────────────────────────

    const { data: customTemplates } = await admin
      .from('email_templates')
      .select('slug, subject, body_text')
      .eq('organization_id', org.id)
      .eq('is_active', true)

    const getTemplate = (slug: string): { subject: string; body_text: string } => {
      const custom = customTemplates?.find(t => t.slug === slug)
      if (custom) return { subject: custom.subject ?? '', body_text: custom.body_text ?? '' }
      const def = DEFAULT_EMAIL_TEMPLATES.find(t => t.slug === slug)
      return { subject: def?.subject ?? '', body_text: def?.body_text ?? '' }
    }

    // ── Relances FACTURES ─────────────────────────────────────────────────────

    for (const delayDays of invoiceDays) {
      // Factures dont l'échéance était exactement il y a `delayDays` jours
      const targetDate = new Date(today)
      targetDate.setDate(targetDate.getDate() - delayDays)
      const targetDateStr = targetDate.toISOString().split('T')[0]

      const { data: invoices } = await admin
        .from('invoices')
        .select('id, number, total_ttc, currency, due_date, client_id')
        .eq('organization_id', org.id)
        .eq('status', 'sent')
        .eq('due_date', targetDateStr)

      for (const invoice of invoices ?? []) {
        // Vérifier qu'une relance auto n'a pas déjà été envoyée aujourd'hui pour cette facture
        const { count } = await admin
          .from('reminders')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', org.id)
          .eq('invoice_id', invoice.id)
          .eq('is_auto', true)
          .gte('created_at', `${todayStr}T00:00:00Z`)

        if ((count ?? 0) > 0) continue // Déjà envoyé aujourd'hui

        // Compter le total de relances pour déterminer le niveau (1 ou 2)
        const { count: totalCount } = await admin
          .from('reminders')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', org.id)
          .eq('invoice_id', invoice.id)

        const rank = (totalCount ?? 0) + 1
        const slug = rank >= 2 ? 'payment_reminder_2' : 'payment_reminder_1'

        // Charger client
        let clientName = 'Client'
        let clientEmail: string | null = null
        if (invoice.client_id) {
          const { data: client } = await admin
            .from('clients')
            .select('company_name, contact_name, first_name, last_name, email')
            .eq('id', invoice.client_id)
            .single()
          if (client) {
            clientName = getClientGreetingName(client as any)
            clientEmail = (client as any).email ?? null
          }
        }

        if (!clientEmail) continue

        const fmtAmount = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: invoice.currency ?? 'EUR' }).format(invoice.total_ttc ?? 0)
        const fmtDate = invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : ''

        const vars: Record<string, string> = {
          numero_facture: invoice.number ?? '',
          client_nom: clientName,
          montant_ttc: fmtAmount,
          date_echeance: fmtDate,
          entreprise_nom: org.name,
        }

        const tpl = getTemplate(slug)
        const subject = interpolate(tpl.subject, vars)
        const html = wrapHtml(org.name, interpolate(tpl.body_text, vars))

        try {
          await sendEmail({ organizationId: org.id, to: clientEmail, subject, html })
          await admin.from('reminders').insert({
            organization_id: org.id,
            invoice_id: invoice.id,
            client_id: invoice.client_id ?? null,
            type: 'payment_reminder',
            rank,
            sent_at: today.toISOString(),
            is_auto: true,
            email_subject: subject,
            email_body: tpl.body_text,
          })
          invoicesSent++
        } catch (err) {
          console.error(`[cron/reminders] invoice ${invoice.id}:`, err)
          errors++
        }
      }
    }

    // ── Relances DEVIS ────────────────────────────────────────────────────────

    for (const delayDays of quoteDays) {
      const targetDate = new Date(today)
      targetDate.setDate(targetDate.getDate() - delayDays)

      // Devis envoyés il y a exactement delayDays jours (fenêtre de 24h)
      const windowStart = new Date(targetDate)
      windowStart.setHours(0, 0, 0, 0)
      const windowEnd = new Date(targetDate)
      windowEnd.setHours(23, 59, 59, 999)

      const { data: quotes } = await admin
        .from('quotes')
        .select('id, number, title, total_ttc, currency, client_id')
        .eq('organization_id', org.id)
        .in('status', ['sent', 'viewed'])
        .gte('sent_at', windowStart.toISOString())
        .lte('sent_at', windowEnd.toISOString())

      for (const quote of quotes ?? []) {
        // Vérifier qu'une relance auto n'a pas déjà été envoyée aujourd'hui
        const { count } = await admin
          .from('reminders')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', org.id)
          .eq('quote_id', quote.id)
          .eq('is_auto', true)
          .gte('created_at', `${todayStr}T00:00:00Z`)

        if ((count ?? 0) > 0) continue

        let clientName = 'Client'
        let clientEmail: string | null = null
        if (quote.client_id) {
          const { data: client } = await admin
            .from('clients')
            .select('company_name, contact_name, first_name, last_name, email')
            .eq('id', quote.client_id)
            .single()
          if (client) {
            clientName = getClientGreetingName(client as any)
            clientEmail = (client as any).email ?? null
          }
        }

        if (!clientEmail) continue

        const fmtAmount = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: quote.currency ?? 'EUR' }).format(quote.total_ttc ?? 0)

        const vars: Record<string, string> = {
          numero_devis: quote.number ?? '',
          client_nom: clientName,
          montant_ttc: fmtAmount,
          entreprise_nom: org.name,
          lien_signature: '',
        }

        const tpl = getTemplate('quote_sent')
        const subject = interpolate(tpl.subject, vars)
        const html = wrapHtml(org.name, interpolate(tpl.body_text, vars))

        try {
          await sendEmail({ organizationId: org.id, to: clientEmail, subject, html })
          await admin.from('reminders').insert({
            organization_id: org.id,
            quote_id: quote.id,
            client_id: quote.client_id ?? null,
            type: 'quote_followup',
            rank: 1,
            sent_at: today.toISOString(),
            is_auto: true,
            email_subject: subject,
            email_body: tpl.body_text,
          })
          quotesSent++
        } catch (err) {
          console.error(`[cron/reminders] quote ${quote.id}:`, err)
          errors++
        }
      }
    }
  }

  return NextResponse.json({
    success: true,
    invoicesSent,
    quotesSent,
    errors,
    processedOrgs: orgs.length,
  })
}
