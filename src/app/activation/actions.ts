'use server'

import { redirect } from 'next/navigation'
import {
  activateTrialForCurrentOrganization,
  createSelfServiceCheckout,
} from '@/lib/data/mutations/subscription-self-service'
import { createOrganizationExport } from '@/lib/data/mutations/organization-exports'
import { createStripePortalSession } from '@/lib/data/mutations/stripe-portal'
import { isSellableTier } from '@/lib/subscription-access'

export async function startTrialAction() {
  const result = await activateTrialForCurrentOrganization()
  if ('error' in result) {
    const code = result.error === 'trial_already_used' ? 'trial_already_used' : 'trial_activation_failed'
    redirect(`/activation?error=${code}`)
  }
  redirect('/dashboard?welcome=trial')
}

export async function checkoutAction(formData: FormData) {
  const tier = formData.get('tier')
  if (!isSellableTier(tier)) redirect('/activation?error=invalid_tier')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const result = await createSelfServiceCheckout(tier, `${appUrl}/activation?checkout=success`)
  if ('error' in result) redirect('/activation?error=checkout_failed')
  redirect(result.url)
}

export async function portalAction() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const result = await createStripePortalSession(`${appUrl}/activation?portal=return`)
  if ('error' in result) redirect(`/activation?error=portal_failed`)
  redirect(result.url)
}

export async function exportDataAction() {
  const result = await createOrganizationExport()
  redirect(`/activation?export=${result.error ? 'failed' : result.warning ? 'warning' : 'started'}`)
}
