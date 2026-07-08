'use server'

import React from 'react'
import { revalidatePath } from 'next/cache'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { canManageLaborRates, hasPermission } from '@/lib/data/queries/membership'
import { sendEmail } from '@/lib/email'
import { sendPushToOrgPermission } from '@/lib/push'
import {
  buildMemberSpaceInviteEmail,
  buildMemberSpaceInviteReminderEmail,
  buildMemberMonthlyReportEmail,
} from '@/lib/email/templates'
import { generateMagicToken, hashToken, getMemberSession, clearMemberSessionCookie } from '@/lib/auth/member-session'
import { getMemberPointages, getMemberByIdAdmin, getMemberAccessibleChantiers } from '@/lib/data/queries/members'
import MemberHoursReportPDF from '@/components/pdf/MemberHoursReportPDF'

type Result = { error: string | null }

function hoursBetweenTimes(startTime?: string | null, endTime?: string | null): number | null {
  if (!startTime || !endTime) return null
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  if ([sh, sm, eh, em].some(n => Number.isNaN(n))) return null
  const hours = (eh + em / 60) - (sh + sm / 60)
  return hours > 0 ? Math.round(hours * 10) / 10 : null
}

// ─── 1. Créer un membre individuel ────────────────────────────────────────────

export async function createIndividualMember(input: {
  prenom?: string | null
  name: string
  email?: string | null
  roleLabel?: string | null
  tauxHoraire?: number | null
  equipeId?: string | null              // si fourni, le membre est rattaché à cette équipe
  linkToProfileId?: string | null       // si membre existant de l'org → profile lié
  attachToChantierId?: string | null    // si fourni et pas d'équipe, attacher directement au chantier
  sendInvite?: boolean
}): Promise<Result & { id?: string }> {
  if (!(await hasPermission('chantiers.manage_team'))) return { error: 'Permission refusée.' }
  if (input.tauxHoraire !== undefined && input.tauxHoraire !== null && !(await canManageLaborRates())) {
    return { error: 'Action réservée aux administrateurs.' }
  }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }
  if (input.attachToChantierId) {
    const { data: chantier } = await supabase
      .from('chantiers')
      .select('id')
      .eq('id', input.attachToChantierId)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (!chantier) return { error: 'Chantier introuvable ou non autorisé.' }
  }
  if (input.equipeId) {
    const { data: equipe } = await supabase
      .from('chantier_equipes')
      .select('id')
      .eq('id', input.equipeId)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (!equipe) return { error: 'Équipe introuvable ou non autorisée.' }
  }
  if (input.linkToProfileId) {
    const { data: membership } = await supabase
      .from('memberships')
      .select('id')
      .eq('user_id', input.linkToProfileId)
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .maybeSingle()
    if (!membership) return { error: 'Compte utilisateur introuvable ou non autorisé.' }
  }

  const trimmedName = input.name.trim()
  if (!trimmedName) return { error: 'Le nom est requis.' }

  const email = input.email?.trim().toLowerCase() || null

  const { data: inserted, error } = await supabase
    .from('chantier_equipe_membres')
    .insert({
      organization_id: orgId,
      equipe_id: input.equipeId ?? null,
      prenom: input.prenom?.trim() || null,
      name: trimmedName,
      email,
      role_label: input.roleLabel?.trim() || null,
      taux_horaire: input.tauxHoraire ?? null,
      profile_id: input.linkToProfileId ?? null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createIndividualMember]', error)
    return { error: "Impossible de créer le membre. Veuillez réessayer." }
  }

  if (input.attachToChantierId && !input.equipeId) {
    await supabase
      .from('chantier_individual_members')
      .insert({ chantier_id: input.attachToChantierId, member_id: inserted.id })
  }

  if (input.sendInvite && email) {
    await sendMemberSpaceInviteUnchecked(inserted.id)
  }

  if (input.attachToChantierId) revalidatePath(`/chantiers/${input.attachToChantierId}`)
  revalidatePath('/chantiers')
  return { error: null, id: inserted.id }
}

export async function updateIndividualMember(
  memberId: string,
  patch: {
    prenom?: string | null
    name?: string
    email?: string | null
    roleLabel?: string | null
    tauxHoraire?: number | null
    equipeId?: string | null
    linkToProfileId?: string | null
  },
): Promise<Result> {
  if (!(await hasPermission('chantiers.manage_team'))) return { error: 'Permission refusée.' }
  if (patch.tauxHoraire !== undefined && !(await canManageLaborRates())) {
    return { error: 'Action réservée aux administrateurs.' }
  }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }
  if (patch.equipeId) {
    const { data: equipe } = await supabase
      .from('chantier_equipes')
      .select('id')
      .eq('id', patch.equipeId)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (!equipe) return { error: 'Équipe introuvable ou non autorisée.' }
  }
  if (patch.linkToProfileId) {
    const { data: membership } = await supabase
      .from('memberships')
      .select('id')
      .eq('user_id', patch.linkToProfileId)
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .maybeSingle()
    if (!membership) return { error: 'Compte utilisateur introuvable ou non autorisé.' }
  }

  const update: Record<string, unknown> = {}
  if (patch.prenom !== undefined)          update.prenom         = patch.prenom?.trim() || null
  if (patch.name !== undefined)            update.name           = patch.name.trim()
  if (patch.email !== undefined)           update.email          = patch.email?.trim().toLowerCase() || null
  if (patch.roleLabel !== undefined)       update.role_label     = patch.roleLabel?.trim() || null
  if (patch.tauxHoraire !== undefined)     update.taux_horaire   = patch.tauxHoraire
  if (patch.equipeId !== undefined)        update.equipe_id      = patch.equipeId
  if (patch.linkToProfileId !== undefined) update.profile_id     = patch.linkToProfileId

  const { error } = await supabase
    .from('chantier_equipe_membres')
    .update(update)
    .eq('id', memberId)
    .eq('organization_id', orgId)

  if (error) {
    console.error('[updateIndividualMember]', error)
    return { error: "Impossible de mettre à jour le membre." }
  }

  revalidatePath('/chantiers', 'layout')
  return { error: null }
}

export async function deleteIndividualMember(memberId: string): Promise<Result> {
  if (!(await hasPermission('chantiers.manage_team'))) return { error: 'Permission refusée.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const { error } = await supabase
    .from('chantier_equipe_membres')
    .delete()
    .eq('id', memberId)
    .eq('organization_id', orgId)

  if (error) {
    console.error('[deleteIndividualMember]', error)
    return { error: "Impossible de supprimer le membre." }
  }

  revalidatePath('/chantiers', 'layout')
  return { error: null }
}

// ─── 2. Liaison membre ↔ chantier ────────────────────────────────────────────

export async function attachMemberToChantier(memberId: string, chantierId: string): Promise<Result> {
  if (!(await hasPermission('chantiers.manage_team'))) return { error: 'Permission refusée.' }
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }
  const [{ data: chantier }, { data: member }] = await Promise.all([
    supabase.from('chantiers').select('id').eq('id', chantierId).eq('organization_id', orgId).maybeSingle(),
    supabase.from('chantier_equipe_membres').select('id').eq('id', memberId).eq('organization_id', orgId).maybeSingle(),
  ])
  if (!chantier) return { error: 'Chantier introuvable ou non autorisé.' }
  if (!member) return { error: 'Membre introuvable ou non autorisé.' }

  const { error } = await supabase
    .from('chantier_individual_members')
    .insert({ chantier_id: chantierId, member_id: memberId })

  if (error && !error.message.includes('duplicate')) {
    console.error('[attachMemberToChantier]', error)
    return { error: "Impossible d'ajouter ce membre au chantier." }
  }

  revalidatePath(`/chantiers/${chantierId}`)
  return { error: null }
}

export async function detachMemberFromChantier(memberId: string, chantierId: string): Promise<Result> {
  if (!(await hasPermission('chantiers.manage_team'))) return { error: 'Permission refusée.' }
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }
  const [{ data: chantier }, { data: member }] = await Promise.all([
    supabase.from('chantiers').select('id').eq('id', chantierId).eq('organization_id', orgId).maybeSingle(),
    supabase.from('chantier_equipe_membres').select('id').eq('id', memberId).eq('organization_id', orgId).maybeSingle(),
  ])
  if (!chantier) return { error: 'Chantier introuvable ou non autorisé.' }
  if (!member) return { error: 'Membre introuvable ou non autorisé.' }

  const { error } = await supabase
    .from('chantier_individual_members')
    .delete()
    .eq('member_id', memberId)
    .eq('chantier_id', chantierId)

  if (error) {
    console.error('[detachMemberFromChantier]', error)
    return { error: "Impossible de retirer ce membre du chantier." }
  }

  revalidatePath(`/chantiers/${chantierId}`)
  return { error: null }
}

// ─── 3. Magic link espace membre ─────────────────────────────────────────────

/** Demande publique d'accès : un membre saisit son email → on lui renvoie un lien. */
export async function requestMemberSpaceAccess(email: string): Promise<Result> {
  const cleanedEmail = email.trim().toLowerCase()
  if (!cleanedEmail) return { error: 'Email requis.' }

  const admin = createAdminClient()

  // Recherche du membre par email (toutes orgs confondues - un membre = une org en pratique)
  const { data: members } = await admin
    .from('chantier_equipe_membres')
    .select('id, organization_id')
    .ilike('email', cleanedEmail)
    .limit(2)

  // Réponse "succès" volontairement neutre pour ne pas révéler l'existence d'un email
  if (!members || members.length === 0) return { error: null }
  if (members.length > 1) {
    // Cas rare : même email partagé entre orgs, on traite la première
    console.warn('[requestMemberSpaceAccess] email partagé par plusieurs membres')
  }

  return await sendMemberSpaceInviteUnchecked(members[0].id)
}

/** Envoie le magic link à un membre donné (utilisé à la création + à la demande). */
export async function sendMemberSpaceInvite(memberId: string): Promise<Result> {
  if (!(await hasPermission('chantiers.manage_team'))) return { error: 'Permission refusée.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const { data: member } = await supabase
    .from('chantier_equipe_membres')
    .select('id')
    .eq('id', memberId)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (!member) return { error: 'Membre introuvable ou non autorisé.' }

  return sendMemberSpaceInviteUnchecked(memberId)
}

export async function sendMemberSpaceInviteUnchecked(memberId: string): Promise<Result> {
  const admin = createAdminClient()

  const { data: member } = await admin
    .from('chantier_equipe_membres')
    .select('id, prenom, email, organization_id, organizations:organizations!chantier_equipe_membres_organization_id_fkey(name)')
    .eq('id', memberId)
    .single()

  if (!member?.email) return { error: 'Aucun email associé à ce membre.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orgName: string = (member as any).organizations?.name ?? 'Votre organisation'

  const { raw, hash, expiresAt } = generateMagicToken()
  const { error: insertError } = await admin
    .from('member_space_tokens')
    .insert({ member_id: memberId, token_hash: hash, expires_at: expiresAt.toISOString() })

  if (insertError) {
    console.error('[sendMemberSpaceInvite] insert token', insertError)
    return { error: "Impossible de générer le lien d'accès." }
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const spaceUrl = `${baseUrl}/mon-espace?token=${encodeURIComponent(raw)}`

  const { subject, html } = buildMemberSpaceInviteEmail({
    orgName,
    memberFirstName: member.prenom ?? null,
    spaceUrl,
  })

  const { error: sendError } = await sendEmail({
    organizationId: member.organization_id,
    to: member.email,
    subject,
    html,
  })

  if (sendError) {
    console.error('[sendMemberSpaceInvite] sendEmail', sendError)
    return { error: sendError }
  }
  return { error: null }
}

/**
 * Envoie un rappel J-3 pour un token proche de l'expiration (utilisé par le cron).
 * Le raw token n'étant jamais stocké (seul son hash l'est), impossible de renvoyer
 * le même lien : on génère un nouveau token et on marque l'ancien comme rappelé.
 */
export async function sendMemberSpaceTokenReminder(oldTokenId: string, memberId: string): Promise<Result> {
  const admin = createAdminClient()

  const { data: member } = await admin
    .from('chantier_equipe_membres')
    .select('id, prenom, email, organization_id, organizations:organizations!chantier_equipe_membres_organization_id_fkey(name)')
    .eq('id', memberId)
    .single()

  if (!member?.email) {
    // Marquer quand même pour ne pas retraiter en boucle un membre sans email.
    await admin.from('member_space_tokens').update({ reminder_sent_at: new Date().toISOString() }).eq('id', oldTokenId)
    return { error: 'Aucun email associé à ce membre.' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orgName: string = (member as any).organizations?.name ?? 'Votre organisation'

  const { raw, hash, expiresAt } = generateMagicToken()
  const { error: insertError } = await admin
    .from('member_space_tokens')
    .insert({ member_id: memberId, token_hash: hash, expires_at: expiresAt.toISOString() })

  if (insertError) {
    console.error('[sendMemberSpaceTokenReminder] insert token', insertError)
    return { error: "Impossible de générer le lien de rappel." }
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const spaceUrl = `${baseUrl}/mon-espace?token=${encodeURIComponent(raw)}`

  const { subject, html } = buildMemberSpaceInviteReminderEmail({
    orgName,
    memberFirstName: member.prenom ?? null,
    spaceUrl,
  })

  const { error: sendError } = await sendEmail({
    organizationId: member.organization_id,
    to: member.email,
    subject,
    html,
  })

  // Marqué que l'envoi ait réussi ou non — évite de retraiter en boucle un cas
  // d'erreur transitoire (ex: adresse invalide) à chaque exécution du cron.
  await admin
    .from('member_space_tokens')
    .update({ reminder_sent_at: new Date().toISOString() })
    .eq('id', oldTokenId)

  if (sendError) {
    console.error('[sendMemberSpaceTokenReminder] sendEmail', sendError)
    return { error: sendError }
  }
  return { error: null }
}

export type VerifyMemberTokenResult =
  | { status: 'not_found' }
  | { status: 'expired'; memberId: string; organizationId: string }
  | { status: 'ok'; memberId: string; organizationId: string }

/** Vérifie un magic-link et retourne son statut (sans poser de cookie). */
export async function verifyMemberToken(rawToken: string): Promise<VerifyMemberTokenResult> {
  if (!rawToken) return { status: 'not_found' }
  const admin = createAdminClient()
  const tokenHash = hashToken(rawToken)

  const { data: token } = await admin
    .from('member_space_tokens')
    .select('id, member_id, expires_at, last_used_at, member:chantier_equipe_membres!inner(organization_id)')
    .eq('token_hash', tokenHash)
    .single()

  if (!token) return { status: 'not_found' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const organizationId = (token as any).member?.organization_id as string | undefined
  if (!organizationId) return { status: 'not_found' }

  // Token à usage unique : déjà consommé = même réponse qu'un token introuvable
  // (ne pas révéler à un attaquant qui aurait intercepté un lien déjà cliqué par
  // le membre légitime qu'il a "presque" fonctionné).
  if (token.last_used_at) return { status: 'not_found' }

  if (new Date(token.expires_at).getTime() < Date.now()) {
    return { status: 'expired', memberId: token.member_id, organizationId }
  }

  // Consommation atomique : si un autre appel concurrent a consommé ce token
  // entre le SELECT et ici, cette UPDATE ne touche 0 ligne (garde
  // .is('last_used_at', null)) et la session n'est pas ouverte deux fois.
  const { data: consumed } = await admin
    .from('member_space_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', token.id)
    .is('last_used_at', null)
    .select('id')
    .maybeSingle()

  if (!consumed) return { status: 'not_found' }

  return { status: 'ok', memberId: token.member_id, organizationId }
}

// ─── 4. Pointage depuis l'espace membre ──────────────────────────────────────

export async function createPointageAsMember(input: {
  memberId: string
  organizationId: string
  chantierId?: string
  date?: string                 // YYYY-MM-DD
  hours?: number
  startTime?: string | null    // HH:MM
  description?: string | null
  tacheId?: string | null
  planningId?: string | null
  maintenanceInterventionId?: string | null
}): Promise<Result & { id?: string }> {
  if (!input.memberId) {
    console.error('[createPointageAsMember] memberId manquant ou vide:', JSON.stringify({ memberId: input.memberId, organizationId: input.organizationId }))
    return { error: 'Session invalide : identifiant membre manquant. Reconnectez-vous via votre lien.' }
  }

  const admin = createAdminClient()

  const { data: member } = await admin
    .from('chantier_equipe_membres')
    .select('id, organization_id, equipe_id, profile_id, taux_horaire, prenom, name')
    .eq('id', input.memberId)
    .eq('organization_id', input.organizationId)
    .maybeSingle()

  if (!member) return { error: 'Membre introuvable.' }

  let chantierId = input.chantierId ?? null
  let date = input.date ?? null
  let hours = input.hours ?? null
  let startTime = input.startTime ?? null
  let description = input.description ?? null
  let planningId = input.planningId ?? null
  let maintenanceInterventionId = input.maintenanceInterventionId ?? null

  if (planningId) {
    const { data: planning } = await admin
      .from('chantier_plannings')
      .select('id, chantier_id, planned_date, start_time, end_time, duration_min, label, member_id, equipe_id, chantier:chantiers!inner(id, title, organization_id)')
      .eq('id', planningId)
      .maybeSingle()

    if (!planning || (planning as any).chantier?.organization_id !== input.organizationId) {
      return { error: 'Créneau introuvable.' }
    }
    if (planning.member_id !== input.memberId && (!member.equipe_id || planning.equipe_id !== member.equipe_id)) {
      return { error: "Ce créneau ne vous est pas affecté." }
    }

    const pointageOwnerFilter = member.profile_id ? `member_id.eq.${input.memberId},user_id.eq.${member.profile_id}` : `member_id.eq.${input.memberId}`
    const { data: existing } = await admin
      .from('chantier_pointages')
      .select('id')
      .eq('chantier_planning_id', planningId)
      .or(pointageOwnerFilter)
      .maybeSingle()
    if (existing?.id) return { error: 'Ce créneau a déjà été pointé.' }

    chantierId = planning.chantier_id
    date = planning.planned_date
    startTime = planning.start_time ?? null
    hours = hours ?? (planning.duration_min ? Math.round((Number(planning.duration_min) / 60) * 10) / 10 : hoursBetweenTimes(planning.start_time, planning.end_time))
    description = description ?? `Créneau planifié - ${planning.label}`
  }

  if (maintenanceInterventionId) {
    const { data: intervention } = await admin
      .from('maintenance_interventions')
      .select(`
        id, organization_id, date_intervention, start_time, end_time, duration_hours,
        intervenant_member_id, intervenant_id, intervenant_user_id, chantier_pointage_id,
        contract:maintenance_contracts!inner(title, chantier_id)
      `)
      .eq('id', maintenanceInterventionId)
      .eq('organization_id', input.organizationId)
      .maybeSingle()

    if (!intervention) return { error: 'Intervention introuvable.' }
    if (
      (intervention as any).intervenant_member_id !== input.memberId
      && (intervention as any).intervenant_id !== input.memberId
      && (!member.profile_id || (intervention as any).intervenant_user_id !== member.profile_id)
    ) {
      return { error: "Cette intervention ne vous est pas affectée." }
    }

    const pointageOwnerFilter = member.profile_id ? `member_id.eq.${input.memberId},user_id.eq.${member.profile_id}` : `member_id.eq.${input.memberId}`
    const { data: existing } = await admin
      .from('chantier_pointages')
      .select('id')
      .eq('maintenance_intervention_id', maintenanceInterventionId)
      .or(pointageOwnerFilter)
      .maybeSingle()
    if (existing?.id || (intervention as any).chantier_pointage_id) return { error: 'Cette intervention a déjà été pointée.' }

    const contract = Array.isArray((intervention as any).contract) ? (intervention as any).contract[0] : (intervention as any).contract
    chantierId = contract?.chantier_id ?? null
    date = (intervention as any).date_intervention
    startTime = (intervention as any).start_time ?? null
    hours = hours
      ?? ((intervention as any).duration_hours ? Math.round(Number((intervention as any).duration_hours) * 10) / 10 : null)
      ?? hoursBetweenTimes((intervention as any).start_time, (intervention as any).end_time)
    description = description ?? `Intervention entretien - ${contract?.title ?? 'Entretien'}`
  }

  if (!chantierId) return { error: 'Chantier introuvable.' }
  if (!date) return { error: 'Date de pointage manquante.' }
  if (!hours || hours <= 0 || hours > 24) return { error: 'Nombre d\'heures invalide.' }

  // Vérifier que le chantier appartient bien à la même org que le membre
  const { data: chantier } = await admin
    .from('chantiers')
    .select('id, organization_id, title')
    .eq('id', chantierId)
    .single()

  if (!chantier || chantier.organization_id !== input.organizationId) {
    return { error: 'Chantier introuvable.' }
  }

  const allowedChantiers = await getMemberAccessibleChantiers(input.memberId, input.organizationId)
  if (!allowedChantiers.some(c => c.id === chantierId)) {
    return { error: "Ce chantier n'est pas affecté à votre espace." }
  }

  // Résoudre le taux horaire au moment de la saisie
  const [orgRes, membreRes] = await Promise.all([
    admin
      .from('organizations')
      .select('default_labor_cost_per_hour, default_hourly_rate')
      .eq('id', input.organizationId)
      .single(),
    admin
      .from('chantier_equipe_membres')
      .select('taux_horaire, name')
      .eq('id', input.memberId)
      .single(),
  ])
  const orgFallback: number | null =
    orgRes.data?.default_labor_cost_per_hour
    ?? (orgRes.data?.default_hourly_rate ? orgRes.data.default_hourly_rate * 0.5 : null)
  const rateSnapshot: number | null =
    (membreRes.data?.taux_horaire != null ? membreRes.data.taux_horaire : null)
    ?? orgFallback

  const { data: inserted, error } = await admin
    .from('chantier_pointages')
    .insert({
      chantier_id:   chantierId,
      tache_id:      input.tacheId ?? null,
      member_id:     input.memberId || null,
      user_id:       null,
      date,
      hours,
      start_time:    startTime,
      description,
      rate_snapshot: rateSnapshot,
      chantier_planning_id: planningId,
      maintenance_intervention_id: maintenanceInterventionId,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createPointageAsMember]', error)
    return { error: "Impossible d'enregistrer le pointage." }
  }

  if (maintenanceInterventionId) {
    await admin
      .from('maintenance_interventions')
      .update({ chantier_pointage_id: inserted.id, statut: 'réalisée' })
      .eq('id', maintenanceInterventionId)
      .eq('organization_id', input.organizationId)
  }

  await sendPushToOrgPermission(
    input.organizationId,
    'chantiers.manage_pointages',
    {
      title: maintenanceInterventionId ? 'Intervention réalisée' : 'Pointage enregistré',
      body: `${member.prenom ?? member.name ?? 'Un membre'} a pointé ${hours}h`,
      url: `/chantiers/${chantierId}`,
    },
    member.profile_id ?? null,
  )

  revalidatePath('/mon-espace/dashboard')
  revalidatePath(`/chantiers/${chantierId}`)
  return { error: null, id: inserted.id }
}

// ─── 5. Rapport heures par mail ──────────────────────────────────────────────

/** Génère un PDF des heures du membre sur la période et l'envoie à son email. */
export async function sendMemberHoursReport(
  memberId: string,
  dateFrom: string,
  dateTo: string,
  opts?: { useAdmin?: boolean },
): Promise<Result & { recipient?: string }> {
  // Si appelé depuis cron / espace membre, useAdmin=true (pas de session app)
  // Sinon (admin app), on vérifie la permission classique
  if (!opts?.useAdmin) {
    if (!(await hasPermission('chantiers.expenses.view'))) {
      // Réutilise une permission existante du domaine chantier - à adapter si besoin
      return { error: 'Permission refusée.' }
    }
  }

  const admin = createAdminClient()
  const member = await getMemberByIdAdmin(memberId)
  if (!member) return { error: 'Membre introuvable.' }
  if (!member.email) return { error: "Ce membre n'a pas d'adresse email." }

  const { data: org } = await admin
    .from('organizations')
    .select('name, email, logo_url, address_line1, postal_code, city')
    .eq('id', member.organization_id)
    .single()

  if (!org) return { error: 'Organisation introuvable.' }

  const pointages = await getMemberPointages(memberId, { dateFrom, dateTo, useAdmin: true })

  const totalHours = pointages.reduce((s, p) => s + p.hours, 0)
  const periodLabel = formatPeriodLabel(dateFrom, dateTo)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfBuffer = await renderToBuffer(React.createElement(MemberHoursReportPDF as any, {
    member,
    organization: org,
    pointages,
    periodFrom: dateFrom,
    periodTo: dateTo,
    totalHours,
  }) as any)

  const fileName = `rapport-heures-${(member.prenom ?? '').toLowerCase()}-${member.name.toLowerCase()}-${dateFrom}-${dateTo}.pdf`
    .replace(/[^a-z0-9.-]/gi, '-')

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const spaceUrl = baseUrl ? `${baseUrl}/mon-espace/request-access` : null

  const { subject, html } = buildMemberMonthlyReportEmail({
    orgName: org.name,
    orgEmail: (org as any).email ?? null,
    memberFirstName: member.prenom ?? null,
    periodLabel,
    totalHours,
    spaceUrl,
  })

  const { error } = await sendEmail({
    organizationId: member.organization_id,
    to: member.email,
    subject,
    html,
    attachments: [{ filename: fileName, content: pdfBuffer }],
  })

  if (error) return { error }
  return { error: null, recipient: member.email }
}

// ─── 6. Actions appelées depuis /mon-espace (session membre, pas Supabase Auth) ─────

/** Pointage par le membre depuis son espace. Utilise la session cookie. */
export async function pointMyHoursFromSpace(input: {
  chantierId?: string
  date?: string
  hours?: number
  startTime?: string | null
  description?: string | null
  tacheId?: string | null
  planningId?: string | null
  maintenanceInterventionId?: string | null
}): Promise<Result & { id?: string }> {
  const session = await getMemberSession()
  if (!session) return { error: 'Session expirée. Reconnectez-vous via votre lien.' }
  if (!session.memberId) {
    console.error('[pointMyHoursFromSpace] session sans memberId:', JSON.stringify({ organizationId: session.organizationId }))
    return { error: 'Session invalide. Reconnectez-vous via votre lien.' }
  }

  return await createPointageAsMember({
    memberId: session.memberId,
    organizationId: session.organizationId,
    chantierId: input.chantierId,
    date: input.date,
    hours: input.hours,
    startTime: input.startTime ?? null,
    description: input.description ?? null,
    tacheId: input.tacheId ?? null,
    planningId: input.planningId ?? null,
    maintenanceInterventionId: input.maintenanceInterventionId ?? null,
  })
}

/**
 * Persiste l'heure d'arrivée sur site pour un créneau planifié, depuis l'espace membre.
 * Symétrique de setPlanningArrivedAt (planning.ts) mais pour la session HMAC /mon-espace
 * (hasPermission() suppose un compte app, inutilisable ici — vérif via appartenance
 * du créneau au membre, même filtre que createPointageAsMember).
 * Envoie un push aux managers pour les informer de l'arrivée en temps réel.
 */
export async function setPlanningArrivedAtFromSpace(planningId: string): Promise<Result> {
  const session = await getMemberSession()
  if (!session) return { error: 'Session expirée. Reconnectez-vous via votre lien.' }
  if (!session.memberId) return { error: 'Session invalide. Reconnectez-vous via votre lien.' }

  // Créneaux d'entretien préfixés "maintenance:" côté UI : pas de colonne arrived_at
  // sur maintenance_interventions -> no-op silencieux.
  if (planningId.startsWith('maintenance:')) return { error: null }

  const admin = createAdminClient()

  const { data: member } = await admin
    .from('chantier_equipe_membres')
    .select('id, equipe_id, prenom, name')
    .eq('id', session.memberId)
    .eq('organization_id', session.organizationId)
    .maybeSingle()
  if (!member) return { error: 'Membre introuvable.' }

  const { data: planning } = await admin
    .from('chantier_plannings')
    .select('id, chantier_id, member_id, equipe_id, chantier:chantiers!inner(id, title, organization_id)')
    .eq('id', planningId)
    .maybeSingle()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chantierInfo = (planning as any)?.chantier
  if (!planning || chantierInfo?.organization_id !== session.organizationId) {
    return { error: 'Créneau introuvable ou non autorisé.' }
  }
  if (planning.member_id !== session.memberId && (!member.equipe_id || planning.equipe_id !== member.equipe_id)) {
    return { error: "Ce créneau ne vous est pas affecté." }
  }

  const { error } = await admin
    .from('chantier_plannings')
    .update({ arrived_at: new Date().toISOString() })
    .eq('id', planningId)

  if (error) return { error: error.message }

  const chantierTitle = chantierInfo?.title ?? 'Chantier'
  await sendPushToOrgPermission(
    session.organizationId,
    'chantiers.manage_pointages',
    {
      title: 'Arrivée sur site',
      body: `${member.prenom ?? member.name ?? 'Un membre'} est arrivé sur ${chantierTitle}`,
      url: `/chantiers/${planning.chantier_id}`,
    },
    null,
  ).catch(() => {})

  revalidatePath('/mon-espace/dashboard')
  return { error: null }
}

/** Demande l'envoi du rapport au membre lui-même via son espace. */
export async function sendMyHoursReportFromSpace(
  dateFrom: string,
  dateTo: string,
): Promise<Result> {
  const session = await getMemberSession()
  if (!session) return { error: 'Session expirée. Reconnectez-vous via votre lien.' }
  const { error } = await sendMemberHoursReport(session.memberId, dateFrom, dateTo, { useAdmin: true })
  return { error }
}

export async function logoutFromMonEspace(): Promise<void> {
  await clearMemberSessionCookie()
}

export async function updateMyTaskFromSpace(
  tacheId: string,
  status: 'a_faire' | 'en_cours' | 'termine',
): Promise<Result> {
  const session = await getMemberSession()
  if (!session) return { error: 'Session expirée. Reconnectez-vous via votre lien.' }

  const admin = createAdminClient()
  const { data: member } = await admin
    .from('chantier_equipe_membres')
    .select('id, organization_id, equipe_id, profile_id, prenom, name, email')
    .eq('id', session.memberId)
    .eq('organization_id', session.organizationId)
    .maybeSingle()

  if (!member) return { error: 'Membre introuvable.' }

  const { data: task } = await admin
    .from('chantier_taches')
    .select(`
      id, title, status, assigned_to, chantier_id,
      chantier:chantiers!inner(id, title, organization_id)
    `)
    .eq('id', tacheId)
    .eq('chantier.organization_id', session.organizationId)
    .maybeSingle()

  if (!task) return { error: 'Tâche introuvable.' }

  let isAssigned = Boolean(member.profile_id && task.assigned_to === member.profile_id)
  const filters = [
    `member_id.eq.${member.id}`,
    member.equipe_id ? `equipe_id.eq.${member.equipe_id}` : null,
  ].filter(Boolean).join(',')
  const { data: assignment } = await admin
    .from('chantier_task_assignments')
    .select('id')
    .eq('tache_id', tacheId)
    .or(filters)
    .limit(1)
    .maybeSingle()

  isAssigned = isAssigned || !!assignment
  if (!isAssigned) return { error: "Cette tâche ne vous est pas assignée." }

  const completedAt = status === 'termine' ? new Date().toISOString() : null
  const { error } = await admin
    .from('chantier_taches')
    .update({ status, completed_at: completedAt })
    .eq('id', tacheId)

  if (error) return { error: error.message }

  if (status === 'termine' && task.status !== 'termine') {
    const actorName = [member.prenom, member.name].filter(Boolean).join(' ') || member.email || 'Membre'
    await admin.from('activity_log').insert({
      organization_id: session.organizationId,
      user_id: member.profile_id ?? null,
      action: 'chantier_task.completed',
      entity_type: 'chantier_task',
      entity_id: tacheId,
      metadata: {
        task_title: task.title,
        chantier_id: task.chantier_id,
        chantier_title: (task.chantier as any)?.title ?? null,
        actor_name: actorName,
      },
    })
    await sendPushToOrgPermission(session.organizationId, 'chantiers.edit', {
      title: 'Tâche terminée',
      body: `${actorName} a terminé "${task.title}"${(task.chantier as any)?.title ? ` — ${(task.chantier as any).title}` : ''}`,
      url: `/chantiers/${task.chantier_id}`,
    }, member.profile_id ?? null)
  }

  revalidatePath('/mon-espace/dashboard')
  revalidatePath(`/chantiers/${task.chantier_id}`)
  revalidatePath('/dashboard')
  return { error: null }
}

const MAX_MEMBER_PHOTO_SIZE_BYTES = 10 * 1024 * 1024 // 10 Mo
const ALLOWED_MEMBER_PHOTO_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])

type MemberPhotoUploadResult = Result & {
  photo?: {
    id: string
    storage_path: string
    caption: string | null
    taken_at: string
    created_at: string
    uploaded_by_name: string
    url: string | null
  }
}

/** Upload d'une photo de chantier par un membre individuel (intervenant sans compte). */
async function uploadPhotoAsMember(input: {
  memberId: string
  organizationId: string
  chantierId: string
  tacheId?: string | null
  maintenanceInterventionId?: string | null
  caption?: string | null
  file: File
}): Promise<MemberPhotoUploadResult> {
  if (!input.memberId) return { error: 'Session invalide. Reconnectez-vous via votre lien.' }

  const admin = createAdminClient()

  const { data: member } = await admin
    .from('chantier_equipe_membres')
    .select('id, organization_id, prenom, name')
    .eq('id', input.memberId)
    .eq('organization_id', input.organizationId)
    .maybeSingle()
  if (!member) return { error: 'Membre introuvable.' }

  const { data: chantier } = await admin
    .from('chantiers')
    .select('id, organization_id')
    .eq('id', input.chantierId)
    .maybeSingle()
  if (!chantier || chantier.organization_id !== input.organizationId) {
    return { error: 'Chantier introuvable.' }
  }

  const allowedChantiers = await getMemberAccessibleChantiers(input.memberId, input.organizationId)
  if (!allowedChantiers.some(c => c.id === input.chantierId)) {
    return { error: "Ce chantier n'est pas affecté à votre espace." }
  }

  const file = input.file
  if (!file || file.size === 0) return { error: 'Aucun fichier fourni.' }
  if (file.size > MAX_MEMBER_PHOTO_SIZE_BYTES) {
    return { error: 'Photo trop volumineuse (10 Mo maximum).' }
  }
  if (!ALLOWED_MEMBER_PHOTO_MIME.has(file.type)) {
    return { error: 'Format non supporté. Utilisez une photo JPEG, PNG, WEBP ou HEIC.' }
  }

  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `${input.organizationId}/${input.chantierId}/${Date.now()}-membre.${ext}`

  const { error: uploadError } = await admin.storage
    .from('chantier-photos')
    .upload(path, file, { upsert: false, contentType: file.type })

  if (uploadError) {
    console.error('[uploadPhotoAsMember] storage', uploadError)
    return { error: "Erreur lors de l'envoi de la photo." }
  }

  const { data: inserted, error: insertError } = await admin
    .from('chantier_photos')
    .insert({
      chantier_id: input.chantierId,
      tache_id: input.tacheId ?? null,
      maintenance_intervention_id: input.maintenanceInterventionId ?? null,
      member_id: input.memberId,
      uploaded_by: null,
      storage_path: path,
      caption: input.caption?.trim() || null,
    })
    .select('id, storage_path, caption, taken_at, created_at')
    .single()

  if (insertError || !inserted) {
    console.error('[uploadPhotoAsMember] insert', insertError)
    await admin.storage.from('chantier-photos').remove([path])
    return { error: "Erreur lors de l'enregistrement de la photo." }
  }

  const { data: signedData } = await admin.storage
    .from('chantier-photos')
    .createSignedUrl(path, 3600)

  revalidatePath(`/chantiers/${input.chantierId}`)
  revalidatePath('/mon-espace/dashboard')

  const authorName = [member.prenom, member.name].filter(Boolean).join(' ') || member.name

  return {
    error: null,
    photo: {
      id: inserted.id,
      storage_path: inserted.storage_path,
      caption: inserted.caption,
      taken_at: inserted.taken_at,
      created_at: inserted.created_at,
      uploaded_by_name: authorName,
      url: signedData?.signedUrl ?? null,
    },
  }
}

/** Upload d'une photo par le membre depuis son espace. Utilise la session cookie. */
export async function uploadPhotoFromSpace(formData: FormData): Promise<MemberPhotoUploadResult> {
  const session = await getMemberSession()
  if (!session) return { error: 'Session expirée. Reconnectez-vous via votre lien.' }
  if (!session.memberId) return { error: 'Session invalide. Reconnectez-vous via votre lien.' }

  const file = formData.get('file') as File | null
  if (!file) return { error: 'Aucun fichier fourni.' }
  const chantierId = (formData.get('chantierId') as string | null) || ''
  const caption = (formData.get('caption') as string | null) ?? null
  const tacheId = (formData.get('tacheId') as string | null) || null
  const maintenanceInterventionId = (formData.get('maintenanceInterventionId') as string | null) || null

  if (!chantierId) return { error: 'Choisissez un chantier.' }

  return await uploadPhotoAsMember({
    memberId: session.memberId,
    organizationId: session.organizationId,
    chantierId,
    tacheId,
    maintenanceInterventionId,
    caption,
    file,
  })
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatPeriodLabel(from: string, to: string): string {
  // Si même mois → "mars 2026", sinon "01/03/2026 → 31/03/2026"
  const f = new Date(from + 'T00:00:00')
  const t = new Date(to + 'T00:00:00')
  if (f.getFullYear() === t.getFullYear() && f.getMonth() === t.getMonth()) {
    return f.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  }
  return `${f.toLocaleDateString('fr-FR')} → ${t.toLocaleDateString('fr-FR')}`
}
