'use server'

import React from 'react'
import { revalidatePath } from 'next/cache'
import { pdf } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import { sendEmail } from '@/lib/email'
import {
  buildMemberSpaceInviteEmail,
  buildMemberMonthlyReportEmail,
} from '@/lib/email/templates'
import { generateMagicToken, hashToken, getMemberSession, clearMemberSessionCookie } from '@/lib/auth/member-session'
import { getMemberPointages, getMemberByIdAdmin } from '@/lib/data/queries/members'
import MemberHoursReportPDF from '@/components/pdf/MemberHoursReportPDF'

type Result = { error: string | null }

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
  if (!(await hasPermission('chantiers.edit'))) return { error: 'Permission refusée.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

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
    await sendMemberSpaceInvite(inserted.id)
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
  if (!(await hasPermission('chantiers.edit'))) return { error: 'Permission refusée.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

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
  if (!(await hasPermission('chantiers.edit'))) return { error: 'Permission refusée.' }

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
  if (!(await hasPermission('chantiers.edit'))) return { error: 'Permission refusée.' }
  const supabase = await createClient()

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
  if (!(await hasPermission('chantiers.edit'))) return { error: 'Permission refusée.' }
  const supabase = await createClient()

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

  // Recherche du membre par email (toutes orgs confondues — un membre = une org en pratique)
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

  return await sendMemberSpaceInvite(members[0].id)
}

/** Envoie le magic link à un membre donné (utilisé à la création + à la demande). */
export async function sendMemberSpaceInvite(memberId: string): Promise<Result> {
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

/** Vérifie un magic-link et retourne l'identité du membre (sans poser de cookie). */
export async function verifyMemberToken(rawToken: string): Promise<{
  memberId: string
  organizationId: string
} | null> {
  if (!rawToken) return null
  const admin = createAdminClient()
  const tokenHash = hashToken(rawToken)

  const { data: token } = await admin
    .from('member_space_tokens')
    .select('id, member_id, expires_at, member:chantier_equipe_membres!inner(organization_id)')
    .eq('token_hash', tokenHash)
    .single()

  if (!token) return null
  if (new Date(token.expires_at).getTime() < Date.now()) return null

  await admin
    .from('member_space_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', token.id)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const organizationId = (token as any).member?.organization_id as string | undefined
  if (!organizationId) return null

  return { memberId: token.member_id, organizationId }
}

// ─── 4. Pointage depuis l'espace membre ──────────────────────────────────────

export async function createPointageAsMember(input: {
  memberId: string
  organizationId: string
  chantierId: string
  date: string                 // YYYY-MM-DD
  hours: number
  startTime?: string | null    // HH:MM
  description?: string | null
  tacheId?: string | null
}): Promise<Result & { id?: string }> {
  if (input.hours <= 0 || input.hours > 24) return { error: 'Nombre d\'heures invalide.' }

  const admin = createAdminClient()

  // Vérifier que le chantier appartient bien à la même org que le membre
  const { data: chantier } = await admin
    .from('chantiers')
    .select('id, organization_id')
    .eq('id', input.chantierId)
    .single()

  if (!chantier || chantier.organization_id !== input.organizationId) {
    return { error: 'Chantier introuvable.' }
  }

  const { data: inserted, error } = await admin
    .from('chantier_pointages')
    .insert({
      chantier_id:  input.chantierId,
      tache_id:     input.tacheId ?? null,
      member_id:    input.memberId,
      user_id:      null,
      date:         input.date,
      hours:        input.hours,
      start_time:   input.startTime ?? null,
      description:  input.description ?? null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createPointageAsMember]', error)
    return { error: "Impossible d'enregistrer le pointage." }
  }
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
      // Réutilise une permission existante du domaine chantier — à adapter si besoin
      return { error: 'Permission refusée.' }
    }
  }

  const admin = createAdminClient()
  const member = await getMemberByIdAdmin(memberId)
  if (!member) return { error: 'Membre introuvable.' }
  if (!member.email) return { error: "Ce membre n'a pas d'adresse email." }

  const { data: org } = await admin
    .from('organizations')
    .select('name, logo_url, address_line1, postal_code, city')
    .eq('id', member.organization_id)
    .single()

  if (!org) return { error: 'Organisation introuvable.' }

  const pointages = await getMemberPointages(memberId, { dateFrom, dateTo, useAdmin: true })

  const totalHours = pointages.reduce((s, p) => s + p.hours, 0)
  const periodLabel = formatPeriodLabel(dateFrom, dateTo)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfBuffer: Buffer = await (pdf as any)(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(MemberHoursReportPDF as any, {
      member,
      organization: org,
      pointages,
      periodFrom: dateFrom,
      periodTo: dateTo,
      totalHours,
    }),
  ).toBuffer()

  const fileName = `rapport-heures-${(member.prenom ?? '').toLowerCase()}-${member.name.toLowerCase()}-${dateFrom}-${dateTo}.pdf`
    .replace(/[^a-z0-9.-]/gi, '-')

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const spaceUrl = baseUrl ? `${baseUrl}/mon-espace/request-access` : null

  const { subject, html } = buildMemberMonthlyReportEmail({
    orgName: org.name,
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
  chantierId: string
  date: string
  hours: number
  startTime?: string | null
  description?: string | null
  tacheId?: string | null
}): Promise<Result & { id?: string }> {
  const session = await getMemberSession()
  if (!session) return { error: 'Session expirée. Reconnectez-vous via votre lien.' }

  return await createPointageAsMember({
    memberId: session.memberId,
    organizationId: session.organizationId,
    chantierId: input.chantierId,
    date: input.date,
    hours: input.hours,
    startTime: input.startTime ?? null,
    description: input.description ?? null,
    tacheId: input.tacheId ?? null,
  })
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
