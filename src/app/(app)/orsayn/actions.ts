'use server'

import { revalidatePath } from 'next/cache'
import { getOperatorUser } from '@/lib/operator-auth'
import { createOperatorAdminClient } from '@/lib/supabase/operator'

const SUPPORTED_BILLING_CURRENCIES = new Set(['EUR', 'USD'])

function parseMonthlyFee(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string') return null

  const normalized = value.replace(',', '.').trim()
  if (!normalized) return null

  const parsed = Number.parseFloat(normalized)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('Montant mensuel invalide')
  }

  return Math.round(parsed * 100) / 100
}

export async function upsertOperatorClientSettings(formData: FormData) {
  const user = await getOperatorUser()
  if (!user) {
    throw new Error('Accès opérateur requis')
  }

  const sourceInstance = String(formData.get('sourceInstance') ?? '').trim()
  if (!sourceInstance) {
    throw new Error('source_instance requis')
  }

  const labelRaw = String(formData.get('label') ?? '').trim()
  const billingCurrency = String(formData.get('billingCurrency') ?? 'EUR').trim().toUpperCase()

  if (!SUPPORTED_BILLING_CURRENCIES.has(billingCurrency)) {
    throw new Error('Devise non supportée')
  }

  const operator = createOperatorAdminClient()
  const { error } = await operator
    .from('operator_client_settings')
    .upsert({
      source_instance: sourceInstance,
      label: labelRaw || null,
      monthly_fee_ht: parseMonthlyFee(formData.get('monthlyFeeHt')),
      billing_currency: billingCurrency,
      is_active: formData.get('isActive') === 'on',
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'source_instance',
    })

  if (error) {
    console.error('[upsertOperatorClientSettings]', error)
    throw new Error(error.message)
  }

  revalidatePath('/orsayn')
}
