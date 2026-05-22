'use server'

import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email'
import {
  CLAUSE_LABELS,
  CONTRACT_DISCLAIMER,
  getContractTemplate,
  normalizeClauses,
  normalizeCustomSections,
  interpolateClauses,
  interpolateCustomSections,
  type ContractType,
} from '@/lib/contracts/templates'
import { assertSafeExternalFetchUrl } from '@/lib/security'

export type SubmitClientSignatureInput = {
  token: string
  signatoryName: string
  signatoryRole?: string | null
  signatureImage: string
}

export type SubmitClientSignatureResult = {
  error: string | null
  signedAt: string | null
  orgName: string | null
  contractTitle: string | null
}

function cleanText(value: string | null | undefined): string | null {
  const text = value?.trim()
  return text ? text : null
}

async function fetchLogoAsDataUrl(url: string | null | undefined): Promise<string | null> {
  if (!url || url.startsWith('data:')) return url ?? null
  const safeUrl = assertSafeExternalFetchUrl(url)
  if (!safeUrl) return null
  try {
    const res = await fetch(safeUrl)
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') ?? 'image/png'
    if (contentType.includes('svg')) return null
    const buf = await res.arrayBuffer()
    return `data:${contentType};base64,${Buffer.from(buf).toString('base64')}`
  } catch {
    return null
  }
}

function buildContractReference(contractId: string, generatedAt: string): string {
  const ymd = generatedAt.slice(0, 10).replace(/-/g, '')
  return `CTR-${ymd}-${contractId.slice(0, 8).toUpperCase()}`
}

async function buildSignedPdfSnapshot(contractId: string, signedAt: string, signatoryName: string, signatoryRole: string | null, signatureImage: string) {
  const admin = createAdminClient()

  const { data: contract } = await admin
    .from('contracts')
    .select(`
      id, organization_id, title, contract_type, role, status, counterparty_name, counterparty_email,
      counterparty_phone, counterparty_address, template_key, template_title, clauses,
      custom_sections, duration_text, pdf_reference, pdf_generated_at, sent_at, signed_at, created_at,
      client:clients(id, type, company_name, contact_name, first_name, last_name, email, phone, address_line1, postal_code, city, siret, siren, vat_number),
      chantier:chantiers(id, title, address_line1, postal_code, city, start_date, estimated_end_date, budget_ht)
    `)
    .eq('id', contractId)
    .single()

  if (!contract) return null

  const orgId = contract.organization_id as string | undefined
  const { data: org } = orgId
    ? await admin.from('organizations').select('id, name, email, phone, address_line1, address_line2, postal_code, city, country, siret, siren, vat_number, logo_url, forme_juridique, capital_social, rcs, rcs_ville, insurance_info, court_competent, decennale_enabled, decennale_assureur, decennale_police, signatory_name, signatory_role, signature_image').eq('id', orgId).single()
    : { data: null }

  const template = getContractTemplate(contract.template_key)
  const rawClauses = normalizeClauses(contract.clauses, template?.clauses ?? contract.clauses)
  const rawCustomSections = normalizeCustomSections(contract.custom_sections)

  const counterpartyName = contract.counterparty_name
  const orgName = org?.name ?? null
  const chantierTitle = Array.isArray(contract.chantier)
    ? (contract.chantier[0]?.title ?? null)
    : (contract.chantier as any)?.title ?? null

  const interpolationVars = contract.role === 'donneur_ordre'
    ? { donneurOrdre: orgName, soustraitant: counterpartyName, chantier: chantierTitle }
    : { donneurOrdre: counterpartyName, soustraitant: orgName, chantier: chantierTitle }

  const clauses = interpolateClauses(rawClauses, interpolationVars)
  const interpolatedCustomSections = interpolateCustomSections(rawCustomSections, interpolationVars)

  const durationText = cleanText(contract.duration_text)
  if (durationText) {
    clauses.duree = `Le présent contrat prend effet à compter de sa signature par les deux parties pour une durée de ${durationText}.\n\n${clauses.duree}`
  }

  const generatedAt = new Date().toISOString()
  const reference = contract.pdf_reference ?? buildContractReference(contractId, generatedAt)
  const logoDataUrl = await fetchLogoAsDataUrl(org?.logo_url)

  return {
    generatedAt,
    reference,
    disclaimer: CONTRACT_DISCLAIMER,
    contract: {
      id: contract.id,
      title: contract.title,
      type: contract.contract_type as ContractType,
      role: contract.role,
      status: 'signed',
      templateKey: contract.template_key,
      templateTitle: contract.template_title,
      createdAt: contract.created_at,
      sentAt: (contract as any).sent_at ?? null,
      signedAt,
      durationText,
      clauses,
      customSections: interpolatedCustomSections,
      clauseLabels: CLAUSE_LABELS,
    },
    organization: org ? {
      name: org.name,
      email: org.email,
      phone: org.phone,
      address_line1: org.address_line1,
      address_line2: org.address_line2,
      postal_code: org.postal_code,
      city: org.city,
      country: org.country,
      siret: org.siret,
      siren: org.siren,
      vat_number: org.vat_number,
      logo_url: logoDataUrl,
      forme_juridique: org.forme_juridique,
      capital_social: org.capital_social,
      rcs: org.rcs,
      rcs_ville: org.rcs_ville,
      insurance_info: org.insurance_info,
      court_competent: org.court_competent,
      decennale_enabled: org.decennale_enabled,
      decennale_assureur: org.decennale_assureur,
      decennale_police: org.decennale_police,
      signatory_name: org.signatory_name ?? null,
      signatory_role: org.signatory_role ?? null,
      signature_image: org.signature_image ?? null,
    } : null,
    counterparty: {
      name: counterpartyName,
      email: contract.counterparty_email,
      phone: contract.counterparty_phone,
      address: contract.counterparty_address,
      client: Array.isArray(contract.client) ? contract.client[0] ?? null : contract.client ?? null,
      signature_image: signatureImage,
      signatory_name: signatoryName,
      signatory_role: signatoryRole,
      signed_at: signedAt,
    },
    chantier: Array.isArray(contract.chantier) ? contract.chantier[0] ?? null : contract.chantier ?? null,
  }
}

/**
 * Enregistre la signature manuscrite du client via le token public du contrat.
 * - Pas d'auth requise (page publique signature)
 * - Met le statut à 'signed' et stocke nom, image, date, IP, user-agent
 * - Invalide le PDF snapshot (regénération nécessaire pour intégrer la signature)
 */
export async function submitClientSignature(input: SubmitClientSignatureInput): Promise<SubmitClientSignatureResult> {
  const admin = createAdminClient()

  const signatoryName = input.signatoryName?.trim() ?? ''
  const signatoryRole = cleanText(input.signatoryRole)
  const signatureImage = input.signatureImage?.trim() ?? ''
  if (!signatoryName) return { error: 'Veuillez renseigner votre nom.', signedAt: null, orgName: null, contractTitle: null }
  if (!signatureImage || !signatureImage.startsWith('data:image/')) {
    return { error: 'Signature manquante.', signedAt: null, orgName: null, contractTitle: null }
  }

  const { data: contract, error: fetchErr } = await admin
    .from('contracts')
    .select('id, organization_id, title, status, signature_token, client_signed_at')
    .eq('signature_token', input.token)
    .single()

  if (fetchErr || !contract) {
    return { error: 'Contrat introuvable ou lien invalide.', signedAt: null, orgName: null, contractTitle: null }
  }

  if (contract.status === 'archived') {
    return { error: "Ce contrat est archivé et n'est plus disponible à la signature.", signedAt: null, orgName: null, contractTitle: null }
  }

  if (contract.client_signed_at) {
    const { data: org } = await admin.from('organizations').select('name').eq('id', contract.organization_id).single()
    return { error: null, signedAt: contract.client_signed_at, orgName: org?.name ?? null, contractTitle: contract.title }
  }

  const reqHeaders = await headers()
  const ip = reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? reqHeaders.get('x-real-ip')
    ?? 'inconnue'
  const userAgent = reqHeaders.get('user-agent') ?? ''
  const signedAt = new Date().toISOString()

  const { error: updateErr } = await admin
    .from('contracts')
    .update({
      status: 'signed',
      signed_at: signedAt,
      client_signed_at: signedAt,
      client_signatory_name: signatoryName,
      client_signatory_role: signatoryRole,
      client_signature_image: signatureImage,
      pdf_reference: null,
      pdf_generated_at: null,
      pdf_snapshot: null,
    })
    .eq('id', contract.id)

  if (updateErr) {
    console.error('[submitClientSignature]', updateErr, { hasIp: ip !== 'inconnue', userAgentLength: userAgent.length })
    return { error: 'Une erreur est survenue. Veuillez réessayer.', signedAt: null, orgName: null, contractTitle: null }
  }

  // Génère immédiatement le snapshot PDF avec la signature du client incluse
  try {
    const snapshot = await buildSignedPdfSnapshot(contract.id, signedAt, signatoryName, signatoryRole, signatureImage)
    if (snapshot) {
      await admin
        .from('contracts')
        .update({
          pdf_reference: snapshot.reference,
          pdf_generated_at: snapshot.generatedAt,
          pdf_snapshot: snapshot,
        })
        .eq('id', contract.id)
    }
  } catch (err) {
    console.error('[submitClientSignature] pdf snapshot', err)
    // Non bloquant : le PDF sera régénéré la prochaine fois
  }

  const { data: org } = await admin.from('organizations').select('name').eq('id', contract.organization_id).single()

  return {
    error: null,
    signedAt,
    orgName: org?.name ?? null,
    contractTitle: contract.title,
  }
}

export type SubmitClientSignatureWithQuoteInput = SubmitClientSignatureInput & {
  acceptQuote: boolean
}

/**
 * Signature client avec validation optionnelle du devis lié.
 * Si acceptQuote = true et qu'un quote_id est lié au contrat, le devis passe en 'accepted'.
 */
export async function submitClientSignatureWithQuote(input: SubmitClientSignatureWithQuoteInput): Promise<SubmitClientSignatureResult> {
  const admin = createAdminClient()

  const signatoryName = input.signatoryName?.trim() ?? ''
  const signatoryRole = cleanText(input.signatoryRole)
  const signatureImage = input.signatureImage?.trim() ?? ''
  if (!signatoryName) return { error: 'Veuillez renseigner votre nom.', signedAt: null, orgName: null, contractTitle: null }
  if (!signatureImage || !signatureImage.startsWith('data:image/')) {
    return { error: 'Signature manquante.', signedAt: null, orgName: null, contractTitle: null }
  }

  const { data: contract, error: fetchErr } = await admin
    .from('contracts')
    .select('id, organization_id, title, status, signature_token, client_signed_at, quote_id')
    .eq('signature_token', input.token)
    .single()

  if (fetchErr || !contract) {
    return { error: 'Contrat introuvable ou lien invalide.', signedAt: null, orgName: null, contractTitle: null }
  }

  if (contract.status === 'archived') {
    return { error: "Ce contrat est archivé et n'est plus disponible à la signature.", signedAt: null, orgName: null, contractTitle: null }
  }

  if (contract.client_signed_at) {
    const { data: org } = await admin.from('organizations').select('name').eq('id', contract.organization_id).single()
    return { error: null, signedAt: contract.client_signed_at, orgName: org?.name ?? null, contractTitle: contract.title }
  }

  const reqHeaders = await headers()
  const ip = reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? reqHeaders.get('x-real-ip')
    ?? 'inconnue'
  const userAgent = reqHeaders.get('user-agent') ?? ''
  const signedAt = new Date().toISOString()

  const { error: updateErr } = await admin
    .from('contracts')
    .update({
      status: 'signed',
      signed_at: signedAt,
      client_signed_at: signedAt,
      client_signatory_name: signatoryName,
      client_signatory_role: signatoryRole,
      client_signature_image: signatureImage,
      pdf_reference: null,
      pdf_generated_at: null,
      pdf_snapshot: null,
    })
    .eq('id', contract.id)

  if (updateErr) {
    console.error('[submitClientSignatureWithQuote] contract', updateErr, { hasIp: ip !== 'inconnue', userAgentLength: userAgent.length })
    return { error: 'Une erreur est survenue. Veuillez réessayer.', signedAt: null, orgName: null, contractTitle: null }
  }

  // Accepter le devis lié si demandé
  const quoteId = (contract as any).quote_id as string | null
  if (input.acceptQuote && quoteId) {
    const { error: quoteErr } = await admin
      .from('quotes')
      .update({
        status: 'accepted',
        accepted_at: signedAt,
        signed_at: signedAt,
        signed_ip: ip,
        signed_user_agent: userAgent,
        client_signatory_name: signatoryName,
        client_signatory_role: signatoryRole,
        client_signature_image: signatureImage,
      })
      .eq('id', quoteId)
    if (quoteErr) {
      console.error('[submitClientSignatureWithQuote] quote accept', quoteErr)
      // Non bloquant : le contrat est signé, le devis reste dans son état
    }
  }

  // Génère le snapshot PDF avec la signature incluse
  try {
    const snapshot = await buildSignedPdfSnapshot(contract.id, signedAt, signatoryName, signatoryRole, signatureImage)
    if (snapshot) {
      await admin
        .from('contracts')
        .update({
          pdf_reference: snapshot.reference,
          pdf_generated_at: snapshot.generatedAt,
          pdf_snapshot: snapshot,
        })
        .eq('id', contract.id)
    }
  } catch (err) {
    console.error('[submitClientSignatureWithQuote] pdf snapshot', err)
  }

  const { data: org } = await admin.from('organizations').select('name, email').eq('id', contract.organization_id).single()

  return {
    error: null,
    signedAt,
    orgName: org?.name ?? null,
    contractTitle: contract.title,
  }
}

export type SendQuoteDeclineMessageInput = {
  token: string
  senderName: string
  message: string
}

/**
 * Envoie un message de refus/contre-proposition au mail de l'organisation.
 * Utilisé depuis la page de signature quand le client ne souhaite pas valider le devis.
 */
export async function sendQuoteDeclineMessage(input: SendQuoteDeclineMessageInput): Promise<{ error: string | null }> {
  const admin = createAdminClient()

  const { data: contract } = await admin
    .from('contracts')
    .select('id, organization_id, title, counterparty_name, quote_id')
    .eq('signature_token', input.token)
    .single()

  if (!contract) return { error: 'Contrat introuvable.' }

  const { data: org } = await admin
    .from('organizations')
    .select('id, name, email')
    .eq('id', contract.organization_id)
    .single()

  if (!org?.email) return { error: "Impossible de trouver l'adresse e-mail de contact." }

  const senderName = input.senderName?.trim() || contract.counterparty_name
  const message = input.message?.trim()
  if (!message) return { error: 'Veuillez rédiger votre message.' }

  const subject = `Réponse de ${senderName} - contrat ${contract.title}`
  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif;color:#333">
      <div style="background:#0a0a0a;padding:20px 28px;border-radius:10px 10px 0 0">
        <p style="color:white;font-weight:bold;margin:0">Message reçu via le portail de signature</p>
      </div>
      <div style="background:white;padding:28px;border-radius:0 0 10px 10px;border:1px solid #eee;border-top:none;line-height:1.7;font-size:14px">
        <p><strong>De :</strong> ${senderName}</p>
        <p><strong>Contrat concerné :</strong> ${contract.title}</p>
        <p style="margin-top:16px;padding:16px;background:#f5f5f5;border-radius:8px;white-space:pre-line">${message}</p>
        <p style="font-size:12px;color:#888;margin-top:24px">Ce message a été envoyé depuis la page de signature du contrat.</p>
      </div>
    </div>
  `

  const mail = await sendEmail({
    organizationId: org.id,
    to: org.email,
    subject,
    html,
  })

  return { error: mail.error ?? null }
}
