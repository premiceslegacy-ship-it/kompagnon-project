'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'

export type WhatsAppConfig = {
  id: string
  phone_number_id: string
  waba_id: string | null
  access_token: string
  verify_token: string
  authorized_numbers: string[]
  is_active: boolean
}

export async function getWhatsAppConfig(): Promise<WhatsAppConfig | null> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return null

  const { data } = await supabase
    .from('whatsapp_configs')
    .select('id, phone_number_id, waba_id, access_token, verify_token, authorized_numbers, is_active')
    .eq('organization_id', orgId)
    .single()

  return data ?? null
}

export async function saveWhatsAppConfig(data: {
  phoneNumberId: string
  wabaId?: string
  accessToken: string
  verifyToken: string
  authorizedNumbers: string[]
  isActive: boolean
}): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const payload = {
    organization_id: orgId,
    phone_number_id: data.phoneNumberId.trim(),
    waba_id: data.wabaId?.trim() || null,
    access_token: data.accessToken.trim(),
    verify_token: data.verifyToken.trim(),
    authorized_numbers: data.authorizedNumbers.filter(n => n.trim()),
    is_active: data.isActive,
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
