'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'

export type AuthorizedContact = {
  number: string
  label: string
}

export type WhatsAppConfig = {
  id: string
  phone_number_id: string | null
  waba_id: string | null
  access_token: string | null
  verify_token: string
  authorized_numbers: string[]
  authorized_contacts: AuthorizedContact[]
  use_shared_waba: boolean
  is_active: boolean
}

export async function getWhatsAppConfig(): Promise<WhatsAppConfig | null> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return null

  const { data } = await supabase
    .from('whatsapp_configs')
    .select('id, phone_number_id, waba_id, access_token, verify_token, authorized_numbers, authorized_contacts, use_shared_waba, is_active')
    .eq('organization_id', orgId)
    .single()

  if (!data) return null

  return {
    ...data,
    authorized_contacts: (data.authorized_contacts as AuthorizedContact[] | null) ?? [],
    use_shared_waba: data.use_shared_waba ?? false,
  }
}

export async function saveWhatsAppConfig(data: {
  phoneNumberId?: string
  wabaId?: string
  accessToken?: string
  verifyToken: string
  authorizedNumbers: string[]
  authorizedContacts: AuthorizedContact[]
  useSharedWaba: boolean
  isActive: boolean
}): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const payload: Record<string, unknown> = {
    organization_id: orgId,
    verify_token: data.verifyToken.trim(),
    authorized_numbers: data.authorizedNumbers.filter(n => n.trim()),
    authorized_contacts: data.authorizedContacts.filter(c => c.number.trim()),
    use_shared_waba: data.useSharedWaba,
    is_active: data.isActive,
  }

  if (!data.useSharedWaba) {
    payload.phone_number_id = data.phoneNumberId?.trim() ?? null
    payload.waba_id = data.wabaId?.trim() || null
    payload.access_token = data.accessToken?.trim() ?? null
  }

  const { error } = await supabase
    .from('whatsapp_configs')
    .upsert(payload, { onConflict: 'organization_id' })

  if (error) return { error: error.message }

  revalidatePath('/settings')
  return { error: null }
}

export async function deleteWhatsAppConfig(): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const { error } = await supabase
    .from('whatsapp_configs')
    .delete()
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

  revalidatePath('/settings')
  return { error: null }
}
