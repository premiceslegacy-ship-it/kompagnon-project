import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getBusinessContext, formatBusinessContextForPrompt } from '@/lib/ai/business-context'
import { callAI } from '@/lib/ai/callAI'
import { verifyCronSecret } from '@/lib/cron-auth'
import { CLIENT_NAME_JOIN, clientNameFromJoin } from '@/lib/client'
import { todayParis } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const MODEL = 'google/gemini-2.5-flash'

// Génère le brief du jour pour Sarah — appelé chaque matin à 7h (Europe/Paris)
// Stocké dans company_memory (type: 'daily_brief') avec metadata.date = YYYY-MM-DD
// Sarah le lit au premier message de la journée et le badge +1 tant que non lu.

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!verifyCronSecret(bearerToken ?? req.headers.get('x-cron-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const today = todayParis()

  // Récupérer toutes les orgs actives avec le module sarah_assistant activé
  const { data: orgs, error: orgsErr } = await admin
    .from('organization_modules')
    .select('organization_id, modules')
    .not('modules', 'is', null)

  if (orgsErr || !orgs?.length) {
    return NextResponse.json({ ok: true, skipped: 'no_orgs' })
  }

  const eligible = orgs.filter(o => o.modules?.sarah_assistant === true)

  let generated = 0
  let skipped = 0
  let errors = 0

  for (const org of eligible) {
    const orgId = org.organization_id

    // Ne pas re-générer si un brief existe déjà pour aujourd'hui
    const { data: existing } = await admin
      .from('company_memory')
      .select('id')
      .eq('organization_id', orgId)
      .eq('type', 'daily_brief')
      .eq('metadata->>date', today)
      .limit(1)

    if (existing?.length) { skipped++; continue }

    try {
      const businessCtx = await getBusinessContext(orgId)
      const businessPrompt = formatBusinessContextForPrompt(businessCtx)

      // Données opérationnelles du jour
      const [
        { data: overdueInvoices },
        { data: dueTasks },
        { data: todayPlanning },
        { data: todayPointages },
        { data: expiringQuotes },
      ] = await Promise.all([
        admin.from('invoices')
          .select(`number, total_ttc, due_date, ${CLIENT_NAME_JOIN}`)
          .eq('organization_id', orgId)
          .eq('is_archived', false)
          .in('status', ['sent', 'partial'])
          .lt('due_date', today)
          .limit(5),
        admin.from('chantier_taches')
          .select('title, due_date, chantier:chantiers!inner(title, organization_id, is_archived, status)')
          .eq('chantier.organization_id', orgId)
          .eq('chantier.is_archived', false)
          .not('chantier.status', 'in', '("termine","annule")')
          .not('status', 'eq', 'termine')
          .not('due_date', 'is', null)
          .lte('due_date', today)
          .limit(5),
        admin.from('chantier_plannings')
          .select('id, label, planned_date, member_id, equipe_id, team_size, chantier:chantiers!inner(id, title, organization_id, is_archived)')
          .eq('chantier.organization_id', orgId)
          .eq('chantier.is_archived', false)
          .eq('planned_date', today)
          .limit(5),
        admin.from('chantier_pointages')
          .select('chantier_planning_id, chantier_id, date, member_id, user_id')
          .eq('date', today),
        admin.from('quotes')
          .select(`reference, total_ttc, valid_until, ${CLIENT_NAME_JOIN}`)
          .eq('organization_id', orgId)
          .in('status', ['sent', 'viewed'])
          .lte('valid_until', new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10))
          .gte('valid_until', today)
          .limit(3),
      ])

      const pointedPlanningIds = new Set((todayPointages ?? []).map((p: any) => p.chantier_planning_id).filter(Boolean))
      const pointedPlanningKeys = new Set((todayPointages ?? []).map((p: any) => `${p.chantier_id}:${p.date}:${p.member_id ?? p.user_id ?? '*'}`))
      const filteredTodayPlanning = (todayPlanning ?? []).filter((slot: any) => {
        if (pointedPlanningIds.has(slot.id)) return false
        const directKey = `${(slot.chantier as any)?.id ?? ''}:${today}:${slot.member_id ?? '*'}`
        const genericKey = `${(slot.chantier as any)?.id ?? ''}:${today}:*`
        return !pointedPlanningKeys.has(directKey) && !pointedPlanningKeys.has(genericKey)
      })

      const contextLines: string[] = [businessPrompt, `Date du jour : ${today}`]

      if (filteredTodayPlanning.length) {
        contextLines.push(`Planning aujourd'hui : ${filteredTodayPlanning.map(s => `${(s.chantier as any)?.title ?? '?'} (${s.label ?? 'intervention'})`).join(', ')}`)
      }
      if (dueTasks?.length) {
        contextLines.push(`Taches en retard : ${dueTasks.map(t => `"${t.title}" — ${(t.chantier as any)?.title ?? '?'}`).join('; ')}`)
      }
      if (overdueInvoices?.length) {
        contextLines.push(`Factures impayées : ${overdueInvoices.map(i => `${i.number} (${clientNameFromJoin((i as any).client) ?? '?'}, ${i.total_ttc}€, échue ${i.due_date})`).join('; ')}`)
      }
      if (expiringQuotes?.length) {
        contextLines.push(`Devis expirant bientôt : ${expiringQuotes.map(q => `${q.reference} (${clientNameFromJoin((q as any).client) ?? '?'}, expire ${q.valid_until})`).join('; ')}`)
      }

      const userPrompt = `${contextLines.join('\n\n')}

Génère le brief du jour pour l'artisan. 3 à 5 points concis, du plus urgent au moins urgent. Format : une phrase par point, sans numérotation, sans tiret, sans emoji. Commence directement par le premier point. Langue : français professionnel.`

      const result = await callAI<any>({
        organizationId: orgId,
        provider: 'openrouter',
        feature: 'sarah_assistant',
        inputKind: 'text',
        model: MODEL,
        request: {
          body: {
            messages: [
              { role: 'system', content: 'Tu es Sarah, secrétaire IA. Génère un brief quotidien synthétique pour un artisan du bâtiment. Pas de JSON, juste le texte du brief.' },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.4,
            max_tokens: 300,
          },
        },
      })

      const briefText = result?.data?.choices?.[0]?.message?.content?.trim()
      if (!briefText) { errors++; continue }

      await admin.from('company_memory').insert({
        organization_id: orgId,
        type: 'daily_brief',
        content: briefText,
        source: 'sarah_cron',
        confidence: 1.0,
        is_active: true,
        metadata: { date: today, read: false },
        embedding: null,
      })

      generated++
    } catch (err) {
      console.error(`[sarah-daily-brief] org ${orgId}:`, err)
      errors++
    }
  }

  return NextResponse.json({ ok: true, today, generated, skipped, errors })
}
