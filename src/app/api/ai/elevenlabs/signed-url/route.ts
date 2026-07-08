import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import { isModuleEnabled } from '@/lib/data/queries/organization-modules'
import { checkQuota } from '@/lib/quota'
import { getBusinessContext, formatBusinessContextForPrompt, type BusinessContext } from '@/lib/ai/business-context'
import { dateParis, todayParis } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const VOICE_CONTEXT_MAX_CHARS = 9500
const VOICE_LIMITS = {
  todayPlanning: 8,
  weekPlanning: 12,
  activeChantiers: 6,
  tasks: 6,
  quotes: 5,
  invoices: 6,
  clients: 8,
  equipes: 10,
  members: 16,
  dailyActivity: 12,
  memories: 6,
}

function fmt(amount: number | string | null | undefined): string {
  if (amount == null) return '?'
  const numeric = typeof amount === 'string' ? Number(amount) : amount
  if (!Number.isFinite(numeric)) return '?'
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(numeric)
}

function shortText(value: string | null | undefined, max = 180): string | null {
  if (!value) return null
  const clean = value.replace(/\s+/g, ' ').trim()
  if (!clean) return null
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function clientName(client: any, fallback?: string | null): string {
  const c = Array.isArray(client) ? client[0] : client
  return c?.company_name
    || [c?.first_name, c?.last_name].filter(Boolean).join(' ')
    || c?.contact_name
    || fallback
    || '?'
}

function personName(row: { prenom?: string | null; name?: string | null; role_label?: string | null } | null | undefined): string | null {
  const full = [row?.prenom, row?.name].filter(Boolean).join(' ').trim()
  if (!full) return null
  return row?.role_label ? `${full} (${row.role_label})` : full
}

function slotHours(start: string | null | undefined, end: string | null | undefined): string | null {
  if (start && end) return `${start.slice(0, 5)}-${end.slice(0, 5)}`
  if (start) return start.slice(0, 5)
  return null
}

function buildActivityOperatingGuide(ctx: BusinessContext): string[] {
  const lines = [
    `Lecture métier : ${ctx.activityLabel}${ctx.activityDescription ? `, ${ctx.activityDescription.toLowerCase()}` : ''}.`,
  ]

  if (ctx.businessProfile === 'cleaning') {
    lines.push('Rouages à surveiller : contrats récurrents, passages planifiés, équipes/intervenants, adresses et accès sites, consommables, contrôles qualité, retards de pointage, reconduction et facturation périodique.')
    lines.push('Quand l\'utilisateur parle planning, raisonner en tournées, fréquence de passage, durée sur site, intervenant affecté et continuité client.')
  } else if (ctx.businessProfile === 'industry') {
    lines.push('Rouages à surveiller : demandes de prix, matières, fournisseurs, coûts atelier, délais de fabrication, marge, validation technique, livraison, devis complexes et suivi d\'avancement.')
    lines.push('Quand l\'utilisateur parle devis ou production, raisonner matière, épaisseur/format, temps machine/main-d\'œuvre, sous-traitance, marge et validation fournisseur.')
  } else {
    lines.push('Rouages à surveiller : devis en attente, chantiers actifs, tâches terrain, planning équipes, jalons, acomptes/situations, factures à relancer, marges et urgences client.')
    lines.push('Quand l\'utilisateur parle chantier, raisonner client, adresse, état d\'avancement, équipe prévue, tâches bloquantes, échéance et documents associés.')
  }

  if (ctx.secondaryActivityLabels.length > 0) {
    lines.push(`Activités secondaires à garder en tête : ${ctx.secondaryActivityLabels.join(', ')}.`)
  }

  return lines
}

// Contexte opérationnel injecté dans l'agent ElevenLabs : entreprise, équipes, activité, clients,
// chantiers, planning, devis/factures, demandes et mémoire Sarah.
async function buildVoiceContext(orgId: string, params: {
  pageLabel?: string | null
  pathname?: string | null
  userName?: string | null
} = {}): Promise<string> {
  const supabase = await createClient()
  const now = Date.now()
  const today = todayParis()
  const tomorrow = dateParis(now + 24 * 60 * 60 * 1000)
  const yesterday = dateParis(now - 24 * 60 * 60 * 1000)
  const in3days = dateParis(now + 3 * 24 * 60 * 60 * 1000)
  const in7days = dateParis(now + 7 * 24 * 60 * 60 * 1000)
  const followUpCutoff = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString()

  const [
    businessCtx,
    { data: org },
    { data: todayPlanning },
    { data: weekPlanning },
    { data: activeChantiers },
    { data: lateTasks },
    { data: upcomingTasks },
    { data: pendingQuotes },
    { data: recentQuotes },
    { data: invoicesToFollow },
    { data: recentInvoices },
    { data: keyClients },
    { data: recentClients },
    { data: quoteRequests },
    { data: equipes },
    { data: individualMembers },
    { data: yesterdayPlanning },
    { data: yesterdayPointages },
    { data: todayPointages },
    { data: todayCompletedTasks },
    { data: todayNotes },
    { data: todayPhotos },
    { data: durableMemories },
    { data: dailyBriefRows },
  ] =
    await Promise.all([
      getBusinessContext(orgId),
      supabase
        .from('organizations')
        .select('name, email, phone, website, address_line1, address_line2, postal_code, city, default_vat_rate, default_hourly_rate, payment_terms_days, quote_prefix, invoice_prefix, certifications, insurance_info')
        .eq('id', orgId)
        .single(),
      supabase
        .from('chantier_plannings')
        .select('id, chantier_id, planned_date, start_time, end_time, label, team_size, notes, member_id, equipe_id, chantier:chantiers!inner(id, title, organization_id, is_archived, status, client:clients(company_name, first_name, last_name, contact_name)), member:chantier_equipe_membres(id, prenom, name, role_label), equipe:chantier_equipes(id, name)')
        .eq('chantier.organization_id', orgId)
        .eq('chantier.is_archived', false)
        .not('chantier.status', 'in', '("termine","annule")')
        .eq('planned_date', today)
        .order('start_time', { ascending: true, nullsFirst: false })
        .limit(VOICE_LIMITS.todayPlanning),
      supabase
        .from('chantier_plannings')
        .select('id, chantier_id, planned_date, start_time, end_time, label, team_size, notes, member_id, equipe_id, chantier:chantiers!inner(id, title, organization_id, is_archived, status, client:clients(company_name, first_name, last_name, contact_name)), member:chantier_equipe_membres(id, prenom, name, role_label), equipe:chantier_equipes(id, name)')
        .eq('chantier.organization_id', orgId)
        .eq('chantier.is_archived', false)
        .not('chantier.status', 'in', '("termine","annule")')
        .gt('planned_date', today)
        .lte('planned_date', in7days)
        .order('planned_date', { ascending: true })
        .order('start_time', { ascending: true, nullsFirst: false })
        .limit(VOICE_LIMITS.weekPlanning),
      supabase
        .from('chantiers')
        .select('id, title, description, status, start_date, end_date, estimated_end_date, budget_ht, recurrence, recurrence_times, recurrence_team_size, recurrence_duration_h, recurrence_notes, client:clients(company_name, contact_name, first_name, last_name, email, phone, mobile)')
        .eq('organization_id', orgId)
        .eq('is_archived', false)
        .in('status', ['en_cours', 'planifie', 'suspendu'])
        .order('end_date', { ascending: true, nullsFirst: false })
        .limit(VOICE_LIMITS.activeChantiers),
      supabase
        .from('chantier_taches')
        .select('id, title, status, due_date, chantier:chantiers!inner(id, title, organization_id, is_archived, status)')
        .eq('chantier.organization_id', orgId)
        .eq('chantier.is_archived', false)
        .not('chantier.status', 'in', '("termine","annule")')
        .not('status', 'eq', 'termine')
        .not('due_date', 'is', null)
        .lte('due_date', today)
        .order('due_date', { ascending: true })
        .limit(VOICE_LIMITS.tasks),
      supabase
        .from('chantier_taches')
        .select('id, title, status, due_date, chantier:chantiers!inner(id, title, organization_id, is_archived, status)')
        .eq('chantier.organization_id', orgId)
        .eq('chantier.is_archived', false)
        .not('chantier.status', 'in', '("termine","annule")')
        .not('status', 'eq', 'termine')
        .not('due_date', 'is', null)
        .gt('due_date', today)
        .lte('due_date', in7days)
        .order('due_date', { ascending: true })
        .limit(VOICE_LIMITS.tasks),
      supabase
        .from('quotes')
        .select('id, number, title, status, total_ttc, sent_at, valid_until, client:clients(company_name, contact_name, first_name, last_name)')
        .eq('organization_id', orgId)
        .eq('is_archived', false)
        .in('status', ['sent', 'viewed'])
        .order('sent_at', { ascending: true, nullsFirst: false })
        .limit(VOICE_LIMITS.quotes),
      supabase
        .from('quotes')
        .select('id, number, title, status, total_ttc, created_at, valid_until, client:clients(company_name, contact_name, first_name, last_name)')
        .eq('organization_id', orgId)
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
        .limit(VOICE_LIMITS.quotes),
      supabase
        .from('invoices')
        .select('id, number, title, status, total_ttc, total_paid, due_date, sent_at, client:clients(company_name, contact_name, first_name, last_name)')
        .eq('organization_id', orgId)
        .eq('is_archived', false)
        .in('status', ['sent', 'partial', 'overdue'])
        .or(`due_date.lte.${today},sent_at.lt.${followUpCutoff}`)
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(VOICE_LIMITS.invoices),
      supabase
        .from('invoices')
        .select('id, number, title, status, total_ttc, total_paid, issue_date, due_date, client:clients(company_name, contact_name, first_name, last_name)')
        .eq('organization_id', orgId)
        .eq('is_archived', false)
        .order('issue_date', { ascending: false, nullsFirst: false })
        .limit(VOICE_LIMITS.invoices),
      supabase
        .from('clients')
        .select('id, company_name, contact_name, first_name, last_name, email, phone, mobile, city, status, payment_terms_days, total_revenue, total_paid, internal_notes, notes')
        .eq('organization_id', orgId)
        .eq('is_archived', false)
        .order('total_revenue', { ascending: false, nullsFirst: false })
        .limit(VOICE_LIMITS.clients),
      supabase
        .from('clients')
        .select('id, company_name, contact_name, first_name, last_name, email, phone, mobile, city, status, payment_terms_days, internal_notes, notes, created_at')
        .eq('organization_id', orgId)
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
        .limit(VOICE_LIMITS.clients),
      supabase
        .from('quote_requests')
        .select('id, name, company_name, subject, description, status, created_at')
        .eq('organization_id', orgId)
        .eq('status', 'new')
        .order('created_at', { ascending: false })
        .limit(VOICE_LIMITS.quotes),
      supabase
        .from('chantier_equipes')
        .select('id, name, description, membres:chantier_equipe_membres(id, prenom, name, role_label, email)')
        .eq('organization_id', orgId)
        .order('name', { ascending: true })
        .limit(VOICE_LIMITS.equipes),
      supabase
        .from('chantier_equipe_membres')
        .select('id, prenom, name, role_label, email')
        .eq('organization_id', orgId)
        .is('equipe_id', null)
        .order('name', { ascending: true })
        .limit(VOICE_LIMITS.members),
      supabase
        .from('chantier_plannings')
        .select('id, chantier_id, planned_date, member_id, equipe_id, chantier:chantiers!inner(id, organization_id, is_archived, status, title)')
        .eq('chantier.organization_id', orgId)
        .eq('chantier.is_archived', false)
        .not('chantier.status', 'in', '("termine","annule")')
        .eq('planned_date', yesterday)
        .limit(40),
      supabase
        .from('chantier_pointages')
        .select('id, chantier_id, date, member_id')
        .eq('date', yesterday)
        .limit(80),
      supabase
        .from('chantier_pointages')
        .select('id, chantier_planning_id, chantier_id, tache_id, user_id, member_id, date, hours, start_time, description, created_at, profile:profiles(full_name), membre:chantier_equipe_membres(prenom, name), tache:chantier_taches(title), chantier:chantiers!inner(id, title, organization_id, is_archived, status, client:clients(company_name, first_name, last_name, contact_name))')
        .eq('chantier.organization_id', orgId)
        .eq('chantier.is_archived', false)
        .eq('date', today)
        .order('start_time', { ascending: true, nullsFirst: false })
        .limit(VOICE_LIMITS.dailyActivity),
      supabase
        .from('activity_log')
        .select('user_id, entity_id, metadata, created_at')
        .eq('organization_id', orgId)
        .eq('action', 'chantier_task.completed')
        .gte('created_at', `${today}T00:00:00+02:00`)
        .lt('created_at', `${tomorrow}T00:00:00+02:00`)
        .order('created_at', { ascending: false })
        .limit(VOICE_LIMITS.dailyActivity),
      supabase
        .from('chantier_notes')
        .select('id, content, created_at, author:profiles(full_name), chantier:chantiers!inner(id, title, organization_id, is_archived, status, client:clients(company_name, first_name, last_name, contact_name))')
        .eq('chantier.organization_id', orgId)
        .eq('chantier.is_archived', false)
        .gte('created_at', `${today}T00:00:00+02:00`)
        .lt('created_at', `${tomorrow}T00:00:00+02:00`)
        .order('created_at', { ascending: false })
        .limit(VOICE_LIMITS.dailyActivity),
      supabase
        .from('chantier_photos')
        .select('id, title, caption, taken_at, created_at, uploader:profiles(full_name), tache:chantier_taches(title), chantier:chantiers!inner(id, title, organization_id, is_archived, status, client:clients(company_name, first_name, last_name, contact_name))')
        .eq('chantier.organization_id', orgId)
        .eq('chantier.is_archived', false)
        .gte('created_at', `${today}T00:00:00+02:00`)
        .lt('created_at', `${tomorrow}T00:00:00+02:00`)
        .order('created_at', { ascending: false })
        .limit(VOICE_LIMITS.dailyActivity),
      supabase
        .from('company_memory')
        .select('type, content, created_at')
        .eq('organization_id', orgId)
        .eq('is_active', true)
        .neq('type', 'daily_brief')
        .order('created_at', { ascending: false })
        .limit(VOICE_LIMITS.memories),
      supabase
        .from('company_memory')
        .select('content')
        .eq('organization_id', orgId)
        .eq('type', 'daily_brief')
        .eq('metadata->>date', today)
        .eq('is_active', true)
        .limit(1),
    ])

  const equipeMembersById = new Map<string, string>()
  for (const e of equipes ?? []) {
    const eq = e as any
    const members = (eq.membres ?? [])
      .map((m: any) => personName(m))
      .filter(Boolean)
    if (eq.id) equipeMembersById.set(eq.id, members.join(', '))
  }

  const formatPlanningIntervenant = (slot: any): string | null => {
    const member = personName(slot.member)
    if (member) return member
    const eq = slot.equipe as any
    if (eq) {
      const members = equipeMembersById.get(eq.id ?? slot.equipe_id)
      return members ? `équipe ${eq.name} (${members})` : `équipe ${eq.name}`
    }
    return slot.label ?? null
  }

  const pointageKeys = new Set((yesterdayPointages ?? []).map((p: any) => `${p.chantier_id}:${p.date}:${p.member_id ?? '*'}`))
  const missingPointages = (yesterdayPlanning ?? []).filter((slot: any) => {
    const directKey = `${slot.chantier_id}:${slot.planned_date}:${slot.member_id ?? '*'}`
    const genericKey = `${slot.chantier_id}:${slot.planned_date}:*`
    return !pointageKeys.has(directKey) && !pointageKeys.has(genericKey)
  }).slice(0, 6)

  const todayPointagePlanningIds = new Set((todayPointages ?? []).map((p: any) => p.chantier_planning_id).filter(Boolean))
  const todayPointageKeys = new Set((todayPointages ?? []).map((p: any) => `${p.chantier_id}:${p.date}:${p.member_id ?? p.user_id ?? '*'}`))
  const todayPointageDayKeys = new Set((todayPointages ?? []).map((p: any) => `${p.chantier_id}:${p.date}`))
  const todaySlotPointageStatus = (slot: any): string => {
    if (todayPointagePlanningIds.has(slot.id)) return 'statut : créneau déjà pointé'
    const directKey = `${slot.chantier_id}:${slot.planned_date}:${slot.member_id ?? '*'}`
    const genericKey = `${slot.chantier_id}:${slot.planned_date}:*`
    if (todayPointageKeys.has(directKey) || todayPointageKeys.has(genericKey)) return 'statut : créneau déjà pointé'
    const dayKey = `${slot.chantier_id}:${slot.planned_date}`
    if (todayPointageDayKeys.has(dayKey)) return 'statut : pointage enregistré sur ce chantier aujourd’hui'
    return 'statut : pas encore pointé'
  }

  const lines: string[] = [
    `Date du jour : ${today}`,
    params.userName ? `Utilisateur en ligne : ${params.userName}` : '',
    params.pageLabel ? `Espace ouvert : ${params.pageLabel}` : '',
    params.pathname ? `Chemin ouvert : ${params.pathname}` : '',
    `Entreprise : ${org?.name ?? businessCtx.orgName}`,
    [
      org?.address_line1,
      org?.address_line2,
      [org?.postal_code, org?.city].filter(Boolean).join(' '),
    ].filter(Boolean).join(', ') || '',
    org?.phone ? `Téléphone entreprise : ${org.phone}` : '',
    org?.email ? `Email entreprise : ${org.email}` : '',
    org?.website ? `Site web : ${org.website}` : '',
    `Paramètres usuels : TVA par défaut ${org?.default_vat_rate ?? '?'}%, délai paiement ${org?.payment_terms_days ?? '?'} jours, préfixe devis ${org?.quote_prefix ?? 'DEV'}, préfixe facture ${org?.invoice_prefix ?? 'FAC'}.`,
    org?.default_hourly_rate ? `Taux horaire par défaut : ${fmt(org.default_hourly_rate)}.` : '',
    org?.certifications?.length ? `Certifications : ${org.certifications.join(', ')}.` : '',
    shortText(org?.insurance_info, 240) ? `Assurance : ${shortText(org?.insurance_info, 240)}.` : '',
    '',
    formatBusinessContextForPrompt(businessCtx),
    '',
    ...buildActivityOperatingGuide(businessCtx),
  ]

  if (durableMemories?.length) {
    lines.push('', 'Mémoire durable Sarah (habitudes, process, préférences à respecter) :')
    for (const m of durableMemories) {
      lines.push(`  [${m.type ?? 'note'}] ${shortText(m.content, 220)}`)
    }
  }

  if (equipes?.length || individualMembers?.length) {
    lines.push('', 'Équipes et intervenants connus :')
    for (const e of equipes ?? []) {
      const eq = e as any
      const members = (eq.membres ?? []).map((m: any) => personName(m)).filter(Boolean).join(', ')
      lines.push(`  Équipe ${eq.name}${members ? ` : ${members}` : ''}${eq.description ? ` (${shortText(eq.description, 90)})` : ''}`)
    }
    for (const m of individualMembers ?? []) {
      lines.push(`  Intervenant individuel : ${personName(m) ?? m.name ?? '?'}`)
    }
  }

  if (todayPlanning?.length) {
    lines.push('', `Planning du jour (${today}) - tous les créneaux, même ceux déjà pointés :`)
    for (const slot of todayPlanning) {
      const c = slot.chantier as any
      const details = [
        todaySlotPointageStatus(slot),
        slotHours(slot.start_time, slot.end_time),
        formatPlanningIntervenant(slot) ? `qui : ${formatPlanningIntervenant(slot)}` : null,
        slot.team_size ? `${slot.team_size} pers.` : null,
        slot.notes ? `note : ${shortText(slot.notes, 110)}` : null,
      ].filter(Boolean).join(', ')
      lines.push(`  ${details ? `${details} - ` : ''}chantier "${c?.title ?? '?'}" (${clientName(c?.client)})${slot.label ? ` - ${slot.label}` : ''}`)
    }
  } else {
    lines.push('', `Planning du jour (${today}) : aucune intervention planifiée.`)
  }

  if (todayPointages?.length || todayCompletedTasks?.length || todayNotes?.length || todayPhotos?.length) {
    lines.push('', `Réalisé aujourd'hui (${today}) :`)

    if (todayPointages?.length) {
      lines.push('  Pointages enregistrés :')
      for (const p of todayPointages) {
        const chantier = (p as any).chantier
        const memberName = [(p as any).membre?.prenom, (p as any).membre?.name].filter(Boolean).join(' ').trim()
        const person = (p as any).profile?.full_name ?? (memberName || 'Intervenant non renseigné')
        const detail = [
          p.start_time ? `début ${String(p.start_time).slice(0, 5)}` : null,
          `${p.hours ?? '?'}h`,
          (p as any).tache?.title ? `tâche "${(p as any).tache.title}"` : null,
          p.description ? shortText(p.description, 120) : null,
        ].filter(Boolean).join(', ')
        lines.push(`    ${person} - chantier "${chantier?.title ?? '?'}" (${clientName(chantier?.client)}) - ${detail}${(p as any).chantier_planning_id ? ` - lié au créneau ${((p as any).chantier_planning_id as string).slice(0, 8)}` : ''}`)
      }
    }

    if (todayCompletedTasks?.length) {
      lines.push('  Tâches terminées :')
      for (const log of todayCompletedTasks) {
        const meta = (log.metadata ?? {}) as Record<string, unknown>
        lines.push(`    ${meta.actor_name ?? 'Quelqu\'un'} a terminé "${meta.task_title ?? 'tâche'}"${meta.chantier_title ? ` sur "${meta.chantier_title}"` : ''}.`)
      }
    }

    if (todayNotes?.length) {
      lines.push('  Notes chantier ajoutées :')
      for (const note of todayNotes) {
        const chantier = (note as any).chantier
        const author = (note as any).author?.full_name ?? 'Auteur non renseigné'
        lines.push(`    ${author} - "${chantier?.title ?? '?'}" : ${shortText(note.content, 140)}`)
      }
    }

    if (todayPhotos?.length) {
      lines.push('  Photos/preuves ajoutées :')
      for (const photo of todayPhotos) {
        const chantier = (photo as any).chantier
        const uploader = (photo as any).uploader?.full_name ?? 'Auteur non renseigné'
        const label = shortText(photo.title ?? photo.caption ?? (photo as any).tache?.title ?? 'photo ajoutée', 120)
        lines.push(`    ${uploader} - "${chantier?.title ?? '?'}" : ${label}`)
      }
    }
  } else {
    lines.push('', `Réalisé aujourd'hui (${today}) : aucun pointage, tâche terminée, note ou photo enregistré dans Atelier à l'ouverture de cette session.`)
  }

  if (weekPlanning?.length) {
    lines.push('', 'Planning des 7 prochains jours :')
    for (const slot of weekPlanning) {
      const c = slot.chantier as any
      const details = [
        slot.planned_date,
        slotHours(slot.start_time, slot.end_time),
        formatPlanningIntervenant(slot),
      ].filter(Boolean).join(', ')
      lines.push(`  ${details} - chantier "${c?.title ?? '?'}" (${clientName(c?.client)})${slot.label ? ` - ${slot.label}` : ''}`)
    }
  }

  if (activeChantiers?.length) {
    lines.push('', 'Chantiers actifs à connaître :')
    for (const c of activeChantiers) {
      const client = clientName((c as any).client)
      const deadline = c.end_date ?? c.estimated_end_date ?? 'non définie'
      const recurrence = c.recurrence && c.recurrence !== 'none'
        ? `, récurrence ${c.recurrence}${c.recurrence_times ? ` ${c.recurrence_times}x` : ''}${c.recurrence_team_size ? `, équipe ${c.recurrence_team_size}` : ''}`
        : ''
      lines.push(`  "${c.title}" (${client}) - statut ${c.status}, fin prévue ${deadline}, budget ${fmt(c.budget_ht)}${recurrence}${c.description ? `, note : ${shortText(c.description, 140)}` : ''}`)
    }
  }

  if (lateTasks?.length || upcomingTasks?.length) {
    lines.push('', 'Tâches chantier à surveiller :')
    for (const t of lateTasks ?? []) {
      const c = t.chantier as any
      lines.push(`  EN RETARD - ${t.due_date} - "${t.title}" sur "${c?.title ?? '?'}"`)
    }
    for (const t of upcomingTasks ?? []) {
      const c = t.chantier as any
      lines.push(`  À venir - ${t.due_date} - "${t.title}" sur "${c?.title ?? '?'}"`)
    }
  }

  if (missingPointages.length) {
    lines.push('', `Pointages probablement manquants hier (${yesterday}) :`)
    for (const slot of missingPointages) {
      const c = (slot as any).chantier
      lines.push(`  "${c?.title ?? '?'}" - créneau planifié non pointé.`)
    }
  }

  if (invoicesToFollow?.length) {
    lines.push('', 'Factures à suivre ou relancer :')
    for (const inv of invoicesToFollow) {
      const remaining = Number(inv.total_ttc ?? 0) - Number(inv.total_paid ?? 0)
      const due = inv.due_date && inv.due_date < today ? `EN RETARD depuis ${inv.due_date}` : `échéance ${inv.due_date ?? 'non définie'}`
      lines.push(`  ${inv.number ?? inv.title ?? inv.id} - ${clientName((inv as any).client)} - ${fmt(remaining || inv.total_ttc)} restant - ${due} - statut ${inv.status}`)
    }
  }

  if (recentInvoices?.length) {
    lines.push('', 'Dernières factures :')
    for (const inv of recentInvoices) {
      lines.push(`  ${inv.number ?? inv.title ?? inv.id} - ${clientName((inv as any).client)} - ${inv.status} - ${fmt(inv.total_ttc)} - échéance ${inv.due_date ?? 'n/a'}`)
    }
  }

  if (pendingQuotes?.length) {
    lines.push('', 'Devis envoyés/en attente :')
    for (const q of pendingQuotes) {
      const stale = q.sent_at && q.sent_at < followUpCutoff ? 'à relancer' : 'en attente'
      const expiring = q.valid_until && q.valid_until >= today && q.valid_until <= in3days ? `, expire bientôt le ${q.valid_until}` : ''
      lines.push(`  ${q.number ?? q.title ?? q.id} - ${clientName((q as any).client)} - ${fmt(q.total_ttc)} - ${stale}${expiring}`)
    }
  }

  if (recentQuotes?.length) {
    lines.push('', 'Devis récents :')
    for (const q of recentQuotes) {
      lines.push(`  ${q.number ?? q.title ?? q.id} - ${clientName((q as any).client)} - ${q.status} - ${fmt(q.total_ttc)}${q.valid_until ? ` - validité ${q.valid_until}` : ''}`)
    }
  }

  if (quoteRequests?.length) {
    lines.push('', 'Nouvelles demandes entrantes :')
    for (const r of quoteRequests) {
      const who = r.company_name ?? r.name ?? '?'
      lines.push(`  ${who} - ${shortText(r.subject ?? r.description, 140) ?? 'demande sans sujet'}`)
    }
  }

  const clientMap = new Map<string, any>()
  for (const c of keyClients ?? []) clientMap.set(c.id, c)
  for (const c of recentClients ?? []) clientMap.set(c.id, c)
  const clients = [...clientMap.values()].slice(0, 14)
  if (clients.length) {
    lines.push('', 'Clients à connaître (importants ou récents) :')
    for (const cl of clients) {
      const notes = shortText(cl.internal_notes ?? cl.notes, 120)
      const email = cl.email ? `, email ${cl.email}` : ''
      lines.push(`  [CLIENT:${cl.id}] ${clientName(cl)}${cl.city ? ` (${cl.city})` : ''} - statut ${cl.status ?? 'n/a'}, délai paiement ${cl.payment_terms_days ?? org?.payment_terms_days ?? '?'}j${email}, CA ${fmt(cl.total_revenue)}${notes ? `, note : ${notes}` : ''}`)
    }
    lines.push('  Pour un email vocal, utiliser create_sarah_action avec type "draft_email", payload { client_ids: ["id"], subject, body } ou recipient_filter par statut. Ne pas inventer de destinataire.')
  }

  const brief = dailyBriefRows?.[0]?.content
  if (brief) {
    lines.push('', `Brief du jour :\n${brief}`)
  }

  lines.push(
    '',
    'Mode opératoire Sarah vocal :',
    '  Répondre en conversation orale rapide, avec des phrases courtes.',
    '  Si tu dois chercher dans le contexte, dis immédiatement une micro-phrase naturelle puis réponds : "Je regarde ça", "Je vérifie côté factures", "Je regarde le planning".',
    '  Prioriser : planning du jour, retards, factures à relancer, devis à suivre, pointages manquants, demandes entrantes.',
    '  Si une information manque, le dire clairement et proposer où la vérifier.',
    '  Ne jamais inventer un montant, un client, une échéance, un intervenant ou une action.',
    '  Si l’utilisateur demande de préparer une action, utiliser le client tool create_sarah_action quand il est disponible. Ne jamais dire que l’action est exécutée : dire qu’une carte attend validation dans Sarah.',
    '  Payloads conseillés pour create_sarah_action : brief_chloe vers /finances/quote-editor, invoice_reminder vers /finances, draft_email vers /clients, open_url vers l’écran utile, task_complete avec tache_id seulement si la tâche est clairement identifiée.',
  )

  const context = lines.filter(Boolean).join('\n')
  if (context.length <= VOICE_CONTEXT_MAX_CHARS) return context
  return `${context.slice(0, VOICE_CONTEXT_MAX_CHARS)}\n\nContexte tronqué pour garder la conversation rapide. Si une information manque, demandez une précision ou proposez d'ouvrir l'écran concerné.`
}

export async function GET(req: NextRequest) {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY
    const agentId = process.env.ELEVENLABS_AGENT_ID

    if (!apiKey || !agentId) {
      console.error('[elevenlabs/signed-url] ELEVENLABS_API_KEY ou ELEVENLABS_AGENT_ID manquant')
      return NextResponse.json({ error: 'server_error', code: 'server_error' }, { status: 500 })
    }

    const orgId = await getCurrentOrganizationId()
    if (!orgId) {
      return NextResponse.json({ error: 'Non connecté.', code: 'unauthenticated' }, { status: 401 })
    }

    const aiAllowed = await hasPermission('ai.sarah')
    if (!aiAllowed) {
      return NextResponse.json({ error: 'permission_denied', code: 'permission_denied' }, { status: 403 })
    }

    const voiceLiveEnabled = await isModuleEnabled('voice_live', orgId)
    if (!voiceLiveEnabled) {
      return NextResponse.json({ error: 'module_disabled', code: 'module_disabled' }, { status: 403 })
    }

    const supabase = await createClient()
    const quotaCheck = await checkQuota({
      supabase,
      organizationId: orgId,
      technicalFeature: 'voice_live',
      quantity: 1,
    })

    if (!quotaCheck.allowed) {
      return NextResponse.json({
        error: 'quota_exceeded',
        code: 'quota_exceeded',
        quotaMonthly: quotaCheck.quotaMonthly,
        usedQuantity: quotaCheck.usedQuantity,
        remaining: quotaCheck.remaining,
      }, { status: 402 })
    }

    const requestedUserName = req.nextUrl.searchParams.get('userName')?.trim() || null
    const pageLabel = req.nextUrl.searchParams.get('page')?.trim() || null
    const pathname = req.nextUrl.searchParams.get('pathname')?.trim() || null

    const supabaseUser = await createClient()
    const { data: { user } } = await supabaseUser.auth.getUser()
    const { data: profile } = user?.id
      ? await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', user.id)
          .maybeSingle()
      : { data: null }
    const userName = requestedUserName ?? profile?.full_name ?? user?.email?.split('@')[0] ?? null

    const voiceContext = await buildVoiceContext(orgId, { pageLabel, pathname, userName })

    const systemPrompt = `Tu es Sarah, la secrétaire vocale d'Atelier. Tu travailles aux côtés d'un artisan, d'un dirigeant ou d'un responsable d'exploitation.

Ton rôle en mode vocal : être une vraie assistante d'entreprise. Tu aides à piloter l'activité, répondre sur les clients, les devis, les factures, les chantiers, les équipes, le planning, les urgences et les habitudes internes.

Ton ton :
- Chaleureux, humain, professionnel. Phrases courtes, naturelles, adaptées à l'oral.
- Jamais de tirets, de listes à puces, de markdown. Tu parles, tu n'écris pas.
- Tu vouvoies l'utilisateur, et tu peux l'appeler par son prénom si le contexte indique son nom.
- Réponses concises : 1 à 3 phrases max pour une question simple.
- Si l'utilisateur demande un état complet, tu peux faire un résumé oral structuré en quelques phrases courtes.
- Ne dis pas "dans votre application Atelier". Dis plutôt "dans votre espace", "sur votre tableau de bord", "dans l'espace Planning", "sur cette fiche chantier", ou simplement "je regarde vos données".

Ta manière de travailler :
- Tu exploites le contexte Atelier ci-dessous comme ton dossier de travail du jour.
- Tu commences par les informations les plus opérationnelles : aujourd'hui, urgences, retards, relances, qui fait quoi, puis le reste.
- Tu relies les sujets entre eux quand c'est utile : un client peut avoir un chantier actif, un devis en attente, une facture à relancer ou une intervention prévue.
- Tu gardes en tête les rouages métier indiqués selon l'activité de l'entreprise.
- Si une réponse demande de consulter plusieurs blocs du contexte, commence tout de suite par une micro-phrase comme "Je regarde ça", "Je vérifie côté factures", ou "Je regarde le planning", puis réponds dès que tu as l'information. Évite les blancs longs.
- Quand tu n'as pas l'information exacte en contexte, ne cherche pas à meubler. Dis-le en une phrase et propose l'écran exact à ouvrir.
- Pour "ce qui a été fait aujourd'hui", utilise d'abord le bloc "Réalisé aujourd'hui", puis complète avec le planning du jour seulement si nécessaire. Ne conclus jamais qu'il ne s'est rien passé si des pointages, tâches terminées, notes ou photos existent dans ce bloc.

Actions vocales :
- Si l'utilisateur demande "prépare", "ouvre", "envoie à Chloé", "fais une relance", "crée une carte", tu peux préparer une carte d'action avec le client tool create_sarah_action si disponible.
- La carte doit rester à valider dans Sarah. Ne prétends jamais avoir envoyé, supprimé, facturé, modifié un montant ou terminé une tâche sans validation.
- Pour un devis, crée une carte de type "brief_chloe" avec description, client_name/client_id si connus, conditions et items si disponibles, deepLink "/finances/quote-editor".
- Pour une facture ou une relance, crée une carte "invoice_reminder" ou "open_invoice_editor" avec invoice_id si connu, deepLink "/finances" ou "/finances/invoice-editor/[id]".
- Pour un email client/prospect, crée une carte "draft_email" avec payload { client_ids, subject, body } ou { recipient_filter: { mode: "by_status", statuses: [...] }, subject, body }. La validation humaine enverra l'email. Ne jamais inventer d'adresse.
- Pour une navigation simple, crée "open_url" avec payload { url, label }.

Ce que tu ne fais PAS en mode vocal :
- Aucune action destructrice ou modification directe de données.
- Ne pas inventer de données. Si tu ne sais pas, dis-le simplement.
- Pas de confirmation vocale d'actions sensibles : la validation se fait dans la carte Sarah.

---
CONTEXTE ATELIER (mis à jour à l'ouverture de la session) :
${voiceContext}`

    const elevenLabsUrl = `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${encodeURIComponent(agentId)}`

    const elevenResp = await fetch(elevenLabsUrl, {
      method: 'GET',
      headers: {
        'xi-api-key': apiKey,
      },
    })

    if (!elevenResp.ok) {
      const body = await elevenResp.text().catch(() => '')
      console.error('[elevenlabs/signed-url] ElevenLabs error', elevenResp.status, body)
      const code = elevenResp.status === 401 || elevenResp.status === 403
        ? 'elevenlabs_configuration'
        : 'server_error'
      return NextResponse.json({ error: code, code }, { status: elevenResp.status === 401 || elevenResp.status === 403 ? 502 : 500 })
    }

    const { signed_url } = await elevenResp.json() as { signed_url: string }

    // Enregistrer l'ouverture de session (1 unité = début de session, les minutes sont comptées à session-end)
    const admin = createAdminClient()

    void admin.from('usage_logs').insert({
      organization_id: orgId,
      provider: 'elevenlabs',
      feature: 'voice_live',
      model: 'elevenlabs_convai',
      input_kind: 'audio',
      status: 'success',
      quota_feature: 'voice_live_minutes',
      quota_unit: 'minute',
      quota_quantity: 0,
      over_quota: false,
      overflow_mode: quotaCheck.overflowMode,
      metadata: {
        event: 'session_start',
        user_id: user?.id ?? null,
        remaining_before: quotaCheck.remaining,
      },
    })

    return NextResponse.json({
      signed_url,
      system_prompt: systemPrompt,
      remaining_minutes: quotaCheck.remaining,
    })
  } catch (err) {
    console.error('[elevenlabs/signed-url]', err)
    return NextResponse.json({ error: 'server_error', code: 'server_error' }, { status: 500 })
  }
}
