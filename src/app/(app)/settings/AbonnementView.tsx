'use client'
// @atelier-migrated
// Abonnement : offre actuelle, offres supérieures, résiliation, clé de l'assistante.

import { useEffect, useState, useTransition } from 'react'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { StatusPill } from '@/components/ui/StatusPill'
import { createStripePortalSession } from '@/lib/data/mutations/stripe-portal'
import type { OrganizationModules } from '@/lib/organization-modules'
import type { SubscriptionTier } from '@/lib/quota-catalog'
import CancellationSheet from './CancellationSheet'
import OpenRouterKeyGroup from './OpenRouterKeyGroup'
import { CURRENT_TIER_BENEFITS, accessPill, detectCurrentTier, frDate, setupAccessText, tierLabel, tierPrice, upgradeTiers } from './abonnementModel'
import type { SettingsState } from './useSettings'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Settings.module.css'

export default function AbonnementView({ q }: { q: SettingsState }) {
  const tier: SubscriptionTier = q.subscriptionTier ?? detectCurrentTier(q.organizationModules ?? ({} as OrganizationModules))
  const stripeLinks: Record<string, string | null> = { NEXT_PUBLIC_STRIPE_LINK_PRO: q.stripeLinkPro, NEXT_PUBLIC_STRIPE_LINK_EXPERT: q.stripeLinkExpert }
  const [cancelKey, setCancelKey] = useState(0)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [portalError, setPortalError] = useState<string | null>(null)
  const [portalPending, startPortal] = useTransition()
  // Retour de Stripe : le bouton de gestion ne reste pas « occupé » si la page est restaurée depuis le cache.
  useEffect(() => { const reset = () => setPortalError(null); window.addEventListener('pageshow', reset); return () => window.removeEventListener('pageshow', reset) }, [])

  function openPortal() {
    setPortalError(null)
    startPortal(async () => {
      const result = await createStripePortalSession(`${window.location.origin}/settings?tab=abonnement`)
      if ('error' in result) setPortalError(result.error)
      else window.location.href = result.url
    })
  }

  if (q.subscriptionBillingModel === 'setup') {
    return (
      <div className={local.detail}>
        <div className={local.sections}>
          <ListGroup title="Votre achat setup" description="L’installation Atelier a été réglée au prix convenu de 3 000 € HT, en une fois.">
            <ListRow title="Accès Atelier" description={[setupAccessText(q.subscriptionAccessStatus), q.subscriptionAccessEndsAt ? `Accès jusqu’au ${frDate(q.subscriptionAccessEndsAt)}.` : null].filter(Boolean).join(' ')} />
            <ListRow title="Montant mensuel" description="0 € par mois pour Atelier, hors consommation IA." />
            <ListRow title="Consommation IA" description="Les appels IA sont facturés sur votre compte OpenRouter ; sa clé se gère ci-dessous. Le vocal live centralisé n’est pas inclus." />
          </ListGroup>
          <OpenRouterKeyGroup />
        </div>
      </div>
    )
  }

  const pill = accessPill(q.subscriptionAccessStatus)
  const price = tierPrice(tier)
  const benefits = CURRENT_TIER_BENEFITS[tier] ?? []

  return (
    <div className={local.detail}>
      <div className={local.sections}>
        <ListGroup title="Offre actuelle" description="Sans engagement, résiliable avec 30 jours de préavis. Tarifs HT, TVA non applicable (art. 293 B du CGI).">
          <ListRow
            title={tierLabel(tier)}
            description={price ? `${price} € HT / mois` : undefined}
            trailing={tier !== 'setup_only' ? <StatusPill status={pill.status}>{pill.label}</StatusPill> : undefined}
          />
          {q.subscriptionAccessStatus === 'canceling' && q.subscriptionAccessEndsAt && <ListRow title="Accès maintenu" description={`Jusqu’au ${frDate(q.subscriptionAccessEndsAt)}.`} />}
          {q.selfService && tier !== 'setup_only' && (
            <ListRow title={portalPending ? 'Ouverture…' : 'Gérer ma formule et mon moyen de paiement'} className={styles.accentRow} disabled={portalPending} onClick={openPortal} />
          )}
          <ListRow title="Conditions générales de vente" href="/terms" target="_blank" rel="noopener noreferrer" />
        </ListGroup>
        {portalError && <p className={screen.error} role="alert">{portalError}</p>}

        {benefits.length > 0 && (
          <ListGroup title="Ce que vous avez avec cette offre">
            {benefits.map(b => <ListRow key={b} title={b} />)}
          </ListGroup>
        )}

        {upgradeTiers(tier).map(t => {
          const link = stripeLinks[t.stripeEnvKey]
          return (
            <ListGroup key={t.tier} title={`${t.label} · ${t.price} € HT / mois`} description={`${t.description} Changement immédiat, au prorata de la période en cours.`}>
              {t.features.map(f => <ListRow key={f} title={f} />)}
              {t.highlight && <ListRow title={t.highlight} />}
              {q.selfService
                ? <ListRow title={`Passer à ${t.label}`} className={styles.accentRow} disabled={portalPending} onClick={openPortal} />
                : link
                  ? <ListRow title={`Passer à ${t.label}`} className={styles.accentRow} href={link} target="_blank" rel="noopener noreferrer" />
                  : <ListRow title="Lien d’abonnement non configuré" />}
            </ListGroup>
          )
        })}

        <OpenRouterKeyGroup />

        {tier !== 'setup_only' && (
          <ListGroup description="Sans engagement. Un préavis de 30 jours est requis. Vos données restent exportables à tout moment.">
            <li className={styles.destructiveRow}><button type="button" onClick={() => { setCancelKey(k => k + 1); setCancelOpen(true) }}>Résilier mon abonnement</button></li>
          </ListGroup>
        )}
      </div>

      <CancellationSheet key={cancelKey} tier={tier} selfService={q.selfService} open={cancelOpen} onClose={() => setCancelOpen(false)} />
    </div>
  )
}
