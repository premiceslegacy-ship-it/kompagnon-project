// @atelier-migrated
// Activation : essai, formules et mise en place (voir page.tsx pour les droits d'accès).

import { Check, CheckCircle2 } from 'lucide-react'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { AuthNotice, AuthSubmit, AuthTextSubmit } from '@/components/auth/AuthParts'
import {
  PLAN_COPY, PLAN_ORDER, SETUP_COPY, formatEuros, setupComparison, planAction, planBadge, planCtaLabel, planFootnote,
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
  const comparison = setupComparison(amount, PLAN_COPY.expert.price)
  const years = comparison.months / 12
  return (
    <section className={styles.setup} aria-label={SETUP_COPY.name}>
      <p className={styles.eyebrow}>{SETUP_COPY.name}</p>
      <h3 className={styles.setupTitle}>{SETUP_COPY.headline}</h3>
      <p className={styles.price}>
        <b>{formatEuros(amount)}</b>
        <span>HT, une seule fois</span>
      </p>

      <div className={styles.savings}>
        <p className={styles.savingsTitle}>
          Jusqu’à <b>{formatEuros(comparison.savings)}</b> d’économie <span className={styles.nowrap}>sur {years} ans</span>
        </p>
        <div className={styles.bars} role="img" aria-label={`Sur ${years} ans : Expert ${formatEuros(comparison.monthlyTotal)}, mise en place ${formatEuros(amount)}`}>
          <div className={styles.barRow}>
            <span className={styles.barLabel}>Expert</span>
            <span className={styles.bar} style={{ width: '100%' }} />
            <b>{formatEuros(comparison.monthlyTotal)}</b>
          </div>
          <div className={styles.barRow}>
            <span className={styles.barLabel}>Mise en place</span>
            <span className={styles.bar} data-featured="true" style={{ width: `${comparison.setupShare}%` }} />
            <b>{formatEuros(amount)}</b>
          </div>
        </div>
        <p className={styles.savingsNote}>
          Face à Expert ({PLAN_COPY.expert.price} € par mois). Amorti en {comparison.breakEvenMonths} mois.
        </p>
      </div>

      <p className={styles.perk}>{SETUP_COPY.perk}</p>
      <ul className={styles.benefits}>
        {SETUP_COPY.benefits.map((benefit) => (
          <li key={benefit}>
            <Check size={16} aria-hidden="true" />
            <span>{benefit}</span>
          </li>
        ))}
      </ul>
      <a href={whatsappUrl ?? 'mailto:contact@orsayn.fr'} target={whatsappUrl ? '_blank' : undefined} rel={whatsappUrl ? 'noreferrer' : undefined} className={styles.whatsapp}>
        {SETUP_COPY.cta}
      </a>
      <p className={styles.planFoot}>{SETUP_COPY.footnote}</p>
    </section>
  )
}
