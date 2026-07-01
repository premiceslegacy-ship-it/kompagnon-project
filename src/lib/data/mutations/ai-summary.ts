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

  // Fetch l'item + org + profil utilisateur connecté
  const { data: { user } } = await supabase.auth.getUser()
  const [orgRes, reminderCountRes, profileRes] = await Promise.all([
    supabase.from('organizations').select('name, signatory_name, signatory_role').eq('id', orgId).single(),
    supabase.from('reminders').select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq(type === 'invoice' ? 'invoice_id' : 'quote_id', id),
    user ? supabase.from('profiles').select('full_name').eq('id', user.id).single() : Promise.resolve({ data: null }),
  ])
  const orgName = orgRes.data?.name ?? 'L\'entreprise'
  const orgSignatoryName = (orgRes.data as any)?.signatory_name ?? null
  const orgSignatoryRole = (orgRes.data as any)?.signatory_role ?? null
  const userFullName = (profileRes as any).data?.full_name ?? null
  // Priorité : signataire fixe de l'org, sinon nom de la personne connectée
  const signatoryName = orgSignatoryName ?? userFullName
  const signatoryRole = orgSignatoryName ? orgSignatoryRole : null
  const rank = (reminderCountRes.count ?? 0) + 1

  let clientEmail: string | null = null
  let clientName = 'Client'
  let contextStr = ''
  let invoiceDaysOffset: number | null = null

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
    invoiceDaysOffset = inv.due_date
      ? Math.floor((Date.now() - new Date(inv.due_date).getTime()) / 86400000)
      : null
    const dueSituation = invoiceDaysOffset === null
      ? ''
      : invoiceDaysOffset > 0
        ? ` (${invoiceDaysOffset} jour${invoiceDaysOffset > 1 ? 's' : ''} de retard)`
        : invoiceDaysOffset === 0
          ? ' (échéance aujourd\'hui)'
          : ` (échéance dans ${Math.abs(invoiceDaysOffset)} jour${Math.abs(invoiceDaysOffset) > 1 ? 's' : ''})`

    contextStr = `Facture ${inv.number}, ${fmtAmount} TTC, échéance ${fmtDue}${dueSituation}`
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

  let toneGuide: string
  let typeLabel: string
  let dateInstruction: string

  if (type === 'invoice') {
    const d = invoiceDaysOffset

    if (d !== null && d < 0) {
      // Avant échéance
      const daysLeft = Math.abs(d)
      typeLabel = 'facture envoyée dont l\'échéance n\'est pas encore passée'
      if (daysLeft <= 7) {
        toneGuide = 'Ton courtois mais direct. L\'échéance est dans moins d\'une semaine. Mentionne la date précisément et encourage le règlement avant cette date, de façon positive ("pour clore ce dossier avant le [date]").'
        dateInstruction = 'Tu PEUX et DOIS mentionner la date d\'échéance précise, formulée comme une aide pour le client, pas comme une menace.'
      } else {
        toneGuide = 'Ton cordial et bienveillant. Rappel anticipé, pas de pression. Mentionne simplement que l\'échéance approche et que tu restes disponible.'
        dateInstruction = 'Mentionne la date d\'échéance de façon neutre, sans insistance.'
      }
    } else if (d === 0) {
      typeLabel = 'facture dont l\'échéance est aujourd\'hui'
      toneGuide = 'Ton courtois et direct. L\'échéance est aujourd\'hui. Rappelle-le clairement sans agressivité.'
      dateInstruction = 'Mentionne que l\'échéance est aujourd\'hui, formulé factuellement.'
    } else {
      // Après échéance — d > 0
      typeLabel = 'facture impayée dont l\'échéance est dépassée'
      if (rank === 1) {
        toneGuide = 'Ton cordial. Simple rappel de retard, pas de reproche. Laisse une porte ouverte (peut-être perdu dans les spams).'
        dateInstruction = 'Mentionne le retard factuellement, sans dramatiser.'
      } else if (rank === 2) {
        toneGuide = 'Ton direct mais courtois. Deuxième relance. Mentionne les délais légaux de paiement (30j en France pour B2B) sans menacer. Encourage à régulariser rapidement.'
        dateInstruction = 'Mentionne la date d\'échéance dépassée et le nombre de jours de retard, fermement mais sans agressivité.'
      } else {
        toneGuide = 'Ton ferme et professionnel. Dernière relance avant voie amiable ou recouvrement. Mentionne clairement la mise en demeure comme prochaine étape si aucun règlement sous 48h.'
        dateInstruction = 'Cite la date d\'échéance dépassée et le nombre de jours de retard. Fixe un délai de règlement de 48h de façon ferme mais professionnelle.'
      }
    }
  } else {
    typeLabel = 'devis sans réponse'
    dateInstruction = 'Ne mentionne pas de date limite.'
    toneGuide = rank === 1
      ? 'Ton cordial et professionnel. Simple rappel, pas de reproche. Laisse une porte ouverte (peut-être perdu dans les spams).'
      : rank === 2
      ? 'Ton direct mais courtois. Mentionne que c\'est la 2ème relance.'
      : 'Ton ferme et professionnel. Dernière relance avant clôture du devis.'
  }

  const signatureBlock = signatoryName
    ? `${signatoryName}${signatoryRole ? `, ${signatoryRole}` : ''}\n${orgName}`
    : orgName

  const paymentNote = type === 'invoice'
    ? '\n- Mentionne brièvement la pièce jointe ("vous trouverez la facture en pièce jointe"). Ne détaille pas son contenu.'
    : ''

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
- Oriente vers le règlement de façon positive : payer maintenant leur simplifie la vie autant qu'à toi
- Gestion de la date d'échéance : ${dateInstruction}${paymentNote}
- Signe EXACTEMENT ainsi, sur deux lignes séparées par \\n :
${signatureBlock}

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
    { data: maintenanceActifs },
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
      .in('status', ['sent', 'partial'])
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
      .in('status', ['sent', 'partial'])
      .lt('due_date', todayStr),

    supabase
      .from('maintenance_contracts')
      .select('title, chantier_id, montant_ht, frequence, period_cost_labor_ht, period_cost_parts_ht, period_cost_travel_ht, period_cost_other_ht, client:clients(company_name)')
      .eq('organization_id', orgId)
      .eq('status', 'actif'),
  ])

  if (!process.env.OPENROUTER_API_KEY) return { summary: null, error: 'Clé API IA manquante.' }

  // Calcul rentabilité pour les chantiers actifs (max 10 pour limiter les appels)
  const activeChantiers = (chantiers ?? []).slice(0, 10)
  const profitabilityResults = await Promise.allSettled(
    activeChantiers.map(c => getChantierProfitability((c as any).id))
  )

  // Indexer les contrats de maintenance actifs par chantier_id
  const maintenanceByChantier: Record<string, Array<{ titre: string; montant_ht: number | null; frequence: string }>> = {}
  for (const m of maintenanceActifs ?? []) {
    const cid = (m as any).chantier_id
    if (!cid) continue
    maintenanceByChantier[cid] ??= []
    maintenanceByChantier[cid].push({
      titre: (m as any).title,
      montant_ht: (m as any).montant_ht ?? null,
      frequence: (m as any).frequence,
    })
  }

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
        ca_facture_ht: prof ? Math.round(prof.revenueHt) : null,
        cout_main_oeuvre: prof ? Math.round(prof.costLabor) : null,
        cout_materiaux: prof ? Math.round(prof.costMaterial) : null,
        cout_sous_traitance: prof ? Math.round(prof.costSubcontract) : null,
        cout_autre: prof ? Math.round(prof.costOther) : null,
        heures_pointees: prof?.hoursLogged ?? null,
        alerte_budget: prof && (c as any).budget_ht > 0
          ? prof.costTotal / (c as any).budget_ht > 0.9 ? 'depassement_imminent' : null
          : null,
        contrats_maintenance_actifs: maintenanceByChantier[(c as any).id] ?? [],
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
Rédige un point de situation en français naturel, comme si tu parlais directement à l'artisan. Pas de liste à puces, pas de labels formatés, pas de format robot. Des phrases simples et directes, 3 à 5 phrases maximum.

Commence par ce qui est urgent ou problématique : marge négative, factures impayées, dépassement budget. Si un chantier a marge_pct < 10 ou marge_eur négatif, dis-le clairement avec les chiffres. Pour les chantiers en perte, oriente sur la cause probable en regardant cout_main_oeuvre, cout_materiaux, cout_sous_traitance. Si ce chantier a des contrats_maintenance_actifs, mentionne que les coûts d'entretien peuvent expliquer une partie des dépenses et qu'il faut vérifier la page Entretien.

Si devis_sans_reponse_7j est vide, dis-le ("aucun devis en attente"). Si factures_impayees est vide, dis-le ("aucune facture impayée"). Ne mentionne pas les sections vides si tout le reste est problématique, mais si tout va bien mentionne explicitement que la trésorerie est saine.

Termine par une recommandation concrète formulée naturellement, sans le mot "Priorité :".

Règles de style :
- Aucun emoji, aucun symbole décoratif
- Aucun tiret cadratin (—). Utilise des virgules ou des points.
- Aucun label formaté ("ALERTES :", "PRIORITÉ :", "État général :"), aucune liste à puces
- Français courant et professionnel, ton direct sans être froid
- Tu tutoies l'artisan

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
