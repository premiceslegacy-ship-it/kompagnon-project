import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email'
import { computeNextSendDate } from '@/lib/data/recurring-utils'
import type { RecurringFrequency } from '@/lib/data/recurring-utils'
import { APP_SIGNATURE } from '@/lib/brand'

// ─── GET /api/cron/recurring-invoices ─────────────────────────────────────────
// Appelé chaque matin à 8h UTC par Vercel Cron.
// Protégé par Authorization: Bearer CRON_SECRET.
//
// Logique :
//   Pour chaque org, cherche les modèles récurrents actifs dont
//   next_send_date <= aujourd'hui + confirmation_delay_days.
//   → Crée un brouillon (invoice) avec les items copiés
//   → Crée un invoice_schedules (status='pending_confirmation')
//   → Calcule et enregistre la prochaine occurrence
//   → Notifie l'artisan par email

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  let created = 0
  let errors = 0

  // ── 1. Charger tous les modèles récurrents actifs dont l'envoi approche ───────

  // On cherche les modèles où next_send_date <= aujourd'hui + confirmation_delay_days
  // On fait la comparaison côté app après chargement (plus simple que SQL dynamique)
  const { data: models, error: modelsError } = await admin
    .from('recurring_invoices')
    .select(`
      id, organization_id, client_id, title, frequency, send_day,
      custom_interval_days, next_send_date, requires_confirmation,
      confirmation_delay_days, currency,
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

      // Pas encore le moment de créer le brouillon
      if (today < triggerDate) continue

      // Vérifier qu'on n'a pas déjà créé un schedule pour cette occurrence
      const { count } = await admin
        .from('invoice_schedules')
        .select('id', { count: 'exact', head: true })
        .eq('recurring_invoice_id', model.id)
        .eq('scheduled_date', model.next_send_date)
        .in('status', ['pending_confirmation', 'confirmed', 'sent'])

      if ((count ?? 0) > 0) continue

      // ── 2. Créer le brouillon facture ────────────────────────────────────────

      const totalHt = (model.items ?? []).reduce(
        (sum: number, i: { quantity: number; unit_price: number }) => sum + i.quantity * i.unit_price,
        0,
      )
      const totalTva = (model.items ?? []).reduce(
        (sum: number, i: { quantity: number; unit_price: number; vat_rate: number }) =>
          sum + i.quantity * i.unit_price * (i.vat_rate / 100),
        0,
      )

      // Numéro de facture auto
      const { data: invoiceRow } = await admin
        .from('invoices')
        .insert({
          organization_id: model.organization_id,
          client_id: model.client_id,
          title: model.title,
          currency: model.currency ?? 'EUR',
          status: 'draft',
          issue_date: model.next_send_date,
          due_date: model.next_send_date, // sera affiné à la validation
          total_ht: totalHt,
          total_tva: totalTva,
          total_ttc: totalHt + totalTva,
        })
        .select('id')
        .single()

      if (!invoiceRow) { errors++; continue }

      // ── 3. Copier les items du modèle dans la facture ────────────────────────

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

      // ── 4. Créer l'occurrence planifiée ──────────────────────────────────────

      await admin.from('invoice_schedules').insert({
        organization_id: model.organization_id,
        recurring_invoice_id: model.id,
        scheduled_date: model.next_send_date,
        status: model.requires_confirmation ? 'pending_confirmation' : 'confirmed',
        invoice_id: invoiceRow.id,
        amount_ht: totalHt,
        notified_at: new Date().toISOString(),
      })

      // ── 5. Calculer et enregistrer la prochaine occurrence ───────────────────

      const nextDate = computeNextSendDate(
        new Date(model.next_send_date),
        model.frequency as RecurringFrequency,
        model.send_day,
        model.custom_interval_days,
      )
      await admin
        .from('recurring_invoices')
        .update({ next_send_date: nextDate.toISOString().split('T')[0] })
        .eq('id', model.id)

      // ── 6. Notifier l'artisan ────────────────────────────────────────────────

      if (model.requires_confirmation) {
        await notifyArtisan(admin, model.organization_id, {
          invoiceId: invoiceRow.id,
          invoiceTitle: model.title,
          scheduledDate: model.next_send_date,
          totalHt,
          currency: model.currency ?? 'EUR',
        })
      }

      created++
    } catch (err) {
      console.error(`[cron/recurring] model ${model.id}:`, err)
      errors++
    }
  }

  console.log(`[cron/recurring] done: ${created} created, ${errors} errors`)
  return NextResponse.json({ created, errors })
}

// ─── Notification email à l'artisan ───────────────────────────────────────────

async function notifyArtisan(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  data: {
    invoiceId: string
    invoiceTitle: string
    scheduledDate: string
    totalHt: number
    currency: string
  },
) {
  try {
    // Charger l'org + le profil owner
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

    const subject = `Facture récurrente à valider : ${data.invoiceTitle}`
    const bodyText = `Bonjour,\n\nUne facture récurrente a été préparée automatiquement et attend votre validation avant envoi.\n\nFacture : ${data.invoiceTitle}\nDate d'envoi prévue : ${fmtDate}\nMontant HT : ${fmtAmount}\n\nVous pouvez la vérifier ici :\n${appUrl}/finances/invoice-editor?id=${data.invoiceId}\n\nSi tout vous semble correct, il vous suffit de cliquer sur "Valider & Envoyer".\n\nAu plaisir de vous simplifier le suivi,\n${APP_SIGNATURE}`
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
