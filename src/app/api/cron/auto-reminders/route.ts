import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

export const dynamic = 'force-dynamic';
import { getClientGreetingName } from '@/lib/client'
import { APP_NAME } from '@/lib/brand'
import { AIModuleDisabledError, callAI } from '@/lib/ai/callAI'
import { getSupabaseRuntimeConfig } from '@/lib/supabase/config'
import { verifyCronSecret } from '@/lib/cron-auth'
import { renderInvoicePdfBufferById, renderQuotePdfBufferById } from '@/lib/pdf/server'

// ─── Sécurité ─────────────────────────────────────────────────────────────────
// Appelé par Cloudflare Worker (ou cron-job.org) avec le header X-Cron-Secret

const COOLDOWN_DAYS = 2
const MAX_RANK = 3 // Au-delà : plus de relance automatique, passage manuel

// ─── Types internes ───────────────────────────────────────────────────────────

type Org = {
  id: string
  name: string
  email: string | null
  email_from_name: string | null
  email_from_address: string | null
  auto_reminder_enabled: boolean
  invoice_reminder_days: number[] | null
  quote_reminder_days: number[] | null
  reminder_first_delay_days: number | null
}

type ReminderItem = {
  id: string
  type: 'invoice' | 'quote'
  invoiceType?: string | null  // 'acompte' | 'situation' | 'solde' | null
  invoiceReminderReason?: 'sent_unpaid' | 'overdue'
  number: string | null
  clientName: string
  clientEmail: string | null
  clientId: string | null
  amount: number | null
  currency: string
  dueOrSentDate: string
  daysLate: number
  rank: number
  signatureToken?: string | null
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get('x-cron-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { supabaseUrl } = getSupabaseRuntimeConfig()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase: any = createClient(
    supabaseUrl,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const resend = new Resend(process.env.RESEND_API_KEY!)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  const today = new Date()
  const todayStr = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(today).split('/').reverse().join('-')
  const cooldownCutoff = new Date(today.getTime() - COOLDOWN_DAYS * 86400000).toISOString()

  // 1. Toutes les orgs avec relances auto activées
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name, email, email_from_name, email_from_address, auto_reminder_enabled, invoice_reminder_days, quote_reminder_days, reminder_first_delay_days')
    .eq('auto_reminder_enabled', true)

  if (!orgs?.length) {
    return NextResponse.json({ processed: 0, sent: 0 })
  }

  let totalSent = 0
  const errors: string[] = []

  for (const org of orgs as Org[]) {
    if (!org.email_from_address) continue
    const baseInvoiceDays = org.invoice_reminder_days ?? [3, 7]
    const invoiceDays = org.reminder_first_delay_days != null
      ? [Math.max(3, org.reminder_first_delay_days), ...baseInvoiceDays.slice(1)]
      : baseInvoiceDays
    const quoteDays = org.quote_reminder_days ?? [2, 7, 10]

    try {
      const items = await collectItems(supabase, org.id, todayStr, invoiceDays, quoteDays, cooldownCutoff)

      for (const item of items) {
        if (item.rank > MAX_RANK) continue
        if (!item.clientEmail) continue

        try {
          const { subject, body } = await generateEmail(
            org.name, item, appUrl, org.id, org.email ?? null,
          )

          let attachments: Array<{ filename: string; content: Buffer }> | undefined
          let signUrl: string | null = null
          if (item.type === 'quote') {
            if (item.signatureToken && !appUrl) {
              throw new Error('NEXT_PUBLIC_APP_URL non configurée pour le lien de signature')
            }
            signUrl = item.signatureToken
              ? `${appUrl.replace(/\/+$/, '')}/sign/${item.signatureToken}`
              : null

            try {
              const pdf = await renderQuotePdfBufferById(item.id, org.id)
              if (pdf) attachments = [{ filename: pdf.fileName, content: pdf.buffer }]
            } catch (pdfError) {
              console.error(`[auto-reminders] PDF devis ${item.id}:`, pdfError)
            }
          } else {
            try {
              const pdf = await renderInvoicePdfBufferById(item.id, org.id)
              if (pdf) attachments = [{ filename: pdf.fileName, content: pdf.buffer }]
            } catch (pdfError) {
              console.error(`[auto-reminders] PDF facture ${item.id}:`, pdfError)
            }
          }

          const fromName = org.email_from_name || org.name
          const { error: emailError } = await resend.emails.send({
            from: `${fromName} <${org.email_from_address}>`,
            to: item.clientEmail,
            subject,
            html: wrapHtml(org.name, body.replace(/\n/g, '<br>'), signUrl),
            ...(attachments?.length ? { attachments } : {}),
          })
          if (emailError) throw new Error(`Resend: ${emailError.message}`)

          // Log relance
          await supabase.from('reminders').insert({
            organization_id: org.id,
            ...(item.type === 'invoice' ? { invoice_id: item.id } : { quote_id: item.id }),
            client_id: item.clientId,
            type: item.type === 'invoice' ? 'payment_reminder' : 'quote_followup',
            rank: item.rank,
            sent_at: new Date().toISOString(),
            is_auto: true,
            email_subject: subject,
            email_body: body,
          })

          // Log activité
          await supabase.from('activity_log').insert({
            organization_id: org.id,
            action: 'auto_reminder_sent',
            entity_type: item.type,
            entity_id: item.id,
            metadata: { rank: item.rank, client: item.clientName, amount: item.amount },
          })

          totalSent++
        } catch (itemErr) {
          errors.push(`[${org.id}] ${item.type} ${item.id}: ${String(itemErr)}`)
        }
      }
    } catch (orgErr) {
      errors.push(`[org ${org.id}]: ${String(orgErr)}`)
    }
  }

  if (errors.length) console.error('[auto-reminders] errors:', errors)

  return NextResponse.json({ processed: orgs.length, sent: totalSent, errors: errors.length })
}

// ─── Collecte des items à relancer ────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function collectItems(
  supabase: any,
  orgId: string,
  todayStr: string,
  invoiceReminderDays: number[],
  quoteReminderDays: number[],
  cooldownCutoff: string,
): Promise<ReminderItem[]> {
  const maxInvoiceDelay = Math.max(...invoiceReminderDays)
  const maxQuoteDelay = Math.max(...quoteReminderDays)
  const maxInvoiceSentBefore = new Date(Date.now() - maxInvoiceDelay * 86400000).toISOString()
  const maxQuoteSentBefore = new Date(Date.now() - maxQuoteDelay * 86400000).toISOString()

  const [
    { data: invoices },
    { data: quotes },
    { data: allReminders },
  ] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, number, total_ttc, currency, due_date, sent_at, invoice_type, client_id, client:clients(company_name, contact_name, first_name, last_name, email)')
      .eq('organization_id', orgId)
      .in('status', ['sent', 'partial'])
      .or(`sent_at.lt.${maxInvoiceSentBefore},due_date.lt.${todayStr}`),

    supabase
      .from('quotes')
      .select('id, number, title, total_ttc, currency, sent_at, client_id, signature_token, client:clients(company_name, contact_name, first_name, last_name, email)')
      .eq('organization_id', orgId)
      .in('status', ['sent', 'viewed'])
      .lt('sent_at', maxQuoteSentBefore),

    supabase
      .from('reminders')
      .select('invoice_id, quote_id, rank, sent_at')
      .eq('organization_id', orgId)
      .order('sent_at', { ascending: false }),
  ])

  // Map : id → { maxRank, lastSentAt }
  const reminderMap: Record<string, { maxRank: number; lastSentAt: string }> = {}
  for (const r of allReminders ?? []) {
    const key = r.invoice_id ?? r.quote_id
    if (!key) continue
    if (!reminderMap[key] || r.rank > reminderMap[key].maxRank) {
      reminderMap[key] = { maxRank: r.rank, lastSentAt: r.sent_at }
    }
  }

  const today = new Date()
  const items: ReminderItem[] = []

  for (const inv of invoices ?? []) {
    const info = reminderMap[inv.id]
    // Cooldown : ne pas envoyer si une relance a déjà été envoyée récemment
    if (info && info.lastSentAt > cooldownCutoff) continue
    const rank = info ? info.maxRank + 1 : 1
    const threshold = invoiceReminderDays[rank - 1]
    if (threshold === undefined) continue // plus de palier configuré
    const referenceDate = inv.sent_at?.split('T')[0] ?? inv.due_date
    if (!referenceDate) continue
    const daysSinceReference = Math.floor((today.getTime() - new Date(referenceDate).getTime()) / 86400000)
    if (daysSinceReference < threshold) continue // pas encore atteint le seuil
    const isOverdue = Boolean(inv.due_date && inv.due_date < todayStr)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = inv.client as any
    items.push({
      id: inv.id,
      type: 'invoice',
      invoiceType: inv.invoice_type ?? null,
      invoiceReminderReason: isOverdue ? 'overdue' : 'sent_unpaid',
      number: inv.number,
      clientName: getClientGreetingName(client),
      clientEmail: client?.email ?? null,
      clientId: inv.client_id,
      amount: inv.total_ttc,
      currency: inv.currency ?? 'EUR',
      dueOrSentDate: referenceDate,
      daysLate: daysSinceReference,
      rank,
    })
  }

  for (const q of quotes ?? []) {
    const info = reminderMap[q.id]
    if (info && info.lastSentAt > cooldownCutoff) continue
    const rank = info ? info.maxRank + 1 : 1
    const threshold = quoteReminderDays[rank - 1]
    if (threshold === undefined) continue
    const daysLate = Math.floor((today.getTime() - new Date(q.sent_at!).getTime()) / 86400000)
    if (daysLate < threshold) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = q.client as any
    items.push({
      id: q.id,
      type: 'quote',
      number: q.number,
      clientName: getClientGreetingName(client),
      clientEmail: client?.email ?? null,
      clientId: q.client_id,
      amount: q.total_ttc,
      currency: q.currency ?? 'EUR',
      dueOrSentDate: q.sent_at!.split('T')[0],
      daysLate,
      rank,
      signatureToken: q.signature_token ?? null,
    })
  }

  return items
}

// ─── Génération IA ────────────────────────────────────────────────────────────

async function generateEmail(
  orgName: string,
  item: ReminderItem,
  appUrl: string,
  orgId: string,
  orgEmail: string | null,
): Promise<{ subject: string; body: string }> {
  const fmtAmount = item.amount != null
    ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: item.currency }).format(item.amount)
    : null
  const fmtDate = new Date(item.dueOrSentDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })

  const toneGuide = item.rank === 1
    ? 'Ton cordial et professionnel. Simple rappel, peut-être perdu dans les spams.'
    : item.rank === 2
    ? 'Ton direct mais courtois. 2ème relance. Évoquer les délais légaux de paiement (30j B2B) sans menacer.'
    : 'Ton ferme. Dernière relance automatique. Mentionner que la prochaine étape sera la mise en demeure.'

  const invoiceTypeLabel = item.invoiceType === 'acompte' ? 'Acompte (facture d\'avance)'
    : item.invoiceType === 'situation' ? 'Situation de travaux'
    : item.invoiceType === 'solde' ? 'Facture de solde (dernière après acomptes)'
    : 'Facture'
  const contextStr = item.type === 'invoice'
    ? item.invoiceReminderReason === 'overdue'
      ? `${invoiceTypeLabel} ${item.number ?? ''}${fmtAmount ? `, ${fmtAmount} TTC` : ''}, échéance dépassée depuis ${item.daysLate}j`
      : `${invoiceTypeLabel} ${item.number ?? ''}${fmtAmount ? `, ${fmtAmount} TTC` : ''}, envoyée le ${fmtDate} (${item.daysLate}j sans règlement enregistré)`
    : `Devis ${item.number ?? ''}${item.amount ? `, ${fmtAmount} TTC` : ''}, envoyé le ${fmtDate} (${item.daysLate}j sans réponse)`

  const contactLine = orgEmail ? `Pour toute question, le client peut nous joindre à ${orgEmail}.` : ''
  const prompt = `Tu rédiges une relance automatique pour ${orgName} (artisan BTP).
Contexte : ${contextStr}
Client : ${item.clientName}
Relance n°${item.rank}, ${toneGuide}
${contactLine}

Règles obligatoires : aucun emoji, aucun tiret cadratin (—), français soigné, ton professionnel. Pour une facture envoyée mais pas encore échue, faire un rappel préventif de règlement sans parler de retard. Si un email de contact est fourni, l'inclure dans le corps du message avec la formule "Pour toute question, n'hésitez pas à nous contacter à [email]."

Format STRICT :
Objet: [sujet]
---
[corps, 3-4 phrases max, direct, professionnel, signe ${orgName}]`

  try {
    const { data } = await callAI<any>({
      organizationId: orgId,
      provider: 'openrouter',
      feature: 'auto_reminder_draft',
      model: 'anthropic/claude-haiku-4-5-20251001',
      inputKind: 'text',
      request: {
        body: {
          max_tokens: 300,
          messages: [{ role: 'user', content: prompt }],
        },
      },
      metadata: {
        route: 'api/cron/auto-reminders',
        item_type: item.type,
        item_id: item.id,
        app_name: APP_NAME,
        app_url: appUrl,
      },
    })

    const text: string = data.choices?.[0]?.message?.content?.trim() ?? ''
    const sep = text.indexOf('---')
    if (sep === -1) throw new Error('Format réponse inattendu')

    return {
      subject: text.slice(0, sep).replace(/^Objet:\s*/i, '').trim(),
      body: text.slice(sep + 3).trim(),
    }
  } catch (error) {
    if (error instanceof AIModuleDisabledError) {
      throw new Error('Module IA devis désactivé')
    }

    throw error
  }
}

// ─── HTML wrapper ─────────────────────────────────────────────────────────────

function wrapHtml(orgName: string, bodyHtml: string, signUrl: string | null = null): string {
  const signatureCallToAction = signUrl
    ? `<div style="margin-top:24px"><a href="${signUrl}" style="display:inline-block;background:#0a0a0a;color:white;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600">Consulter et signer le devis</a><p style="margin:12px 0 0;color:#777;font-size:12px;word-break:break-all">Si le bouton ne fonctionne pas : <a href="${signUrl}" style="color:#555">${signUrl}</a></p></div>`
    : ''

  return `<div style="max-width:560px;margin:0 auto;font-family:sans-serif"><div style="background:#0a0a0a;padding:24px 32px;border-radius:12px 12px 0 0"><p style="color:white;font-weight:bold;margin:0;font-size:16px">${orgName}</p></div><div style="background:white;padding:32px;border-radius:0 0 12px 12px;border:1px solid #eee;border-top:none;line-height:1.7;color:#333;font-size:14px">${bodyHtml}${signatureCallToAction}</div></div>`
}
