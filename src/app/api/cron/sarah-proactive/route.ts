import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCronSecret } from '@/lib/cron-auth'
import { dateParis, todayParis } from '@/lib/utils'
import { proposeSarahAction } from '@/lib/sarah/actions'
import { sendPushToOrgPermission } from '@/lib/push'

export const dynamic = 'force-dynamic'

function fmt(amount: number | null | undefined): string {
  if (amount == null) return '?'
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount)
}

function appendSarahParam(url: string, actionId: string): string {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}sarahActionId=${encodeURIComponent(actionId)}`
}

async function notify(orgId: string, title: string, body: string, url: string) {
  await sendPushToOrgPermission(orgId, 'ai.sarah', { title, body, url }).catch(() => {})
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!verifyCronSecret(bearerToken ?? req.headers.get('x-cron-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const today = todayParis()
  const yesterday = dateParis(Date.now() - 86400000)
  const in3days = dateParis(Date.now() + 3 * 86400000)
  const followUpCutoff = new Date(Date.now() - 2 * 86400000).toISOString()

  const { data: moduleRows, error } = await admin
    .from('organization_modules')
    .select('organization_id, modules')
    .not('modules', 'is', null)

  if (error) {
    console.error('[sarah-proactive] modules', error)
    return NextResponse.json({ ok: false, error: 'modules_failed' }, { status: 500 })
  }

  const orgs = (moduleRows ?? []).filter(row => row.modules?.sarah_assistant === true)
  let proposed = 0
  let notified = 0
  let errors = 0

  for (const org of orgs) {
    const orgId = org.organization_id as string
    try {
      const [
        { data: overdueInvoices },
        { data: pendingQuotes },
        { data: expiringQuotes },
        { data: newRequests },
        { data: todayPlanning },
        { data: yesterdayPlanning },
        { data: yesterdayPointages },
        { data: lateTasks },
        { data: activeChantiers },
      ] = await Promise.all([
        admin
          .from('invoices')
          .select('id, number, reference, client_name, total_ttc, total_paid, due_date')
          .eq('organization_id', orgId)
          .eq('is_archived', false)
          .in('status', ['sent', 'partial'])
          .lt('due_date', today)
          .order('due_date', { ascending: true })
          .limit(5),
        admin
          .from('quotes')
          .select('id, client_id, number, reference, client_name, total_ttc, sent_at')
          .eq('organization_id', orgId)
          .eq('is_archived', false)
          .in('status', ['sent', 'viewed'])
          .lt('sent_at', followUpCutoff)
          .order('sent_at', { ascending: true })
          .limit(5),
        admin
          .from('quotes')
          .select('id, number, reference, client_name, total_ttc, valid_until')
          .eq('organization_id', orgId)
          .eq('is_archived', false)
          .in('status', ['sent', 'viewed'])
          .gte('valid_until', today)
          .lte('valid_until', in3days)
          .order('valid_until', { ascending: true })
          .limit(5),
        admin
          .from('quote_requests')
          .select('id, name, company_name, subject, description, created_at')
          .eq('organization_id', orgId)
          .eq('status', 'new')
          .order('created_at', { ascending: false })
          .limit(5),
        admin
          .from('chantier_plannings')
          .select('id, planned_date, start_time, label, chantier:chantiers!inner(id, title, client_name, organization_id, is_archived, status)')
          .eq('chantier.organization_id', orgId)
          .eq('chantier.is_archived', false)
          .not('chantier.status', 'in', '("termine","annule")')
          .eq('planned_date', today)
          .order('start_time', { ascending: true, nullsFirst: false })
          .limit(8),
        admin
          .from('chantier_plannings')
          .select('id, chantier_id, planned_date, member_id, chantier:chantiers!inner(id, title, organization_id, is_archived, status)')
          .eq('chantier.organization_id', orgId)
          .eq('chantier.is_archived', false)
          .not('chantier.status', 'in', '("termine","annule")')
          .eq('planned_date', yesterday)
          .limit(80),
        admin
          .from('chantier_pointages')
          .select('id, chantier_id, date, member_id')
          .eq('date', yesterday)
          .limit(120),
        admin
          .from('chantier_taches')
          .select('id, title, due_date, chantier:chantiers!inner(id, title, organization_id, is_archived, status)')
          .eq('chantier.organization_id', orgId)
          .eq('chantier.is_archived', false)
          .not('chantier.status', 'in', '("termine","annule")')
          .not('status', 'eq', 'termine')
          .not('due_date', 'is', null)
          .lte('due_date', today)
          .order('due_date', { ascending: true })
          .limit(6),
        admin
          .from('chantiers')
          .select('id, title, budget_ht')
          .eq('organization_id', orgId)
          .eq('is_archived', false)
          .in('status', ['planifie', 'en_cours'])
          .gt('budget_ht', 0)
          .limit(80),
      ])

      for (const inv of overdueInvoices ?? []) {
        const ref = inv.reference ?? inv.number ?? 'Facture'
        const remaining = Math.max(0, Number(inv.total_ttc ?? 0) - Number(inv.total_paid ?? 0))
        const body = `La facture ${ref} de ${inv.client_name ?? 'ce client'} est en retard depuis le ${inv.due_date}.`
        const action = await proposeSarahAction({
          organizationId: orgId,
          type: 'invoice_reminder',
          risk: 'medium',
          title: `Relancer ${ref}`,
          description: `${body} Sarah peut préparer la relance et ouvrir la facture.`,
          payload: {
            invoice_id: inv.id,
            client_name: inv.client_name,
            draft_text: `Bonjour,\n\nJe me permets de vous relancer concernant la facture ${ref}, d'un montant restant dû de ${fmt(remaining || inv.total_ttc)}, échue le ${inv.due_date}.\n\nPouvez-vous me confirmer la date de règlement prévue ?\n\nBien cordialement,`,
          },
          deepLink: `/finances/invoice-editor/${inv.id}`,
          dedupeKey: `invoice-overdue:${inv.id}:${inv.due_date}`,
        })
        if (action) {
          proposed++
          await notify(orgId, 'Sarah: facture à relancer', body, appendSarahParam(action.deep_link ?? '/finances', action.id))
          notified++
        }
      }

      for (const quote of pendingQuotes ?? []) {
        const ref = quote.reference ?? quote.number ?? 'Devis'
        const body = `Le devis ${ref} pour ${quote.client_name ?? 'ce client'} attend une réponse.`
        const action = await proposeSarahAction({
          organizationId: orgId,
          type: 'draft_email',
          risk: 'low',
          title: `Relancer ${ref}`,
          description: `${body} Sarah peut préparer un message de relance.`,
          payload: {
            quote_id: quote.id,
            client_ids: quote.client_id ? [quote.client_id] : [],
            recipient_filter: quote.client_id ? { mode: 'manual', ids: [quote.client_id] } : undefined,
            client_name: quote.client_name,
            subject: `Relance devis ${ref}`,
            body: `Bonjour,\n\nJe me permets de revenir vers vous concernant le devis ${ref}.\n\nSouhaitez-vous que nous avancions sur ce projet ou avez-vous besoin d'une précision ?\n\nBien cordialement,`,
          },
          deepLink: `/finances/quote-editor/${quote.id}`,
          dedupeKey: `quote-followup:${quote.id}`,
        })
        if (action) { proposed++; await notify(orgId, 'Sarah: devis à relancer', body, appendSarahParam(action.deep_link ?? '/finances', action.id)); notified++ }
      }

      for (const quote of expiringQuotes ?? []) {
        const ref = quote.reference ?? quote.number ?? 'Devis'
        const body = `Le devis ${ref} expire le ${quote.valid_until}.`
        const action = await proposeSarahAction({
          organizationId: orgId,
          type: 'open_quote_editor',
          risk: 'low',
          title: `Vérifier ${ref}`,
          description: `${body} Sarah peut vous ouvrir le devis pour le relancer ou le prolonger.`,
          payload: { quote_id: quote.id, client_name: quote.client_name },
          deepLink: `/finances/quote-editor/${quote.id}`,
          dedupeKey: `quote-expiring:${quote.id}:${quote.valid_until}`,
        })
        if (action) { proposed++; await notify(orgId, 'Sarah: devis bientôt expiré', body, appendSarahParam(action.deep_link ?? '/finances', action.id)); notified++ }
      }

      for (const request of newRequests ?? []) {
        const who = request.company_name ?? request.name ?? 'Nouvelle demande'
        const description = request.subject ?? request.description ?? 'Demande de devis entrante'
        const action = await proposeSarahAction({
          organizationId: orgId,
          type: 'brief_chloe',
          risk: 'medium',
          title: `Préparer un devis pour ${who}`,
          description: `Nouvelle demande de devis : ${description}`,
          payload: {
            client_name: who,
            description,
            quote_request_id: request.id,
          },
          deepLink: '/finances/quote-editor',
          dedupeKey: `quote-request:${request.id}`,
        })
        if (action) { proposed++; await notify(orgId, 'Sarah: nouvelle demande de devis', `${who}: ${description}`, appendSarahParam(action.deep_link ?? '/finances/quote-editor', action.id)); notified++ }
      }

      if ((todayPlanning ?? []).length > 0) {
        const first = todayPlanning![0] as any
        const c = first.chantier as any
        const body = `${todayPlanning!.length} créneau${todayPlanning!.length > 1 ? 'x' : ''} prévu${todayPlanning!.length > 1 ? 's' : ''} aujourd'hui.`
        const action = await proposeSarahAction({
          organizationId: orgId,
          type: 'open_url',
          risk: 'low',
          title: 'Voir le planning du jour',
          description: `${body} Premier chantier : ${c?.title ?? 'non renseigné'}.`,
          payload: { url: '/chantiers/planning', label: 'Planning global' },
          deepLink: '/chantiers/planning',
          dedupeKey: `planning-today:${today}`,
          expiresAt: `${today}T23:59:59+02:00`,
        })
        if (action) { proposed++; await notify(orgId, 'Sarah: planning du jour', body, appendSarahParam('/chantiers/planning', action.id)); notified++ }
      }

      const pointageKeys = new Set((yesterdayPointages ?? []).map((p: any) => `${p.chantier_id}:${p.date}:${p.member_id ?? '*'}`))
      const pointageDayKeys = new Set((yesterdayPointages ?? []).map((p: any) => `${p.chantier_id}:${p.date}`))
      const missingSlots = (yesterdayPlanning ?? []).filter((slot: any) => {
        const directKey = `${slot.chantier_id}:${slot.planned_date}:${slot.member_id ?? '*'}`
        const dayKey = `${slot.chantier_id}:${slot.planned_date}`
        return !pointageKeys.has(directKey) && !pointageDayKeys.has(dayKey)
      }).slice(0, 5)
      if (missingSlots.length > 0) {
        const first = missingSlots[0] as any
        const c = first.chantier as any
        const body = `${missingSlots.length} pointage${missingSlots.length > 1 ? 's' : ''} à vérifier pour hier.`
        const action = await proposeSarahAction({
          organizationId: orgId,
          type: 'open_url',
          risk: 'low',
          title: 'Vérifier les pointages manquants',
          description: `${body} Premier chantier concerné : ${c?.title ?? 'non renseigné'}.`,
          payload: { url: '/chantiers/heures', label: 'Heures chantier' },
          deepLink: '/chantiers/heures',
          dedupeKey: `missing-pointages:${yesterday}`,
        })
        if (action) { proposed++; await notify(orgId, 'Sarah: pointages à vérifier', body, appendSarahParam('/chantiers/heures', action.id)); notified++ }
      }

      for (const task of lateTasks ?? []) {
        const c = (task as any).chantier
        const action = await proposeSarahAction({
          organizationId: orgId,
          type: 'task_complete',
          risk: 'medium',
          title: `Vérifier la tâche "${task.title}"`,
          description: `Cette tâche est échue depuis le ${task.due_date} sur le chantier "${c?.title ?? 'non renseigné'}".`,
          payload: { tache_id: task.id, chantier_id: c?.id, task_title: task.title },
          deepLink: c?.id ? `/chantiers/${c.id}` : '/chantiers',
          dedupeKey: `late-task:${task.id}:${task.due_date}`,
        })
        if (action) { proposed++; await notify(orgId, 'Sarah: tâche en retard', `${task.title} est échue.`, appendSarahParam(action.deep_link ?? '/chantiers', action.id)); notified++ }
      }

      const chantierIds = (activeChantiers ?? []).map(c => c.id)
      if (chantierIds.length > 0) {
        const [{ data: expenses }, { data: pointages }] = await Promise.all([
          admin.from('chantier_expenses').select('chantier_id, amount_ht').in('chantier_id', chantierIds),
          admin.from('chantier_pointages').select('chantier_id, hours, rate_snapshot').in('chantier_id', chantierIds),
        ])
        const costs: Record<string, number> = {}
        for (const exp of expenses ?? []) costs[exp.chantier_id] = (costs[exp.chantier_id] ?? 0) + (exp.amount_ht ?? 0)
        for (const p of pointages ?? []) costs[p.chantier_id] = (costs[p.chantier_id] ?? 0) + (p.hours ?? 0) * (p.rate_snapshot ?? 0)

        for (const chantier of activeChantiers ?? []) {
          const budget = chantier.budget_ht ?? 0
          if (budget <= 0) continue
          const cost = costs[chantier.id] ?? 0
          if (cost < budget * 0.9) continue
          const action = await proposeSarahAction({
            organizationId: orgId,
            type: 'open_chantier',
            risk: 'low',
            title: `Budget à surveiller : ${chantier.title}`,
            description: `Le chantier approche de son budget : ${fmt(cost)} de coûts suivis pour ${fmt(budget)} de budget.`,
            payload: { chantier_id: chantier.id },
            deepLink: `/chantiers/${chantier.id}`,
            dedupeKey: `chantier-budget-risk:${chantier.id}`,
          })
          if (action) { proposed++; await notify(orgId, 'Sarah: chantier à risque budget', chantier.title, appendSarahParam(action.deep_link ?? '/chantiers', action.id)); notified++ }
        }
      }
    } catch (err) {
      console.error(`[sarah-proactive] org ${orgId}`, err)
      errors++
    }
  }

  return NextResponse.json({ ok: true, today, organizations: orgs.length, proposed, notified, errors })
}
