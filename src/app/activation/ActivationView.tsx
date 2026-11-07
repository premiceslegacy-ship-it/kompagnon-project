// @atelier-migrated
// Activation : essai, formules et mise en place (voir page.tsx pour les droits d'accès).

import { Check, CheckCircle2 } from 'lucide-react'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { AuthNotice, AuthSubmit, AuthTextSubmit } from '@/components/auth/AuthParts'
import {
  PLAN_COPY, PLAN_ORDER, formatSetupAmount, planAction, planBadge, planCtaLabel, planFootnote,
  type ActivationMood, type Tier,
} from './activationModel'
import { ActivationCheckoutStatus } from './ActivationCheckoutStatus'
import { activationHeading } from './activationModel'
import { StatusPill } from '@/components/ui/StatusPill'
import styles from './Activation.module.css'

type ServerAction = (formData: FormData) => void | Promise<void>

export type ActivationViewProps = {
  mood: ActivationMood
  isOwner: boolean
  canStartTrial: boolean
  showPortal: boolean
  showPlans: boolean
  checkoutPending: boolean
  checkoutCancelled: boolean
  errorMessage: string | null
  exportMessage: string | null
  cancelledMessage: string
  preferredTier: Tier
  setupAmount: number
  setupWhatsappUrl: string | null
  startTrialAction: ServerAction
  checkoutAction: ServerAction
  portalAction: ServerAction
  exportDataAction: ServerAction
}

export default function ActivationView(props: ActivationViewProps) {
  const heading = activationHeading(props.mood)
  return (
    <AuthLayout size="wide" title={heading.title} subtitle={heading.description}>
      <div className={styles.hero}>
        {props.errorMessage && <AuthNotice tone="error">{props.errorMessage}</AuthNotice>}
        {props.exportMessage && <AuthNotice>{props.exportMessage}</AuthNotice>}
        {props.checkoutCancelled && <AuthNotice>{props.cancelledMessage}</AuthNotice>}
        {props.checkoutPending && <ActivationCheckoutStatus active={false} />}

        {props.canStartTrial && (
          <form action={props.startTrialAction}>
            <AuthSubmit pendingLabel="Activation de votre accès…">Activer 7 jours gratuitement</AuthSubmit>
            <p className={styles.heroNote}>Sans carte bancaire. Vous choisirez ensuite de continuer ou non.</p>
          </form>
        )}
        {props.showPortal && (
          <form action={props.portalAction}>
            <AuthSubmit pendingLabel="Ouverture de Stripe…">Régulariser dans Stripe</AuthSubmit>
          </form>
        )}
        {!props.isOwner && <p className={styles.heroNote}>Seul le dirigeant du compte peut choisir une formule pour toute l’équipe.</p>}
        {props.mood === 'ended' && props.isOwner && (
          <>
            <p className={styles.status}>
              <CheckCircle2 size={20} aria-hidden="true" />
              Essai terminé, aucun débit
            </p>
            <p className={styles.heroNote}>Données et documents conservés. Reprise immédiate, sans ressaisie.</p>
          </>
        )}
      </div>

      {props.showPlans && (
        <>
          <h2 className={styles.sectionTitle} id="activation-plans-title">
            Les formules
          </h2>
          <div className={styles.plans} aria-labelledby="activation-plans-title" role="group">
            {PLAN_ORDER.map((tier) => (
              <PlanCard key={tier} tier={tier} props={props} />
            ))}
          </div>
          <SetupCard amount={props.setupAmount} whatsappUrl={props.setupWhatsappUrl} />
        </>
      )}

      <div className={styles.footer}>
        {props.isOwner && (
          <form action={props.exportDataAction}>
            <AuthTextSubmit>Exporter toutes mes données</AuthTextSubmit>
          </form>
        )}
      </div>
    </AuthLayout>
  )
}

function PlanCard({ tier, props }: { tier: Tier; props: ActivationViewProps }) {
  const plan = PLAN_COPY[tier]
  const trial = props.canStartTrial
  const badge = planBadge(tier, trial, props.preferredTier)
  const isTrial = planAction(tier, trial) === 'trial'
  return (
    <section className={styles.plan} data-featured={badge ? true : undefined} aria-label={`Formule ${plan.name}`}>
      <div className={styles.planHead}>
        <h3 className={styles.planName}>{plan.name}</h3>
        {badge && <StatusPill status="success">{badge}</StatusPill>}
      </div>
      <p className={styles.price}>
        <b>{plan.price} €</b>
        <span>HT par mois</span>
      </p>
      <p className={styles.promise}>{plan.promise}</p>
      <p className={styles.audience}>{plan.audience}</p>
      <ul className={styles.benefits}>
        {plan.benefits.map((benefit) => (
          <li key={benefit}>
            <Check size={16} aria-hidden="true" />
            <span>{benefit}</span>
          </li>
        ))}
      </ul>
      <ul className={styles.quotas} aria-label="Quotas mensuels">
        {plan.quotas.map((quota) => (
          <li key={quota}>{quota}</li>
        ))}
      </ul>
      <div className={styles.planAction}>
        <form action={isTrial ? props.startTrialAction : props.checkoutAction}>
          {!isTrial && <input type="hidden" name="tier" value={tier} />}
          <AuthSubmit variant="secondary" pendingLabel={isTrial ? 'Activation…' : 'Ouverture de Stripe…'}>
            {planCtaLabel(tier, trial)}
          </AuthSubmit>
        </form>
        <p className={styles.planFoot}>{planFootnote(tier, trial)}</p>
      </div>
    </section>
  )
}

function SetupCard({ amount, whatsappUrl }: { amount: number; whatsappUrl: string | null }) {
  return (
    <section className={styles.setup} aria-label="Mise en place accompagnée">
      <h3 className={styles.planName}>Mise en place accompagnée</h3>
      <p className={styles.price}>
        <b>{formatSetupAmount(amount)}</b>
        <span>HT, une seule fois</span>
      </p>
      <p className={styles.audience}>
        Configuration métier, reprise du catalogue, prise en main guidée et accès prioritaire au support pendant 14 jours. Puis accès sans abonnement mensuel.
      </p>
      <ul className={styles.benefits}>
        <li><Check size={16} aria-hidden="true" /><span>Nous configurons votre catalogue et vos prix avant votre premier échange avec Samuel.</span></li>
        <li><Check size={16} aria-hidden="true" /><span>Nous reprenons vos devis en cours, vos clients et votre historique. Rien à ressaisir.</span></li>
        <li><Check size={16} aria-hidden="true" /><span>Vous prenez la main en direct, avec vos vraies données, sans formation longue.</span></li>
        <li><Check size={16} aria-hidden="true" /><span>14 jours de support prioritaire après la mise en place.</span></li>
      </ul>
      {whatsappUrl && (
        <a href={whatsappUrl} target="_blank" rel="noreferrer" className={styles.whatsapp}>
          Être opérationnel rapidement
        </a>
      )}
    </section>
  )
}
