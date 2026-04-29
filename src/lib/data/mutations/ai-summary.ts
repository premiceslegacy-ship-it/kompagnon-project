'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { getClientGreetingName } from '@/lib/client'
import { APP_NAME } from '@/lib/brand'
import { todayParis, dateParis } from '@/lib/utils'
import { AIModuleDisabledError, callAI } from '@/lib/ai/callAI'
import { getChantierProfitability } from '@/lib/data/queries/chantier-profitability'

const WEEKLY_SUMMARY_MODEL = 'google/gemini-2.5-flash-lite'

export type AIReminderDraft = {
  subject: string
  body: string
  rank: number
  clientEmail: string | null
  clientName: string
  error: null
} | {
  subject: null
  body: null
  rank: number
  clientEmail: string | null
  clientName: string
  error: string
}

export async function generateAIReminderDraft(
  type: 'invoice' | 'quote',
  id: string,
): Promise<AIReminderDraft> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { subject: null, body: null, rank: 1, clientEmail: null, clientName: '', error: 'Non authentifié.' }

  if (!process.env.OPENROUTER_API_KEY) return { subject: null, body: null, rank: 1, clientEmail: null, clientName: '', error: 'Clé API IA manquante.' }

  // Fetch l'item + org
  const [orgRes, reminderCountRes] = await Promise.all([
    supabase.from('organizations').select('name').eq('id', orgId).single(),
    supabase.from('reminders').select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq(type === 'invoice' ? 'invoice_id' : 'quote_id', id),
  ])
  const orgName = orgRes.data?.name ?? 'L\'entreprise'
  const rank = (reminderCountRes.count ?? 0) + 1

  let clientEmail: string | null = null
  let clientName = 'Client'
  let contextStr = ''

  if (type === 'invoice') {
    const { data: inv } = await supabase
      .from('invoices')
      .select('number, total_ttc, due_date, currency, client:clients(company_name, contact_name, first_name, last_name, email)')
      .eq('id', id).eq('organization_id', orgId).single()

    if (!inv) return { subject: null, body: null, rank, clientEmail: null, clientName: '', error: 'Facture introuvable.' }

    const client = inv.client as any
    clientName = getClientGreetingName(client)
    clientEmail = client?.email ?? null
    const fmtAmount = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: inv.currency ?? 'EUR' }).format(inv.total_ttc ?? 0)
    const fmtDue = inv.due_date ? new Date(inv.due_date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : 'inconnue'
    const daysLate = inv.due_date
      ? Math.floor((Date.now() - new Date(inv.due_date).getTime()) / 86400000)
      : null

    contextStr = `Facture ${inv.number}, ${fmtAmount} TTC, échéance ${fmtDue}${daysLate !== null ? ` (${daysLate}j de retard)` : ''}`
  } else {
    const { data: quote } = await supabase
      .from('quotes')
      .select('number, title, total_ttc, sent_at, currency, signature_token, client:clients(company_name, contact_name, first_name, last_name, email)')
      .eq('id', id).eq('organization_id', orgId).single()

    if (!quote) return { subject: null, body: null, rank, clientEmail: null, clientName: '', error: 'Devis introuvable.' }

    const client = quote.client as any
    clientName = getClientGreetingName(client)
    clientEmail = client?.email ?? null
    const fmtAmount = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: quote.currency ?? 'EUR' }).format(quote.total_ttc ?? 0)
    const sentDate = quote.sent_at ? new Date(quote.sent_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long' }) : 'récemment'
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    const signUrl = quote.signature_token ? `${appUrl}/sign/${quote.signature_token}` : ''
    contextStr = `Devis ${quote.number}, "${quote.title}", ${fmtAmount} TTC, envoyé le ${sentDate}${signUrl ? `, lien signature : ${signUrl}` : ''}`
  }

  const toneGuide = rank === 1
    ? 'Ton cordial et professionnel. Simple rappel, pas de reproche. Laisse une porte ouverte (peut-être perdu dans les spams).'
    : rank === 2
    ? 'Ton direct mais courtois. Mentionne que c\'est la 2ème relance. Tu peux évoquer les délais légaux de paiement (30j en France pour B2B) sans être menaçant.'
    : 'Ton ferme et professionnel. Dernière relance avant voie amiable/recouvrement. Mentionne la mise en demeure comme prochaine étape possible.'

  const typeLabel = type === 'invoice' ? 'facture impayée' : 'devis sans réponse'
  const prompt = `Tu rédiges un email de relance professionnelle pour un artisan du BTP (${orgName}).
Contexte : ${contextStr}
Type : ${typeLabel}
Numéro de relance : ${rank}
Ton : ${toneGuide}

Règles de rédaction obligatoires :
- Français soigné, aucun anglicisme
- Aucun emoji, aucun symbole décoratif
- Aucun tiret cadratin (—). Utilise des virgules ou des points à la place.
- Ton humain et chaleureux, principes Carnegie : valorise le client, formule positivement, évite toute accusation directe
- Corps : 3 à 5 phrases maximum, va à l'essentiel
- Commence par "Bonjour ${clientName}," puis directement le sujet
- Pas de formule creuse ("j'espère que vous allez bien", "suite à notre précédent email")
- Signe avec le nom de l'entreprise : ${orgName}

Format de réponse STRICT :
Objet: [le sujet]
---
[le corps de l'email]`

  try {
    const { data } = await callAI<any>({
      organizationId: orgId,
      provider: 'openrouter',
      feature: 'reminder_draft',
      model: 'anthropic/claude-haiku-4-5',
      inputKind: 'text',
      request: {
        body: {
          max_tokens: 400,
          messages: [{ role: 'user', content: prompt }],
        },
      },
      metadata: {
        mutation: 'generateAIReminderDraft',
        draft_type: type,
        target_id: id,
        app_name: APP_NAME,
      },
    })

    const text: string = data.choices?.[0]?.message?.content?.trim() ?? ''

    const separatorIdx = text.indexOf('---')
    if (separatorIdx === -1) {
      return { subject: null, body: null, rank, clientEmail, clientName, error: 'Format de réponse inattendu.' }
    }

    const subjectLine = text.slice(0, separatorIdx).replace(/^Objet:\s*/i, '').trim()
    const body = text.slice(separatorIdx + 3).trim()

    return { subject: subjectLine, body, rank, clientEmail, clientName, error: null }
  } catch (e) {
    if (e instanceof AIModuleDisabledError) {
      return { subject: null, body: null, rank, clientEmail, clientName, error: 'Module IA devis désactivé.' }
    }
    console.error('[generateAIReminderDraft]', e)
    return { subject: null, body: null, rank, clientEmail, clientName, error: 'Impossible de contacter l\'IA.' }
  }
}

export type WeeklySummaryResult = {
  summary: string | null
  error: string | null
}

export async function getWeeklySummary(): Promise<WeeklySummaryResult> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { summary: null, error: 'Non authentifié.' }

  const today = new Date()
  const todayStr = todayParis()
  const sevenDaysAgoStr = dateParis(today.getTime() - 7 * 24 * 60 * 60 * 1000)

  const [
    { data: chantiers },
    { data: devisEnAttente },
    { data: facturesImpayees },
    { data: newRequests },
    { data: acomptesEnAttente },
  ] = await Promise.all([
    supabase
      .from('chantiers')
      .select('id, title, status, estimated_end_date, budget_ht, client:clients(company_name)')
      .eq('organization_id', orgId)
      .in('status', ['en_cours', 'planifie'])
      .eq('is_archived', false),

    supabase
      .from('quotes')
      .select('title, sent_at, total_ht, client:clients(company_name)')
      .eq('organization_id', orgId)
      .eq('status', 'sent')
      .lte('sent_at', sevenDaysAgoStr),

    supabase
      .from('invoices')
      .select('number, due_date, total_ttc, invoice_type, client:clients(company_name)')
      .eq('organization_id', orgId)
      .eq('status', 'sent')
      .lt('due_date', todayStr),

    supabase
      .from('quote_requests')
      .select('id')
      .eq('organization_id', orgId)
      .eq('status', 'new'),

    supabase
      .from('invoices')
      .select('number, total_ttc, due_date, notes_client, client:clients(company_name)')
      .eq('organization_id', orgId)
      .eq('invoice_type', 'acompte')
      .eq('status', 'sent')
      .lt('due_date', todayStr),
  ])

  if (!process.env.OPENROUTER_API_KEY) return { summary: null, error: 'Clé API IA manquante.' }

  // Calcul rentabilité pour les chantiers actifs (max 5 pour limiter les appels)
  const activeChantiers = (chantiers ?? []).slice(0, 5)
  const profitabilityResults = await Promise.allSettled(
    activeChantiers.map(c => getChantierProfitability((c as any).id))
  )

  const context = {
    chantiers_actifs: activeChantiers.map((c, i) => {
      const prof = profitabilityResults[i].status === 'fulfilled' ? profitabilityResults[i].value : null
      return {
        titre: c.title,
        statut: c.status,
        client: (c.client as any)?.company_name ?? null,
        fin_estimee: c.estimated_end_date ?? null,
        budget_ht: (c as any).budget_ht ?? null,
        marge_pct: prof ? Math.round(prof.marginPct * 100) : null,
        marge_eur: prof ? Math.round(prof.marginEur) : null,
        cout_total: prof ? Math.round(prof.costTotal) : null,
        heures_pointees: prof?.hoursLogged ?? null,
        alerte_budget: prof && (c as any).budget_ht > 0
          ? prof.costTotal / (c as any).budget_ht > 0.9 ? 'depassement_imminent' : null
          : null,
      }
    }),
    devis_sans_reponse_7j: (devisEnAttente ?? []).map(d => ({
      titre: d.title,
      client: (d.client as any)?.company_name ?? null,
      montant_ht: d.total_ht,
      envoye_le: (d.sent_at as string | null)?.split('T')[0] ?? null,
    })),
    factures_impayees: (facturesImpayees ?? []).map(f => ({
      numero: f.number,
      client: (f.client as any)?.company_name ?? null,
      montant_ttc: f.total_ttc,
      echeance: f.due_date,
      type: (f as any).invoice_type ?? null,
    })),
    acomptes_en_retard: (acomptesEnAttente ?? []).map(a => ({
      numero: a.number,
      libelle: a.notes_client ?? null,
      montant_ttc: a.total_ttc,
      echeance: a.due_date,
      client: (a.client as any)?.company_name ?? null,
    })),
    nouvelles_demandes: newRequests?.length ?? 0,
    date_aujourdhui: todayStr,
  }

  const prompt = `Tu es l'assistant de ${APP_NAME}, un ERP pour artisans du BTP.
Génère un résumé hebdomadaire concis et actionnable en français. Maximum 5 lignes.
Format : commence par les alertes critiques (factures impayées, chantiers en dépassement budget, marge faible < 10%), puis l'état général.
Termine toujours par UNE priorité claire : "Priorité : [action concrète]".
Sois direct, pas de formules creuses. Chiffre tout ce qui peut l'être (€, %, heures).
Si un chantier a alerte_budget="depassement_imminent" ou marge_pct < 10, mentionne-le explicitement.

Règles de style obligatoires :
- Aucun emoji, aucun symbole décoratif
- Aucun tiret cadratin (—). Utilise des virgules ou des points.
- Français irréprochable, ton professionnel et direct

Données actuelles :
${JSON.stringify(context, null, 2)}`

  try {
    const { data } = await callAI<any>({
      organizationId: orgId,
      provider: 'openrouter',
      feature: 'weekly_summary',
      model: WEEKLY_SUMMARY_MODEL,
      inputKind: 'text',
      request: {
        body: {
          max_tokens: 300,
          messages: [{ role: 'user', content: prompt }],
        },
        timeoutMs: 20000,
      },
      metadata: {
        mutation: 'getWeeklySummary',
        app_name: APP_NAME,
        model_family: 'gemini',
      },
    })

    const summary = data.choices?.[0]?.message?.content?.trim() ?? null
    return { summary, error: null }
  } catch (e) {
    if (e instanceof AIModuleDisabledError) {
      return { summary: null, error: 'Module IA planning désactivé.' }
    }
    console.error('[getWeeklySummary]', e)
    return { summary: null, error: 'Impossible de contacter l\'IA.' }
  }
}
