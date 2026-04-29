'use server'

import React from 'react'
import { pdf } from '@react-pdf/renderer'
import { sendEmail } from '@/lib/email'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import {
  getChantierById,
  getChantierTaches,
  getChantierPointages,
  getChantierNotes,
} from '@/lib/data/queries/chantiers'
import { getOrganization } from '@/lib/data/queries/organization'
import ChantierPDF from '@/components/pdf/ChantierPDF'
import type { ChantierPDFPhoto } from '@/components/pdf/ChantierPDF'
import { AIModuleDisabledError, callAI } from '@/lib/ai/callAI'
import { renderEmailShell, renderInfoBox, escHtml } from '@/lib/email/layout'

export async function sendChantierReportEmail(
  chantierId: string,
  options?: { dateFrom?: string; dateTo?: string },
): Promise<{ error: string | null; recipient?: string }> {
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const supabase = await createClient()
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

  // ── Photos marquées include_in_report ─────────────────────────────────────
  const { data: photoRows } = await supabase
    .from('chantier_photos')
    .select('id, storage_path, caption')
    .eq('chantier_id', chantierId)
    .eq('include_in_report', true)
    .order('created_at', { ascending: true })

  let reportPhotos: ChantierPDFPhoto[] = []
  if (photoRows && photoRows.length > 0) {
    const paths = photoRows.map(r => r.storage_path as string)
    const { data: signedUrls } = await supabase.storage
      .from('chantier-photos')
      .createSignedUrls(paths, 3600)
    const urlMap = new Map<string, string>()
    signedUrls?.forEach(item => { if (item.signedUrl && item.path) urlMap.set(item.path, item.signedUrl) })
    reportPhotos = photoRows
      .map(p => ({ id: p.id, url: urlMap.get(p.storage_path) ?? '', caption: p.caption ?? null, title: null }))
      .filter(p => p.url !== '')
  }

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
      reportPhotos,
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

Règles obligatoires :
- Aucun emoji, aucun symbole décoratif
- Aucun tiret cadratin (—) : utilise des virgules ou des points à la place
- Français irréprochable
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
  const introHtml = escHtml(ctx.intro).replace(/\n/g, '<br>')
  const body = `
<p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#A1A1AA;text-transform:uppercase;letter-spacing:0.8px;font-family:'Inter',sans-serif;">Rapport de chantier</p>
<h1 style="margin:0 0 12px;font-size:22px;font-weight:800;color:#FFFFFF;line-height:1.3;letter-spacing:-0.04em;font-family:'Plus Jakarta Sans',sans-serif;">
  Bonjour${ctx.recipientName ? ' ' + escHtml(ctx.recipientName) : ''} !
</h1>
<p style="margin:0 0 24px;font-size:15px;color:#A1A1AA;line-height:1.6;font-family:'Inter',sans-serif;">${introHtml}</p>
${renderInfoBox([{ label: 'Chantier', value: escHtml(ctx.chantierTitle), large: true }])}
<p style="margin:0;font-size:13px;color:#555555;line-height:1.5;font-family:'Inter',sans-serif;">Le rapport complet est joint en pièce attachée (PDF).</p>`

  return renderEmailShell({
    title: `Rapport de chantier : ${ctx.chantierTitle}`,
    headerName: ctx.orgName,
    bodyHtml: body,
  })
}
