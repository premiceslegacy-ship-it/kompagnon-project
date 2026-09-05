import Image from 'next/image'
import { redirect } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentMembershipContext } from '@/lib/data/queries/membership'
import { getOrganization } from '@/lib/data/queries/organization'
import { getOrganizationEntitlement } from '@/lib/data/queries/subscription-access'
import { getDisplayAccessStatus, hasActiveAccess } from '@/lib/subscription-access'
import { LegalFooter } from '@/components/legal/LegalFooter'
import { wordmarkForTheme } from '@/lib/brand'
import { ATELIER_PRICING } from '@/lib/pricing'
import { checkoutAction, exportDataAction, portalAction, startTrialAction } from './actions'
import { ActivationCheckoutStatus } from './ActivationCheckoutStatus'
import { CheckoutSubmitButton } from './CheckoutSubmitButton'
import { ActivationPlansCarousel } from './ActivationPlansCarousel'
import { getActivationState } from '@/lib/activation-state'
import styles from './activation.module.css'

const ERROR_MESSAGES: Record<string, string> = {
  trial_already_used: 'L’essai gratuit a déjà été utilisé pour cet email ou ce SIRET.',
  trial_activation_failed: 'Votre espace est prêt, mais son activation n’a pas abouti. Réessayez dans un instant.',
  checkout_failed: 'Le paiement sécurisé est momentanément indisponible. Aucun débit n’a été effectué.',
  portal_failed: 'Le portail de facturation est momentanément indisponible. Réessayez dans un instant ou contactez contact@orsayn.fr.',
  invalid_tier: 'Cette formule n’est pas disponible.',
  checkout_cancelled: 'Le checkout Stripe a été annulé. Aucun changement n’a été effectué sur votre accès.',
}

function buildSetupWhatsappUrl(baseUrl: string | undefined, companyName: string): string | null {
  if (!baseUrl?.trim()) return null
  try {
    const url = new URL(baseUrl.trim())
    url.searchParams.set('text', `Bonjour, je souhaite en savoir plus sur l’installation d’Atelier pour ${companyName}.`)
    return url.toString()
  } catch {
    return null
  }
}

export default async function ActivationPage({ searchParams }: { searchParams?: { error?: string; checkout?: string; export?: string } }) {
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
  const errorMessage = searchParams?.error ? ERROR_MESSAGES[searchParams.error] : null
  const setupWhatsappUrl = buildSetupWhatsappUrl(process.env.NEXT_PUBLIC_SETUP_WHATSAPP, companyName)

  const heroEyebrow = isUnpaid
    ? 'Action requise'
    : activationState.canStartTrial
      ? 'Votre espace est prêt'
      : 'Votre accès peut continuer'
  const heroDescription = isUnpaid
    ? 'Votre abonnement nécessite une régularisation. Mettez à jour votre moyen de paiement dans Stripe pour retrouver vos outils.'
    : activationState.canStartTrial
      ? 'Découvrez la formule Pro pendant 14 jours, puis choisissez le niveau qui correspond à votre entreprise.'
      : hasConsumedTrial
        ? 'Votre accès est en pause. Vos données, vos clients et vos habitudes restent là : choisissez votre formule pour reprendre sans ressaisie.'
        : 'Choisissez le niveau qui correspond à votre façon de travailler et gardez votre gestion sous contrôle.'

  return (
    <main className={styles.shell}>
      <div className={styles.container}>
        <header className={styles.header}>
          <Image src={wordmarkForTheme('light')} alt="Atelier" width={132} height={32} priority />
          <div className={styles.securePill}><ShieldCheck aria-hidden="true" /> Espace sécurisé</div>
        </header>

        <section className={styles.hero}>
          <div className={styles.heroContent}>
            <p className={styles.eyebrow}>{companyName} · {heroEyebrow}</p>
            <h1>{hasConsumedTrial ? <>Récupérez vos <em>soirées</em>.</> : <>Je récupère <em>10 h et 18 % de marge</em> chaque mois.</>}</h1>
            <p className={styles.heroLead}>{heroDescription}</p>

            {errorMessage && <p className={`${styles.notice} ${styles.noticeError}`}>{errorMessage}</p>}
            {searchParams?.export && <p className={styles.notice}>{searchParams.export === 'failed' ? 'L’export n’a pas pu être lancé.' : 'Votre export est en préparation. Vous recevrez le lien sécurisé par email.'}</p>}
            {activationState.checkoutCancelled && <p className={styles.notice}>Le checkout Stripe a été annulé. Aucun changement n’a été effectué sur votre accès.</p>}
            {activationState.checkoutPending && <ActivationCheckoutStatus active={false} />}

            {activationState.canStartTrial && (
              <form action={startTrialAction} className={styles.trialForm}>
                <CheckoutSubmitButton label="Activer 14 jours gratuitement" pendingLabel="Activation de votre accès…" featured />
                <p className={styles.trialNote}>Sans carte bancaire. Vous choisirez ensuite de continuer ou non.</p>
              </form>
            )}
            {activationState.showPortal && <form action={portalAction} className={styles.trialForm}><CheckoutSubmitButton label="Régulariser dans Stripe" featured /></form>}
            {membership.roleSlug !== 'owner' && <p className={styles.heroLead}>Seul le dirigeant du compte peut choisir une formule pour toute l’équipe.</p>}
          </div>
        </section>

        {activationState.showPlans && (
          <ActivationPlansCarousel
            checkoutAction={checkoutAction}
            trialAvailable={activationState.canStartTrial}
            startTrialAction={startTrialAction}
            setupAmount={ATELIER_PRICING.setup.amountEur}
            setupWhatsappUrl={setupWhatsappUrl}
          />
        )}

        <footer className={styles.footer}>
          {membership.roleSlug === 'owner' && <form action={exportDataAction}><button className={styles.footerExport}>Exporter toutes mes données</button></form>}
          <LegalFooter tone="light" />
        </footer>
      </div>
    </main>
  )
}
