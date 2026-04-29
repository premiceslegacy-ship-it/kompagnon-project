'use server'

import { revalidatePath } from 'next/cache'
import { createClient as createSupabaseClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import { CreateClientInlineSchema } from '@/lib/validations/clients'

// ─── Create Client (status: active) ──────────────────────────────────────────

export type CreateClientState = {
  error: string | null
  success: boolean
}

export async function createClient(
  _prevState: CreateClientState,
  formData: FormData,
): Promise<CreateClientState> {
  if (!(await hasPermission('clients.create'))) return { error: 'Permission refusée.', success: false }

  const supabase = await createSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Vous devez être connecté pour effectuer cette action.', success: false }

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { error: 'Aucune organisation trouvée.', success: false }

  const clientType  = ((formData.get('type') as string)?.trim() || 'company') as 'company' | 'individual'
  const companyName = (formData.get('company_name') as string)?.trim() || null
  const contactName = (formData.get('contact_name') as string)?.trim() || null
  const firstName   = (formData.get('first_name') as string)?.trim() || null
  const lastName    = (formData.get('last_name') as string)?.trim() || null
  const status      = (formData.get('status') as string)?.trim() || 'active'
  const source      = (formData.get('source') as string)?.trim() || null

  if (clientType === 'company' && !companyName) {
    return { error: 'La raison sociale est requise pour un professionnel.', success: false }
  }
  if (clientType === 'individual' && !lastName && !firstName) {
    return { error: 'Le nom ou prénom est requis pour un particulier.', success: false }
  }

  const email              = (formData.get('email') as string)?.trim() || null
  const phone              = (formData.get('phone') as string)?.trim() || null
  const siret              = (formData.get('siret') as string)?.trim() || null
  const addressLine1       = (formData.get('address_line1') as string)?.trim() || null
  const paymentTermsDays   = parseInt(formData.get('payment_terms_days') as string) || 30
  const currency           = (formData.get('currency') as string)?.trim() || 'EUR'
  const locale             = (formData.get('locale') as string)?.trim() || 'fr'

  const { error } = await supabase.from('clients').insert({
    organization_id: organizationId,
    company_name:    companyName,
    contact_name:    contactName,
    first_name:      firstName,
    last_name:       lastName,
    email,
    phone,
    siret,
    address_line1:   addressLine1,
    payment_terms_days: paymentTermsDays,
    currency,
    locale,
    source,
    type:       clientType,
    status,
    created_by: user.id,
  })

  if (error) {
    console.error('[createClient]', error)
    return { error: 'Une erreur est survenue lors de la création.', success: false }
  }

  revalidatePath('/clients')
  return { error: null, success: true }
}

// ─── Create Client Inline (retourne l'ID pour usage dans les éditeurs) ────────

export type CreateClientInlineInput = {
  type: 'company' | 'individual'
  company_name?: string
  contact_name?: string
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
  address_line1?: string
  postal_code?: string
  city?: string
}

export async function createClientInline(
  data: CreateClientInlineInput,
): Promise<{ error: string | null; id: string | null }> {
  if (!(await hasPermission('clients.create'))) return { error: 'Permission refusée.', id: null }

  const parsed = CreateClientInlineSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Données invalides.', id: null }

  const supabase = await createSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.', id: null }

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { error: 'Organisation introuvable.', id: null }

  const companyName = data.company_name?.trim() || null
  const firstName   = data.first_name?.trim() || null
  const lastName    = data.last_name?.trim() || null

  const { data: row, error } = await supabase
    .from('clients')
    .insert({
      organization_id: organizationId,
      type: data.type,
      company_name: companyName,
      contact_name: data.contact_name?.trim() || null,
      first_name: firstName,
      last_name: lastName,
      email: data.email?.trim() || null,
      phone: data.phone?.trim() || null,
      address_line1: data.address_line1?.trim() || null,
      postal_code: data.postal_code?.trim() || null,
      city: data.city?.trim() || null,
      status: 'active',
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[createClientInline]', error)
    return { error: 'Erreur lors de la création du client.', id: null }
  }

  revalidatePath('/clients')
  return { error: null, id: row.id }
}

// ─── Update ───────────────────────────────────────────────────────────────────

export type UpdateClientState = {
  error: string | null
  success: boolean
}

export async function updateClient(
  _prevState: UpdateClientState,
  formData: FormData,
): Promise<UpdateClientState> {
  if (!(await hasPermission('clients.edit'))) return { error: 'Permission refusée.', success: false }

  const supabase = await createSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.', success: false }

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { error: 'Organisation introuvable.', success: false }

  const clientId = (formData.get('client_id') as string)?.trim()
  if (!clientId) return { error: 'Client introuvable.', success: false }

  const clientType  = ((formData.get('type') as string)?.trim() || 'company') as 'company' | 'individual'
  const companyName = (formData.get('company_name') as string)?.trim() || null
  const contactName = (formData.get('contact_name') as string)?.trim() || null
  const firstName   = (formData.get('first_name') as string)?.trim() || null
  const lastName    = (formData.get('last_name') as string)?.trim() || null

  if (clientType === 'company' && !companyName) {
    return { error: 'La raison sociale est requise pour un professionnel.', success: false }
  }
  if (clientType === 'individual' && !lastName && !firstName) {
    return { error: 'Le nom ou prénom est requis pour un particulier.', success: false }
  }

  const email              = (formData.get('email') as string)?.trim() || null
  const phone              = (formData.get('phone') as string)?.trim() || null
  const siret              = clientType === 'company' ? ((formData.get('siret') as string)?.trim() || null) : null
  const addressLine1       = (formData.get('address_line1') as string)?.trim() || null
  const paymentTermsDays   = parseInt(formData.get('payment_terms_days') as string) || 30
  const status             = (formData.get('status') as string)?.trim() || 'active'
  const source             = (formData.get('source') as string)?.trim() || null
  const currency           = (formData.get('currency') as string)?.trim() || 'EUR'
  const locale             = (formData.get('locale') as string)?.trim() || 'fr'

  const { error } = await supabase
    .from('clients')
    .update({
      type:            clientType,
      company_name:    clientType === 'company' ? companyName : null,
      contact_name:     clientType === 'company' ? contactName : null,
      first_name:      firstName,
      last_name:       lastName,
      email, phone, siret,
      address_line1:   addressLine1,
      payment_terms_days: paymentTermsDays,
      status, source, currency, locale,
    })
    .eq('id', clientId)
    .eq('organization_id', organizationId)

  if (error) {
    console.error('[updateClient]', error)
    return { error: 'Erreur lors de la mise à jour du client.', success: false }
  }

  revalidatePath('/clients')
  revalidatePath(`/clients/${clientId}`)
  return { error: null, success: true }
}

// ─── Conversion lead → prospect → client ─────────────────────────────────────

export async function convertToProspect(clientId: string): Promise<{ error: string | null }> {
  if (!(await hasPermission('clients.edit'))) return { error: 'Permission refusée.' }

  const supabase = await createSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { error: 'Organisation introuvable.' }

  const { error } = await supabase
    .from('clients')
    .update({ status: 'prospect' })
    .eq('id', clientId)
    .eq('organization_id', organizationId)
    .in('status', ['lead_hot', 'lead_cold'])

  if (error) {
    console.error('[convertToProspect]', error)
    return { error: 'Erreur lors de la conversion en prospect.' }
  }

  revalidatePath('/clients')
  return { error: null }
}

export async function convertToClient(clientId: string): Promise<{ error: string | null }> {
  if (!(await hasPermission('clients.edit'))) return { error: 'Permission refusée.' }

  const supabase = await createSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { error: 'Organisation introuvable.' }

  const { error } = await supabase
    .from('clients')
    .update({ status: 'active' })
    .eq('id', clientId)
    .eq('organization_id', organizationId)

  if (error) {
    console.error('[convertToClient]', error)
    return { error: 'Erreur lors de la conversion en client.' }
  }

  revalidatePath('/clients')
  return { error: null }
}

// ─── Delete (soft) ────────────────────────────────────────────────────────────

export async function deleteClient(clientId: string): Promise<{ error: string | null }> {
  if (!(await hasPermission('clients.delete'))) return { error: 'Permission refusée.' }

  const supabase = await createSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { error: 'Organisation introuvable.' }

  const { error } = await supabase
    .from('clients')
    .update({ is_archived: true })
    .eq('id', clientId)
    .eq('organization_id', organizationId)

  if (error) {
    console.error('[deleteClient]', error)
    return { error: 'Erreur lors de la suppression du client.' }
  }

  revalidatePath('/clients')
  return { error: null }
}

// ─── Import CSV ───────────────────────────────────────────────────────────────

export type ImportClientsState = {
  error: string | null
  imported: number
  skipped: number
}

export async function importClients(
  _prevState: ImportClientsState,
  formData: FormData,
): Promise<ImportClientsState> {
  if (!(await hasPermission('import.clients'))) return { error: 'Permission refusée.', imported: 0, skipped: 0 }

  const supabase = await createSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.', imported: 0, skipped: 0 }

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { error: 'Organisation introuvable.', imported: 0, skipped: 0 }

  const rawData = formData.get('clients_json') as string
  if (!rawData) return { error: 'Aucune donnée à importer.', imported: 0, skipped: 0 }

  let rows: Record<string, string>[]
  try { rows = JSON.parse(rawData) } catch {
    return { error: 'Format de données invalide.', imported: 0, skipped: 0 }
  }

  const validStatuses = ['active', 'prospect', 'lead_hot', 'lead_cold', 'inactive']

  const toInsert = rows
    .filter(row => row.company_name?.trim() || row.last_name?.trim() || row.first_name?.trim())
    .map(row => {
      const companyName = row.company_name?.trim() || null
      const rawStatus   = row.status?.trim().toLowerCase()
      const status      = validStatuses.includes(rawStatus) ? rawStatus : 'lead_cold'
      return {
        organization_id:    organizationId,
        company_name:       companyName,
        first_name:         row.first_name?.trim() || null,
        last_name:          row.last_name?.trim() || null,
        email:              row.email?.trim() || null,
        phone:              row.phone?.trim() || null,
        address_line1:      row.address_line1?.trim() || null,
        postal_code:        row.postal_code?.trim() || null,
        city:               row.city?.trim() || null,
        siret:              row.siret?.replace(/\s/g, '').trim() || null,
        siren:              row.siren?.replace(/\s/g, '').trim() || null,
        vat_number:         row.vat_number?.trim() || null,
        payment_terms_days: parseInt(row.payment_terms_days) || 30,
        notes:              row.notes?.trim() || null,
        source:             row.source?.trim() || null,
        type:               companyName ? 'company' : 'individual',
        status,
        created_by: user.id,
      }
    })

  const skipped = rows.length - toInsert.length
  if (toInsert.length === 0) {
    return { error: 'Aucun contact valide à importer (Entreprise ou Nom requis).', imported: 0, skipped }
  }

  const { error } = await supabase.from('clients').insert(toInsert)
  if (error) {
    console.error('[importClients]', error)
    return { error: "Erreur lors de l'import en base de données.", imported: 0, skipped }
  }

  revalidatePath('/clients')
  return { error: null, imported: toInsert.length, skipped }
}
