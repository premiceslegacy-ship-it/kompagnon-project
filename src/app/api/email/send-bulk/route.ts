import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import { defaultBrandedSenderName } from '@/lib/brand'
import { organizationEmailBrand, renderEmailShell } from '@/lib/email/layout'
import { resolveOrganizationFromAddress } from '@/lib/email/resolver'

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
  subject: string
  orgName: string
  contactEmail: string
  bodyHtml: string
  orgSignature: string | null
  greeting: string
  logoUrl?: string | null
  primaryColor?: string | null
}): string {
  // Remplace la première ligne si c'est une formule de salutation générique ou un placeholder
  // Reconnaît : "Bonjour [Prénom]," / "Bonjour," / "Madame, Monsieur," et variantes
  const lines = opts.bodyHtml.split('\n')
  const salutationPattern = /^\s*(bonjour\b.*|salut\b.*|madame[,.].*|monsieur[,.].*)$/i
  if (lines.length > 0 && salutationPattern.test(lines[0])) {
    lines[0] = opts.greeting
  }
  const bodyResolved = lines.join('\n').replace(/\n/g, '<br>')

  return renderEmailShell({
    title: opts.subject,
    headerName: opts.orgName,
    bodyHtml: `<div style="color:#36332E;font-family:'Geist','Inter',Arial,sans-serif;font-size:15px;line-height:1.7;">${bodyResolved}</div>`,
    brand: organizationEmailBrand({
      name: opts.orgName,
      logoUrl: opts.logoUrl,
      primaryColor: opts.primaryColor,
      signature: opts.orgSignature || `${opts.orgName}\n${opts.contactEmail}`,
      replyTo: opts.contactEmail,
    }),
    includeSignature: true,
  })
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
      .select('name, slug, email, logo_url, primary_color, email_from_name, email_from_address, email_signature')
      .eq('id', orgId)
      .single()

    // Instance mutualisée (SHARED_EMAIL_DOMAIN défini) : adresse technique générée
    // depuis le domaine partagé si l'organisation n'a pas configuré la sienne.
    const sharedDomain = process.env.SHARED_EMAIL_DOMAIN
    const orgFromAddress = resolveOrganizationFromAddress({
      organizationAddress: org?.email_from_address,
      slug: org?.slug,
      sharedDomain,
      deploymentAddress: process.env.RESEND_FROM_ADDRESS,
    })

    if (!org || !orgFromAddress) {
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
    const from = `${fromName} <${orgFromAddress}>`

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
    const contactEmail = org.email || orgFromAddress

    // Envoi un par un (RGPD — chaque destinataire reçoit son propre email)
    for (const client of clients) {
      const email = client.email as string
      const greeting = resolveGreeting(client)

      const html = buildEmailHtml({
        subject: subject.trim(),
        orgName: org.name,
        contactEmail,
        bodyHtml,
        orgSignature: org.email_signature ?? null,
        greeting,
        logoUrl: org.logo_url ?? null,
        primaryColor: org.primary_color ?? null,
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
