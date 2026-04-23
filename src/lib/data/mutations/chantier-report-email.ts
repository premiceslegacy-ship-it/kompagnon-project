'use server'

import React from 'react'
import { pdf } from '@react-pdf/renderer'
import { sendEmail } from '@/lib/email'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import {
  getChantierById,
  getChantierTaches,
  getChantierPointages,
  getChantierNotes,
} from '@/lib/data/queries/chantiers'
import { getOrganization } from '@/lib/data/queries/organization'
import ChantierPDF from '@/components/pdf/ChantierPDF'
import { AIModuleDisabledError, callAI } from '@/lib/ai/callAI'

export async function sendChantierReportEmail(
  chantierId: string,
  options?: { dateFrom?: string; dateTo?: string },
): Promise<{ error: string | null; recipient?: string }> {
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const [chantier, allTaches, allPointages, allNotes, organization] = await Promise.all([
    getChantierById(chantierId),
    getChantierTaches(chantierId),
    getChantierPointages(chantierId),
    getChantierNotes(chantierId),
    getOrganization(),
  ])

  if (!chantier)      return { error: 'Chantier introuvable.' }
  if (!organization)  return { error: 'Organisation introuvable.' }

  const recipient = chantier.contact_email || chantier.client?.email
  if (!recipient) return { error: 'Aucune adresse email trouvée pour ce chantier. Ajoutez un email de contact référent ou liez le chantier à un client.' }

  const { dateFrom, dateTo } = options ?? {}

  const taches    = allTaches
  const pointages = allPointages.filter(p => {
    if (dateFrom && p.date < dateFrom) return false
    if (dateTo   && p.date > dateTo)   return false
    return true
  })
  const notes = allNotes.filter(n => {
    const d = n.created_at.split('T')[0]
    if (dateFrom && d < dateFrom) return false
    if (dateTo   && d > dateTo)   return false
    return true
  })

  // ── AI intro ───────────────────────────────────────────────────────────────
  const tachesDone  = taches.filter(t => t.status === 'termine').length
  const totalHours  = pointages.reduce((s, p) => s + p.hours, 0)
  const lastNote    = notes[0]?.content ?? null
  const contactName = chantier.contact_name ?? null

  const aiIntro = await generateEmailIntro({
    chantierTitle: chantier.title,
    contactName,
    status: chantier.status,
    tachesCount: taches.length,
    tachesDone,
    totalHours,
    lastNote,
    orgName: organization.name,
    orgId,
  })

  // ── Render PDF to Buffer ───────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfBuffer: Buffer = await (pdf as any)(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(ChantierPDF as any, {
      chantier,
      taches,
      pointages,
      notes,
      organization,
      periodFrom: dateFrom ?? null,
      periodTo:   dateTo   ?? null,
    }),
  ).toBuffer()

  const fileName = `rapport-chantier-${chantier.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.pdf`

  // ── Send via Resend ────────────────────────────────────────────────────────
  const recipientName = chantier.contact_name || chantier.client?.company_name || recipient

  const subject = `Rapport de chantier : ${chantier.title}`

  const html = buildEmailHtml({
    intro: aiIntro,
    recipientName,
    chantierTitle: chantier.title,
    orgName: organization.name,
  })

  const { error } = await sendEmail({
    organizationId: orgId,
    to: recipient,
    subject,
    html,
    attachments: [{ filename: fileName, content: pdfBuffer }],
  })

  if (error) return { error }
  return { error: null, recipient }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function generateEmailIntro(ctx: {
  chantierTitle: string
  contactName: string | null
  status: string
  tachesCount: number
  tachesDone: number
  totalHours: number
  lastNote: string | null
  orgName: string
  orgId: string
}): Promise<string> {
  if (!process.env.OPENROUTER_API_KEY) return defaultIntro(ctx)

  const userMsg = `Génère un court message d'introduction (2-3 phrases max, ton professionnel mais chaleureux) pour accompagner le rapport PDF d'un chantier BTP envoyé par email.

Chantier : "${ctx.chantierTitle}"
Statut : ${ctx.status}
Tâches : ${ctx.tachesDone}/${ctx.tachesCount} terminées
Heures pointées : ${ctx.totalHours}h
Dernière note de chantier : ${ctx.lastNote ?? 'aucune'}
Signataire : ${ctx.orgName}

Commence directement le message (pas de "Objet:", pas de signature, juste le corps du message).`

  try {
    const { data } = await callAI<any>({
      organizationId: ctx.orgId,
      provider: 'openrouter',
      feature: 'chantier_report_summary',
      model: 'anthropic/claude-haiku-4-5-20251001',
      inputKind: 'text',
      request: {
        body: {
          max_tokens: 200,
          messages: [{ role: 'user', content: userMsg }],
        },
      },
      metadata: {
        mutation: 'sendChantierReportEmail.generateEmailIntro',
        chantier_title: ctx.chantierTitle,
      },
    })

    return data.choices?.[0]?.message?.content?.trim() ?? defaultIntro(ctx)
  } catch (error) {
    if (error instanceof AIModuleDisabledError) return defaultIntro(ctx)
    return defaultIntro(ctx)
  }
}

function defaultIntro(ctx: { chantierTitle: string; tachesDone: number; tachesCount: number; totalHours: number }): string {
  return `Veuillez trouver ci-joint le rapport de suivi du chantier "${ctx.chantierTitle}". À ce jour, ${ctx.tachesDone} tâche(s) sur ${ctx.tachesCount} sont terminées, pour un total de ${ctx.totalHours}h pointées. N'hésitez pas à nous contacter pour toute question.`
}

function buildEmailHtml(ctx: {
  intro: string
  recipientName: string
  chantierTitle: string
  orgName: string
}): string {
  const introHtml = ctx.intro.replace(/\n/g, '<br>')
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
        <tr><td style="background:#1a1a2e;padding:24px 32px;">
          <p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">${ctx.orgName}</p>
          <p style="margin:4px 0 0;color:rgba(255,255,255,.6);font-size:13px;">Rapport de chantier</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;color:#374151;font-size:15px;">Bonjour${ctx.recipientName ? ' ' + ctx.recipientName : ''},</p>
          <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">${introHtml}</p>
          <div style="background:#f9fafb;border-left:4px solid #6366f1;border-radius:4px;padding:16px 20px;margin-bottom:24px;">
            <p style="margin:0;color:#6b7280;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Chantier</p>
            <p style="margin:4px 0 0;color:#111827;font-size:16px;font-weight:700;">${ctx.chantierTitle}</p>
          </div>
          <p style="margin:0;color:#6b7280;font-size:13px;">Le rapport complet est joint en pièce attachée (PDF).</p>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">${ctx.orgName} · Envoyé via ATELIER by Orsayn</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
