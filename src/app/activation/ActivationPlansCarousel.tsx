'use client'

import { useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronDown } from 'lucide-react'
import styles from './activation.module.css'
import { CheckoutSubmitButton } from './CheckoutSubmitButton'

type Tier = 'pro' | 'expert'
type CheckoutAction = (formData: FormData) => void | Promise<void>
type StartTrialAction = () => void | Promise<void>

function WhatsappIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.626.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.999-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.002 5.45-4.436 9.884-9.886 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495.0.16 5.335.157 11.89c0 2.096.547 4.141 1.588 5.945L.057 24l6.304-1.654a11.89 11.89 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.89a11.9 11.9 0 0 0-3.478-8.416" />
    </svg>
  )
}

const PLAN_ORDER: Tier[] = ['expert', 'pro']

const PLAN_COPY: Record<Tier, {
  name: string
  price: number
  promise: string
  audience: string
  benefits: string[]
  quotas: string[]
}> = {
  expert: {
    name: 'Expert',
    price: 169,
    promise: 'Plus aucune limite sur l’IA, à mesure que vous grandissez.',
    audience: 'Pour les équipes qui veulent piloter sans angle mort.',
    benefits: [
      'Devis, relances et analyses par IA sans quota mensuel',
      'Conversation vocale en direct avec l’assistante : 5x plus de minutes qu’en Pro',
      'Pensé pour une équipe qui utilise l’IA tous les jours, sans surveiller un compteur',
      'Facturation électronique incluse, conforme à la réforme 2026-2027',
    ],
    quotas: [
      'Échanges et analyses de devis illimités',
      '300 minutes de conversation vocale en direct / mois',
      'Extraction catalogue et imports illimités',
    ],
  },
  pro: {
    name: 'Pro',
    price: 69,
    promise: 'Une secrétaire IA qui répond à votre place.',
    audience: 'Pour l’artisan actif et les petites équipes.',
    benefits: [
      'Sarah, l’assistante IA, répond sur vos clients, chantiers et planning',
      'Vous pouvez lui parler à la voix, y compris en direct au téléphone',
      'Devis préparés par IA à partir d’un texte, d’un plan ou d’une photo',
      'Facturation électronique incluse, conforme à la réforme 2026-2027',
    ],
    quotas: [
      '120 échanges avec l’assistante IA / mois',
      '60 analyses de devis (dont pré-métré sur plan) / mois',
      '60 minutes de conversation vocale en direct / mois',
    ],
  },
}

export function ActivationPlansCarousel({
  checkoutAction,
  trialAvailable = false,
  startTrialAction,
  setupWhatsappUrl,
  setupAmount,
}: {
  checkoutAction: CheckoutAction
  trialAvailable?: boolean
  startTrialAction?: StartTrialAction
  setupWhatsappUrl?: string | null
  setupAmount: number
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const activeTier = PLAN_ORDER[activeIndex]

  function move(direction: -1 | 1) {
    setActiveIndex((current) => (current + direction + PLAN_ORDER.length) % PLAN_ORDER.length)
  }

  return (
    <section aria-labelledby="activation-plans-title" className={styles.plansSection}>
      <div className={styles.sectionHeading}>
        <p className={styles.eyebrow}>Deux chemins, le même résultat</p>
        <h2 id="activation-plans-title">Récupérez vos soirées.<br />Choisissez simplement qui démarre.</h2>
        <p>Les mêmes outils que vous venez d’utiliser. Choisissez le niveau qui remet votre bureau en mouvement.</p>
      </div>

      <div className={styles.revealHeading}>
        <p className={styles.eyebrow}>{trialAvailable ? 'Commencez sans risque' : 'Votre bureau reprend sa place'}</p>
        <h3>{trialAvailable ? 'Pro offert pendant 14 jours.' : 'Le système qui suit vos chantiers.'}</h3>
        <p>
          {trialAvailable
            ? 'Sans carte bancaire. Sans prélèvement automatique à la fin. Testez Pro gratuitement ou choisissez Expert et passez au paiement sécurisé Stripe.'
            : 'Vous avez déjà utilisé l’essai : reprenez vos devis, vos relances et votre marge sans ressaisie.'}
        </p>
      </div>

      <div className={styles.carouselViewport} aria-live="polite">
        <div className={styles.carouselTrack} style={{ transform: `translateX(-${activeIndex * 100}%)` }}>
          {PLAN_ORDER.map((tier) => {
            const plan = PLAN_COPY[tier]
            const featured = tier === 'expert'
            return (
              <div key={tier} className={styles.carouselSlide}>
                <article className={`${styles.pricingCard} ${featured ? styles.pricingCardFeatured : ''}`}>
                  {featured && <span className={styles.badge}>Le plus complet</span>}
                  <div className={styles.cardTop}>
                    <p className={styles.cardEyebrow}>{plan.name}</p>
                    <div className={styles.priceRow}><strong>{plan.price} €</strong><span>HT / mois</span></div>
                    <p className={styles.cardTrial}>
                      {trialAvailable && tier === 'pro' ? 'Pro offert 14 jours · aucune carte demandée' : `Paiement sécurisé via Stripe · abonnement ${plan.name}`}
                    </p>
                    <h3>{plan.promise}</h3>
                    <p className={styles.cardAudience}>{plan.audience}</p>
                  </div>

                  <ul className={styles.benefits}>
                    {plan.benefits.map((benefit) => (
                      <li key={benefit}><Check aria-hidden="true" /> <span>{benefit}</span></li>
                    ))}
                  </ul>

                  <details className={styles.quotas}>
                    <summary>Voir les quotas <ChevronDown aria-hidden="true" /></summary>
                    <ul className={styles.quotaList}>
                      {plan.quotas.map((quota) => <li key={quota}>{quota}</li>)}
                    </ul>
                  </details>

                  <form action={trialAvailable && tier === 'pro' && startTrialAction ? startTrialAction : checkoutAction}>
                    {!(trialAvailable && tier === 'pro' && startTrialAction) && <input type="hidden" name="tier" value={tier} />}
                    <CheckoutSubmitButton label={trialAvailable && tier === 'pro' ? 'Essayer Pro gratuitement 14 jours' : 'Passer au checkout Stripe'} featured={featured} />
                  </form>
                </article>
              </div>
            )
          })}
        </div>
      </div>

      <div className={styles.carouselControls}>
        <button type="button" onClick={() => move(-1)} aria-label="Formule précédente"><ArrowLeft aria-hidden="true" /></button>
        <div className={styles.dots} aria-label={`Formule ${PLAN_COPY[activeTier].name} affichée`}>
          {PLAN_ORDER.map((tier, index) => (
            <button
              key={tier}
              type="button"
              onClick={() => setActiveIndex(index)}
              aria-label={`Afficher ${PLAN_COPY[tier].name}`}
              aria-current={activeIndex === index ? 'true' : undefined}
              data-active={activeIndex === index}
            />
          ))}
        </div>
        <button type="button" onClick={() => move(1)} aria-label="Formule suivante"><ArrowRight aria-hidden="true" /></button>
      </div>

      <article className={styles.setupCard}>
        <div className={styles.setupHeader}>
          <div>
            <p className={styles.cardEyebrow}>On s’occupe de tout</p>
            <h3>Votre entreprise est prête, sans soirée sacrifiée.</h3>
          </div>
          <div className={styles.setupPrice}><strong>{setupAmount.toLocaleString('fr-FR')} €</strong><span>HT, une seule fois</span></div>
        </div>
        <p className={styles.setupDescription}>Configuration métier, reprise du catalogue, prise en main guidée et accès prioritaire au support pendant 14 jours. Puis accès sans abonnement mensuel.</p>
        <ul className={styles.setupBenefits}>
          <li><Check aria-hidden="true" /><span>On configure votre catalogue et vos prix avant votre premier échange avec Samuel.</span></li>
          <li><Check aria-hidden="true" /><span>On reprend vos devis en cours, vos clients et votre historique. Rien à ressaisir.</span></li>
          <li><Check aria-hidden="true" /><span>Vous prenez la main en direct, avec vos vraies données, sans formation longue.</span></li>
          <li><Check aria-hidden="true" /><span>Vous bénéficiez de 14 jours de support prioritaire après la mise en place.</span></li>
        </ul>
        {setupWhatsappUrl && (
          <a href={setupWhatsappUrl} target="_blank" rel="noreferrer" className={styles.setupCta}>
            <WhatsappIcon />
            <span>Être opérationnel rapidement</span>
            <ArrowRight aria-hidden="true" />
          </a>
        )}
      </article>
    </section>
  )
}
