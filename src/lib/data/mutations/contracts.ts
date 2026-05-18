'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import { getOrganization } from '@/lib/data/queries/organization'
import { sendEmail } from '@/lib/email'
import { renderContractPdfBufferById, renderInvoicePdfBufferById, renderQuotePdfBufferById } from '@/lib/pdf/server'
import {
  CLAUSE_LABELS,
  CONTRACT_DISCLAIMER,
  CONTRACT_STATUS_LABELS,
  type ContractTemplate,
  getContractTemplate,
  normalizeClauses,
  normalizeCustomSections,
  interpolateClauses,
  interpolateCustomSections,
  type ContractClauses,
  type ContractCustomSection,
  type ContractRole,
  type ContractStatus,
  type ContractType,
} from '@/lib/contracts/templates'
import { assertSafeExternalFetchUrl } from '@/lib/security'

type Result = { error: string | null }

type CreateContractInput = {
  title: string
  contractType: ContractType
  role: ContractRole
  clientId?: string | null
  chantierId?: string | null
  quoteId?: string | null
  counterpartyName: string
  counterpartyEmail?: string | null
  counterpartyPhone?: string | null
  counterpartyAddress?: string | null
  templateKey: string
  clauses?: Partial<ContractClauses>
  customSections?: ContractCustomSection[]
  durationText?: string | null
}

type UpdateContractInput = Partial<Omit<CreateContractInput, 'contractType'>> & {
  contractType?: ContractType
  quoteId?: string | null
  status?: ContractStatus
}

type ContractTemplateInput = {
  title: string
  contractType: ContractType
  clauses: Partial<ContractClauses>
  customSections?: ContractCustomSection[]
}

const ALLOWED_STATUS_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  draft: ['draft', 'sent', 'signed', 'archived'],
  sent: ['sent', 'signed', 'archived'],
  signed: ['signed', 'archived'],
  archived: ['archived'],
}

function cleanText(value: string | null | undefined): string | null {
  const text = value?.trim()
  return text ? text : null
}

function displayClientName(client: any): string | null {
  if (!client) return null
  return cleanText(client.company_name)
    ?? cleanText(client.contact_name)
    ?? [client.first_name, client.last_name].filter(Boolean).join(' ').trim()
    ?? cleanText(client.email)
}

function buildContractReference(contractId: string, generatedAt: string): string {
  const ymd = generatedAt.slice(0, 10).replace(/-/g, '')
  return `CTR-${ymd}-${contractId.slice(0, 8).toUpperCase()}`
}

function escHtml(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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

async function resolveContractTemplate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  templateKey: string,
): Promise<ContractTemplate | null> {
  const builtin = getContractTemplate(templateKey)
  if (builtin) return builtin

  if (!templateKey.startsWith('custom:')) return null
  const templateId = templateKey.replace('custom:', '')
  const { data, error } = await supabase
    .from('contract_templates')
    .select('id, contract_type, title, trade, clauses, custom_sections')
    .eq('id', templateId)
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .single()

  if (error || !data) return null
  return {
    key: `custom:${data.id}`,
    title: data.title,
    type: data.contract_type,
    trade: data.trade ?? 'personnalise',
    clauses: data.clauses,
    customSections: normalizeCustomSections(data.custom_sections),
    isCustom: true,
  }
}

async function ensureClientBelongsToOrg(supabase: Awaited<ReturnType<typeof createClient>>, clientId: string | null | undefined, orgId: string) {
  if (!clientId) return null
  const { data } = await supabase
    .from('clients')
    .select('id, company_name, contact_name, first_name, last_name, email, phone, address_line1, postal_code, city')
    .eq('id', clientId)
    .eq('organization_id', orgId)
    .single()
  return data ?? null
}

async function ensureChantierBelongsToOrg(supabase: Awaited<ReturnType<typeof createClient>>, chantierId: string | null | undefined, orgId: string) {
  if (!chantierId) return null
  const { data } = await supabase
    .from('chantiers')
    .select('id, title, address_line1, postal_code, city, start_date, estimated_end_date, budget_ht')
    .eq('id', chantierId)
    .eq('organization_id', orgId)
    .single()
  return data ?? null
}

async function buildPdfSnapshot(contractId: string, orgId: string) {
  const supabase = await createClient()
  const { data: contract, error } = await supabase
    .from('contracts')
    .select(`
      id, title, contract_type, role, status, counterparty_name, counterparty_email,
      counterparty_phone, counterparty_address, template_key, template_title, clauses,
      custom_sections, duration_text, pdf_reference, pdf_generated_at, sent_at, signed_at,
      client_signature_image, client_signatory_name, client_signed_at, created_at,
      client:clients(id, type, company_name, contact_name, first_name, last_name, email, phone, address_line1, postal_code, city, siret, siren, vat_number),
      chantier:chantiers(id, title, address_line1, postal_code, city, start_date, estimated_end_date, budget_ht)
    `)
    .eq('id', contractId)
    .eq('organization_id', orgId)
    .single()

  if (error) {
    console.error('[buildPdfSnapshot]', error)
    if (error.message.includes('custom_sections')) {
      throw new Error('La migration 082_contract_custom_sections.sql doit être appliquée avant de générer ce PDF.')
    }
    throw new Error(`Erreur lors du chargement du contrat : ${error.message}`)
  }
  if (!contract) return null

  const org = await getOrganization()
  const template = await resolveContractTemplate(supabase, orgId, contract.template_key)
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
  const reference = contract.pdf_reference ?? buildContractReference(contract.id, generatedAt)
  const logoDataUrl = await fetchLogoAsDataUrl(org?.logo_url)

  return {
    generatedAt,
    reference,
    disclaimer: CONTRACT_DISCLAIMER,
    contract: {
      id: contract.id,
      title: contract.title,
      type: contract.contract_type,
      role: contract.role,
      status: contract.status,
      templateKey: contract.template_key,
      templateTitle: contract.template_title,
      createdAt: contract.created_at,
      sentAt: (contract as any).sent_at ?? null,
      signedAt: (contract as any).signed_at ?? null,
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
      name: contract.counterparty_name,
      email: contract.counterparty_email,
      phone: contract.counterparty_phone,
      address: contract.counterparty_address,
      client: Array.isArray(contract.client) ? contract.client[0] ?? null : contract.client ?? null,
      signature_image: (contract as any).client_signature_image ?? null,
      signatory_name: (contract as any).client_signatory_name ?? null,
      signed_at: (contract as any).client_signed_at ?? null,
    },
    chantier: Array.isArray(contract.chantier) ? contract.chantier[0] ?? null : contract.chantier ?? null,
  }
}

export async function createContract(input: CreateContractInput): Promise<{ contractId: string | null; error: string | null }> {
  if (!await hasPermission('contracts.create')) return { contractId: null, error: 'Action non autorisée.' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { contractId: null, error: 'Non authentifié.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { contractId: null, error: 'Organisation introuvable.' }

  const template = await resolveContractTemplate(supabase, orgId, input.templateKey)
  if (!template || template.type !== input.contractType) {
    return { contractId: null, error: 'Modèle de contrat invalide.' }
  }

  const client = await ensureClientBelongsToOrg(supabase, input.clientId, orgId)
  if (input.clientId && !client) return { contractId: null, error: 'Client introuvable.' }

  const chantier = await ensureChantierBelongsToOrg(supabase, input.chantierId, orgId)
  if (input.chantierId && !chantier) return { contractId: null, error: 'Chantier introuvable.' }

  const counterpartyName = cleanText(input.counterpartyName) ?? displayClientName(client)
  if (!counterpartyName) return { contractId: null, error: 'Le nom de la partie contractante est requis.' }

  const title = cleanText(input.title) ?? template.title
  // Vérifier que le devis appartient bien à l'org et au client si fourni
  if (input.quoteId) {
    const { data: quote } = await supabase
      .from('quotes')
      .select('id, client_id')
      .eq('id', input.quoteId)
      .eq('organization_id', orgId)
      .single()
    if (!quote) return { contractId: null, error: 'Devis introuvable.' }
  }

  const { data, error } = await supabase
    .from('contracts')
    .insert({
      organization_id: orgId,
      client_id: input.clientId || null,
      chantier_id: input.chantierId || null,
      quote_id: input.quoteId || null,
      contract_type: input.contractType,
      role: input.role,
      title,
      counterparty_name: counterpartyName,
      counterparty_email: cleanText(input.counterpartyEmail) ?? client?.email ?? null,
      counterparty_phone: cleanText(input.counterpartyPhone) ?? client?.phone ?? null,
      counterparty_address: cleanText(input.counterpartyAddress)
        ?? [client?.address_line1, client?.postal_code, client?.city].filter(Boolean).join(', ')
        ?? null,
      template_key: template.key,
      template_title: template.title,
      clauses: normalizeClauses(input.clauses, template.clauses),
      custom_sections: normalizeCustomSections(input.customSections),
      duration_text: cleanText(input.durationText),
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createContract]', error)
    if (error.code === '42P01') {
      return { contractId: null, error: "La table des contrats n'existe pas encore. Applique la migration Supabase 080_contracts_mvp.sql puis réessaie." }
    }
    if (error.code === '42501' || error.message.toLowerCase().includes('row-level security')) {
      return { contractId: null, error: "Création refusée par les règles de sécurité. Vérifie que les permissions contrats ont bien été appliquées à ton rôle." }
    }
    if (error.message.includes('custom_sections')) {
      return { contractId: null, error: 'La migration 082_contract_custom_sections.sql doit être appliquée avant de créer des contrats avec cette version.' }
    }
    return { contractId: null, error: `Erreur lors de la création du contrat : ${error.message}` }
  }

  revalidatePath('/contracts')
  return { contractId: data.id, error: null }
}

export async function updateContract(contractId: string, input: UpdateContractInput): Promise<Result> {
  if (!await hasPermission('contracts.edit')) return { error: 'Action non autorisée.' }
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const { data: existing } = await supabase
    .from('contracts')
    .select('id, status, contract_type, template_key, clauses')
    .eq('id', contractId)
    .eq('organization_id', orgId)
    .single()

  if (!existing) return { error: 'Contrat introuvable.' }
  if (existing.status === 'archived') return { error: 'Un contrat archivé ne peut plus être modifié.' }

  const nextType = input.contractType ?? existing.contract_type as ContractType
  const template = input.templateKey
    ? await resolveContractTemplate(supabase, orgId, input.templateKey)
    : await resolveContractTemplate(supabase, orgId, existing.template_key)
  if (!template || template.type !== nextType) return { error: 'Modèle de contrat invalide.' }

  if (input.status) {
    const allowed = ALLOWED_STATUS_TRANSITIONS[existing.status as ContractStatus] ?? []
    if (!allowed.includes(input.status)) {
      return { error: `Transition impossible depuis le statut ${CONTRACT_STATUS_LABELS[existing.status as ContractStatus] ?? existing.status}.` }
    }
  }

  const contentChanged = [
    input.clientId,
    input.chantierId,
    input.quoteId,
    input.contractType,
    input.role,
    input.title,
    input.counterpartyName,
    input.counterpartyEmail,
    input.counterpartyPhone,
    input.counterpartyAddress,
    input.templateKey,
    input.clauses,
    input.customSections,
    input.durationText,
  ].some(value => value !== undefined)

  const { error } = await supabase
    .from('contracts')
    .update({
      ...(input.clientId !== undefined && { client_id: input.clientId || null }),
      ...(input.chantierId !== undefined && { chantier_id: input.chantierId || null }),
      ...(input.quoteId !== undefined && { quote_id: input.quoteId || null }),
      ...(input.contractType !== undefined && { contract_type: input.contractType }),
      ...(input.role !== undefined && { role: input.role }),
      ...(input.title !== undefined && { title: cleanText(input.title) ?? template.title }),
      ...(input.counterpartyName !== undefined && { counterparty_name: cleanText(input.counterpartyName) }),
      ...(input.counterpartyEmail !== undefined && { counterparty_email: cleanText(input.counterpartyEmail) }),
      ...(input.counterpartyPhone !== undefined && { counterparty_phone: cleanText(input.counterpartyPhone) }),
      ...(input.counterpartyAddress !== undefined && { counterparty_address: cleanText(input.counterpartyAddress) }),
      ...(input.templateKey !== undefined && { template_key: template.key, template_title: template.title }),
      ...(input.clauses !== undefined && { clauses: normalizeClauses(input.clauses, template.clauses) }),
      ...(input.customSections !== undefined && { custom_sections: normalizeCustomSections(input.customSections) }),
      ...(input.durationText !== undefined && { duration_text: cleanText(input.durationText) }),
      ...(contentChanged && { pdf_reference: null, pdf_generated_at: null, pdf_snapshot: null }),
      ...(input.status !== undefined && {
        status: input.status,
        sent_at: input.status === 'sent' ? new Date().toISOString() : undefined,
        signed_at: input.status === 'signed' ? new Date().toISOString() : undefined,
        archived_at: input.status === 'archived' ? new Date().toISOString() : undefined,
      }),
    })
    .eq('id', contractId)
    .eq('organization_id', orgId)

  if (error) {
    console.error('[updateContract]', error)
    if (error.message.includes('custom_sections')) {
      return { error: 'La migration 082_contract_custom_sections.sql doit être appliquée avant de modifier ce contrat.' }
    }
    return { error: 'Erreur lors de la mise à jour du contrat.' }
  }

  revalidatePath('/contracts')
  revalidatePath(`/contracts/${contractId}`)
  return { error: null }
}

export async function generateContractPdfSnapshot(contractId: string): Promise<Result> {
  if (!await hasPermission('contracts.edit')) return { error: 'Action non autorisée.' }
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  let snapshot
  try {
    snapshot = await buildPdfSnapshot(contractId, orgId)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Erreur lors de la génération du PDF.' }
  }
  if (!snapshot) return { error: 'Contrat introuvable.' }

  const { error } = await supabase
    .from('contracts')
    .update({
      pdf_reference: snapshot.reference,
      pdf_generated_at: snapshot.generatedAt,
      pdf_snapshot: snapshot,
    })
    .eq('id', contractId)
    .eq('organization_id', orgId)

  if (error) {
    console.error('[generateContractPdfSnapshot]', error)
    if (error.message.includes('custom_sections')) {
      return { error: 'La migration 082_contract_custom_sections.sql doit être appliquée avant de générer ce PDF.' }
    }
    return { error: 'Erreur lors de la génération du PDF.' }
  }

  revalidatePath('/contracts')
  revalidatePath(`/contracts/${contractId}`)
  return { error: null }
}

export async function sendContract(
  contractId: string,
  options?: { attachQuoteIds?: string[]; attachInvoiceIds?: string[] },
): Promise<Result> {
  if (!await hasPermission('contracts.edit')) return { error: 'Action non autorisée.' }
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const { data: contract, error: contractError } = await supabase
    .from('contracts')
    .select('id, title, status, counterparty_name, counterparty_email, pdf_reference, pdf_snapshot, signature_token, client_id')
    .eq('id', contractId)
    .eq('organization_id', orgId)
    .single()

  if (contractError || !contract) {
    console.error('[sendContract]', contractError)
    return { error: 'Contrat introuvable.' }
  }
  if (contract.status === 'archived') return { error: 'Un contrat archivé ne peut pas être envoyé.' }

  const recipient = cleanText(contract.counterparty_email)
  if (!recipient) return { error: "Aucune adresse e-mail n'est renseignée pour la partie contractante." }

  const organization = await getOrganization()
  if (!organization) return { error: 'Organisation introuvable.' }

  let pdfReference = contract.pdf_reference
  if (!contract.pdf_snapshot) {
    let snapshot
    try {
      snapshot = await buildPdfSnapshot(contractId, orgId)
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Erreur lors de la génération du PDF.' }
    }
    if (!snapshot) return { error: 'Contrat introuvable.' }
    pdfReference = snapshot.reference

    const { error } = await supabase
      .from('contracts')
      .update({
        pdf_reference: snapshot.reference,
        pdf_generated_at: snapshot.generatedAt,
        pdf_snapshot: snapshot,
      })
      .eq('id', contractId)
      .eq('organization_id', orgId)

    if (error) {
      console.error('[sendContract] snapshot update', error)
      return { error: 'Erreur lors de la génération du PDF.' }
    }
  }

  const rendered = await renderContractPdfBufferById(contractId, orgId)
  if (!rendered) return { error: 'Impossible de générer le PDF du contrat.' }

  // Pièces jointes additionnelles (devis / factures du client lié)
  const attachments: Array<{ filename: string; content: Buffer }> = [
    { filename: rendered.fileName, content: rendered.buffer },
  ]
  const extraDocLabels: string[] = []

  const clientId = (contract as any).client_id as string | null
  const attachQuoteIds = (options?.attachQuoteIds ?? []).filter(Boolean)
  const attachInvoiceIds = (options?.attachInvoiceIds ?? []).filter(Boolean)

  if (clientId && attachQuoteIds.length > 0) {
    const { data: ownedQuotes } = await supabase
      .from('quotes')
      .select('id, number')
      .eq('organization_id', orgId)
      .eq('client_id', clientId)
      .in('id', attachQuoteIds)
    for (const q of ownedQuotes ?? []) {
      const pdf = await renderQuotePdfBufferById(q.id, orgId).catch(() => null)
      if (pdf) {
        attachments.push({ filename: pdf.fileName, content: pdf.buffer })
        extraDocLabels.push(`devis ${q.number}`)
      }
    }
  }

  if (clientId && attachInvoiceIds.length > 0) {
    const { data: ownedInvoices } = await supabase
      .from('invoices')
      .select('id, number')
      .eq('organization_id', orgId)
      .eq('client_id', clientId)
      .in('id', attachInvoiceIds)
    for (const inv of ownedInvoices ?? []) {
      const pdf = await renderInvoicePdfBufferById(inv.id, orgId).catch(() => null)
      if (pdf) {
        attachments.push({ filename: pdf.fileName, content: pdf.buffer })
        extraDocLabels.push(`facture ${inv.number}`)
      }
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const signUrl = (contract as any).signature_token
    ? `${appUrl}/contrats/signer/${(contract as any).signature_token}`
    : null

  const reference = pdfReference ? ` ${pdfReference}` : ''
  const subject = `Votre contrat${reference} - ${organization.name}`
  const extrasParagraph = extraDocLabels.length > 0
    ? `<p>Vous trouverez également en pièce jointe : ${escHtml(extraDocLabels.join(', '))}.</p>`
    : ''
  const signCta = signUrl
    ? `
        <div style="margin:24px 0;text-align:center">
          <a href="${signUrl}" style="display:inline-block;background:#0a0a0a;color:#fff;padding:14px 28px;border-radius:10px;font-weight:bold;text-decoration:none;font-size:14px">Signer le contrat en ligne</a>
        </div>
        <p style="font-size:12px;color:#888">Vous pouvez aussi signer manuellement et nous renvoyer le PDF.</p>
      `
    : ''

  const html = `
    <div style="max-width:560px;margin:0 auto;font-family:sans-serif">
      <div style="background:#0a0a0a;padding:24px 32px;border-radius:12px 12px 0 0">
        <p style="color:white;font-weight:bold;margin:0;font-size:16px">${escHtml(organization.name)}</p>
      </div>
      <div style="background:white;padding:32px;border-radius:0 0 12px 12px;border:1px solid #eee;border-top:none;line-height:1.7;color:#333;font-size:14px">
        <p>Bonjour ${escHtml(contract.counterparty_name)},</p>
        <p>Veuillez trouver ci-joint : <strong>${escHtml(contract.title)}</strong>.</p>
        ${extrasParagraph}
        ${signCta}
        <p>Pour toute question, vous pouvez répondre directement à cet e-mail.</p>
        ${organization.email_signature ? `<p style="margin-top:24px;color:#555;white-space:pre-line">${escHtml(organization.email_signature)}</p>` : ''}
      </div>
    </div>
  `

  const mail = await sendEmail({
    organizationId: orgId,
    to: recipient,
    subject,
    html,
    attachments,
  })
  if (mail.error) return { error: mail.error }

  const { error } = await supabase
    .from('contracts')
    .update({
      status: contract.status === 'signed' ? 'signed' : 'sent',
      sent_at: new Date().toISOString(),
    })
    .eq('id', contractId)
    .eq('organization_id', orgId)

  if (error) {
    console.error('[sendContract] status update', error)
    return { error: "Le contrat a été envoyé, mais le statut n'a pas pu être mis à jour." }
  }

  revalidatePath('/contracts')
  revalidatePath(`/contracts/${contractId}`)
  return { error: null }
}

export async function deleteContract(contractId: string): Promise<Result> {
  if (!await hasPermission('contracts.delete')) return { error: 'Action non autorisée.' }
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const { error } = await supabase
    .from('contracts')
    .delete()
    .eq('id', contractId)
    .eq('organization_id', orgId)

  if (error) {
    console.error('[deleteContract]', error)
    return { error: 'Erreur lors de la suppression du contrat.' }
  }

  revalidatePath('/contracts')
  return { error: null }
}

export async function createContractTemplate(input: ContractTemplateInput): Promise<{ templateKey: string | null; error: string | null }> {
  if (!await hasPermission('contracts.create')) return { templateKey: null, error: 'Action non autorisée.' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { templateKey: null, error: 'Non authentifié.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { templateKey: null, error: 'Organisation introuvable.' }

  const title = cleanText(input.title)
  if (!title) return { templateKey: null, error: 'Le nom du template est requis.' }

  const fallback = getContractTemplate(input.contractType === 'maintenance' ? 'maintenance_generique' : 'sous_traitance_btp_generique')
  if (!fallback) return { templateKey: null, error: 'Modèle de référence introuvable.' }

  const { data, error } = await supabase
    .from('contract_templates')
    .insert({
      organization_id: orgId,
      contract_type: input.contractType,
      title,
      trade: 'personnalise',
      clauses: normalizeClauses(input.clauses, fallback.clauses),
      custom_sections: normalizeCustomSections(input.customSections),
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createContractTemplate]', error)
    if (error.code === '42P01') {
      return { templateKey: null, error: "La table des templates n'existe pas encore. Applique la migration Supabase 081_contract_templates.sql puis réessaie." }
    }
    if (error.message.includes('custom_sections')) {
      return { templateKey: null, error: 'La migration 082_contract_custom_sections.sql doit être appliquée avant de créer des templates avec sections.' }
    }
    return { templateKey: null, error: `Erreur lors de la création du template : ${error.message}` }
  }

  revalidatePath('/contracts')
  return { templateKey: `custom:${data.id}`, error: null }
}

export async function fetchClientDocsForAttachment(clientId: string) {
  const { getClientDocsForAttachment } = await import('@/lib/data/queries/contracts')
  return getClientDocsForAttachment(clientId)
}

export async function fetchClientContractsForAttachment(clientId: string) {
  const { getClientContractsForAttachment } = await import('@/lib/data/queries/contracts')
  return getClientContractsForAttachment(clientId)
}

export async function deleteContractTemplate(templateId: string): Promise<Result> {
  if (!await hasPermission('contracts.delete')) return { error: 'Action non autorisée.' }
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const { error } = await supabase
    .from('contract_templates')
    .delete()
    .eq('id', templateId)
    .eq('organization_id', orgId)

  if (error) {
    console.error('[deleteContractTemplate]', error)
    return { error: 'Erreur lors de la suppression du template.' }
  }

  revalidatePath('/contracts')
  return { error: null }
}

export async function createContractTemplateFromContract(contractId: string): Promise<{ templateKey: string | null; error: string | null }> {
  if (!await hasPermission('contracts.create')) return { templateKey: null, error: 'Action non autorisée.' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { templateKey: null, error: 'Non authentifié.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { templateKey: null, error: 'Organisation introuvable.' }

  const { data: contract, error: contractError } = await supabase
    .from('contracts')
    .select('id, title, contract_type, clauses, custom_sections')
    .eq('id', contractId)
    .eq('organization_id', orgId)
    .single()

  if (contractError || !contract) {
    console.error('[createContractTemplateFromContract]', contractError)
    if (contractError?.message?.includes('custom_sections')) {
      return { templateKey: null, error: 'La migration 082_contract_custom_sections.sql doit être appliquée avant de convertir un contrat en template.' }
    }
    return { templateKey: null, error: 'Contrat introuvable.' }
  }

  const fallback = getContractTemplate(contract.contract_type === 'maintenance' ? 'maintenance_generique' : 'sous_traitance_btp_generique')
  if (!fallback) return { templateKey: null, error: 'Modèle de référence introuvable.' }

  const templateTitle = `Template - ${cleanText(contract.title) ?? 'Contrat'}`
  const { data, error } = await supabase
    .from('contract_templates')
    .insert({
      organization_id: orgId,
      contract_type: contract.contract_type,
      title: templateTitle,
      trade: 'personnalise',
      clauses: normalizeClauses(contract.clauses, fallback.clauses),
      custom_sections: normalizeCustomSections(contract.custom_sections),
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createContractTemplateFromContract]', error)
    if (error.code === '42P01') {
      return { templateKey: null, error: "La table des templates n'existe pas encore. Applique la migration Supabase 081_contract_templates.sql puis réessaie." }
    }
    if (error.message.includes('custom_sections')) {
      return { templateKey: null, error: 'La migration 082_contract_custom_sections.sql doit être appliquée avant de convertir un contrat en template.' }
    }
    return { templateKey: null, error: `Erreur lors de la création du template : ${error.message}` }
  }

  revalidatePath('/contracts')
  return { templateKey: `custom:${data.id}`, error: null }
}
