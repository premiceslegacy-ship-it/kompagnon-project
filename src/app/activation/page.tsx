// @atelier-migrated
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembershipContext } from '@/lib/data/queries/membership'
import { getOrganization } from '@/lib/data/queries/organization'
import { getOrganizationEntitlement } from '@/lib/data/queries/subscription-access'
import { getDisplayAccessStatus, hasActiveAccess } from '@/lib/subscription-access'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { AuthCenter, AuthLink, AuthTextSubmit } from '@/components/auth/AuthParts'
import { ATELIER_PRICING } from '@/lib/pricing'
import { checkoutAction, exportDataAction, portalAction, startTrialAction } from './actions'
import { getActivationState } from '@/lib/activation-state'
import ActivationView from './ActivationView'
import {
  ACTIVATION_ERRORS,
  CHECKOUT_CANCELLED_NOTICE,
  activationMood,
  exportNotice,
  setupWhatsappUrl,
} from './activationModel'

export default async function ActivationPage({ searchParams: searchParamsPromise }: { searchParams: Promise<{ error?: string; checkout?: string; export?: string }> }) {
  const searchParams = await searchParamsPromise
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [membership, organization, entitlement] = await Promise.all([
    getCurrentMembershipContext(),
    getOrganization(),
    getOrganizationEntitlement(),
  ])
  if (!membership) redirect('/onboarding')
  if (hasActiveAccess(entitlement)) redirect('/dashboard')
  if (entitlement?.billingModel === 'setup') {
    return (
      <AuthLayout
        title="Votre accès Atelier est suspendu"
        subtitle={`L’accès de ${organization?.name || 'votre entreprise'} doit être vérifié avec Orsayn. Votre achat setup reste enregistré : aucun nouvel achat ni abonnement n’est demandé.`}
      >
        <AuthCenter>
          <AuthLink href="mailto:contact@orsayn.fr">Contacter Orsayn pour vérifier mon accès</AuthLink>
        </AuthCenter>
        {membership.roleSlug === 'owner' && (
          <AuthCenter>
            <form action={exportDataAction}>
              <AuthTextSubmit>Exporter toutes mes données</AuthTextSubmit>
            </form>
          </AuthCenter>
        )}
      </AuthLayout>
    )
  }

  const status = entitlement ? getDisplayAccessStatus(entitlement) : 'locked'
  const activationState = getActivationState({
    role: membership.roleSlug,
    status,
    trialStarted: Boolean(entitlement?.trialStartedAt),
    checkout: searchParams?.checkout,
  })
  const isUnpaid = status === 'unpaid'
  const hasConsumedTrial = Boolean(entitlement?.trialStartedAt) && !activationState.canStartTrial
  const companyName = organization?.name || 'votre entreprise'

  return (
    <ActivationView
      mood={activationMood({ isUnpaid, canStartTrial: activationState.canStartTrial, hasConsumedTrial })}
      isOwner={membership.roleSlug === 'owner'}
      canStartTrial={activationState.canStartTrial}
      showPortal={activationState.showPortal}
      showPlans={activationState.showPlans}
      checkoutPending={activationState.checkoutPending}
      checkoutCancelled={activationState.checkoutCancelled}
      errorMessage={searchParams?.error ? ACTIVATION_ERRORS[searchParams.error] ?? null : null}
      exportMessage={exportNotice(searchParams?.export)}
      cancelledMessage={CHECKOUT_CANCELLED_NOTICE}
      preferredTier={entitlement?.preferredTier ?? 'pro'}
      setupAmount={ATELIER_PRICING.setup.amountEur}
      setupWhatsappUrl={setupWhatsappUrl(process.env.NEXT_PUBLIC_SETUP_WHATSAPP, companyName)}
      startTrialAction={startTrialAction}
      checkoutAction={checkoutAction}
      portalAction={portalAction}
      exportDataAction={exportDataAction}
    />
  )
}
