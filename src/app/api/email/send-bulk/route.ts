import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import { defaultBrandedSenderName } from '@/lib/brand'

export const dynamic = 'force-dynamic'

type RecipientFilter = {
  mode: 'all' | 'all_active' | 'by_status' | 'manual'
  statuses?: string[]
  ids?: string[]
}

function resolveGreeting(client: {
  type: string
  first_name: string | null
  last_name: string | null
  contact_name: string | null
  company_name: string | null
}): string {
  if (client.type === 'individual') {
    const firstName = client.first_name?.trim()
    const lastName = client.last_name?.trim()
    if (firstName) return `Bonjour ${firstName}${lastName ? ' ' + lastName : ''},`
  }
  // Professionnel : on préfère le contact référent, sinon le nom de l'entreprise
  const contact = client.contact_name?.trim()
  if (contact) return `Bonjour ${contact},`
  const company = client.company_name?.trim()
  if (company) return `Bonjour l'équipe ${company},`
  return 'Bonjour,'
}

function buildEmailHtml(opts: {
  orgName: string
  contactEmail: string
  bodyHtml: string
  orgSignature: string | null
  greeting: string
}): string {
  const signatureHtml = opts.orgSignature
    ? opts.orgSignature.replace(/\n/g, '<br>')
    : `${opts.orgName}<br><a href="mailto:${opts.contactEmail}" style="color:#666">${opts.contactEmail}</a>`

  // Remplace la première ligne si c'est une formule de salutation générique ou un placeholder
  // Reconnaît : "Bonjour [Prénom]," / "Bonjour," / "Madame, Monsieur," et variantes
  const lines = opts.bodyHtml.split('\n')
  const salutationPattern = /^\s*(bonjour\b.*|salut\b.*|madame[,.].*|monsieur[,.].*)$/i
  if (lines.length > 0 && salutationPattern.test(lines[0])) {
    lines[0] = opts.greeting
  }
  const bodyResolved = lines.join('\n').replace(/\n/g, '<br>')

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:24px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:600px">
        <tr><td style="padding:32px 40px 24px">
          <div style="font-size:15px;color:#111;line-height:1.6">${bodyResolved}</div>
        </td></tr>
        <tr><td style="padding:24px 40px 32px;border-top:1px solid #eee">
          <p style="margin:0;font-size:13px;color:#555;line-height:1.6">${signatureHtml}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export async function POST(req: NextRequest) {
  try {
    const orgId = await getCurrentOrganizationId()
    if (!orgId) {
      return NextResponse.json({ error: 'Non connecté.' }, { status: 401 })
    }

    const allowed = await hasPermission('clients.edit')
    if (!allowed) {
      return NextResponse.json({ error: 'Permission insuffisante.' }, { status: 403 })
    }

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'Configuration email manquante (RESEND_API_KEY).' }, { status: 500 })
    }

    const body = await req.json()
    const { subject, bodyHtml, filter } = body as {
      subject: string
      bodyHtml: string
      filter: RecipientFilter
    }

    if (!subject?.trim() || !bodyHtml?.trim() || !filter?.mode) {
      return NextResponse.json({ error: 'Paramètres manquants (subject, bodyHtml, filter).' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Récupérer l'organisation (nom + email expéditeur Resend + vrai email de contact + signature)
    const { data: org } = await admin
      .from('organizations')
      .select('name, email, email_from_name, email_from_address, email_signature')
      .eq('id', orgId)
      .single()

    if (!org?.email_from_address) {
      return NextResponse.json({
        error: "L'adresse email expéditeur n'est pas configurée. Allez dans Paramètres > Email.",
      }, { status: 422 })
    }

    // Récupérer les destinataires selon le filtre
    let clientsQuery = admin
      .from('clients')
      .select('id, email, first_name, last_name, company_name, contact_name, type, status')
      .eq('organization_id', orgId)
      .eq('is_archived', false)
      .not('email', 'is', null)
      .neq('email', '')

    if (filter.mode === 'all') {
      // tous les contacts non archivés avec un email — pas de filtre de statut
    } else if (filter.mode === 'all_active') {
      clientsQuery = clientsQuery.eq('status', 'active')
    } else if (filter.mode === 'by_status' && filter.statuses?.length) {
      clientsQuery = clientsQuery.in('status', filter.statuses)
    } else if (filter.mode === 'manual' && filter.ids?.length) {
      clientsQuery = clientsQuery.in('id', filter.ids)
    } else {
      return NextResponse.json({ error: 'Filtre de destinataires invalide.' }, { status: 400 })
    }

    const { data: clients, error: clientsError } = await clientsQuery
    if (clientsError) {
      return NextResponse.json({ error: 'Erreur lors de la récupération des clients.' }, { status: 500 })
    }

    if (!clients?.length) {
      return NextResponse.json({ error: 'Aucun destinataire avec une adresse email valide.' }, { status: 422 })
    }

    // Obtenir l'utilisateur courant pour le log
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    // Créer l'enregistrement broadcast
    const { data: broadcast, error: broadcastError } = await admin
      .from('email_broadcasts')
      .insert({
        organization_id: orgId,
        subject: subject.trim(),
        body_html: bodyHtml,
        recipient_filter: filter,
        recipient_count: clients.length,
        sent_at: new Date().toISOString(),
        created_by: user?.id ?? null,
      })
      .select('id')
      .single()

    if (broadcastError || !broadcast) {
      return NextResponse.json({ error: 'Erreur lors de la création du broadcast.' }, { status: 500 })
    }

    const resend = new Resend(apiKey)
    const fromName = defaultBrandedSenderName(org.email_from_name || org.name)
    const from = `${fromName} <${org.email_from_address}>`

    let sent = 0
    let errors = 0
    const logs: Array<{
      broadcast_id: string
      client_id: string
      email: string
      status: string
      error_message?: string
    }> = []

    // Vrai email de contact de l'organisation (pour replyTo et signature)
    const contactEmail = org.email || org.email_from_address

    // Envoi un par un (RGPD — chaque destinataire reçoit son propre email)
    for (const client of clients) {
      const email = client.email as string
      const greeting = resolveGreeting(client)

      const html = buildEmailHtml({
        orgName: org.name,
        contactEmail,
        bodyHtml,
        orgSignature: org.email_signature ?? null,
        greeting,
      })

      const { error: sendError } = await resend.emails.send({
        from,
        to: email,
        subject: subject.trim(),
        html,
        replyTo: contactEmail,
      })

      if (sendError) {
        errors++
        logs.push({
          broadcast_id: broadcast.id,
          client_id: client.id,
          email,
          status: 'error',
          error_message: sendError.message,
        })
      } else {
        sent++
        logs.push({
          broadcast_id: broadcast.id,
          client_id: client.id,
          email,
          status: 'sent',
        })
      }

      // Petite pause pour éviter le rate-limit Resend (100 emails/s max)
      if (clients.length > 10) {
        await new Promise(r => setTimeout(r, 50))
      }
    }

    // Persister les logs
    if (logs.length > 0) {
      await admin.from('broadcast_logs').insert(logs)
    }

    return NextResponse.json({ sent, errors, broadcastId: broadcast.id })
  } catch (err) {
    console.error('[send-bulk] Erreur inattendue:', err)
    return NextResponse.json({ error: 'Erreur serveur inattendue.' }, { status: 500 })
  }
}
