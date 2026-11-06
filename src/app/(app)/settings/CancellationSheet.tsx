'use client'
// @atelier-migrated
// Abonnement : parcours de résiliation en trois étapes (ce qui est perdu, motif, confirmation).

import { useState, useTransition } from 'react'
import { Check } from 'lucide-react'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Sheet } from '@/components/ui/Sheet'
import { createStripePortalSession } from '@/lib/data/mutations/stripe-portal'
import { requestSelfServiceCancellation } from '@/lib/data/mutations/subscription-self-service'
import type { SubscriptionTier } from '@/lib/quota-catalog'
import { CANCEL_CONFIRM_WORD, CANCEL_REASONS, CURRENT_TIER_BENEFITS, frDate, isCancelConfirmed, tierLabel } from './abonnementModel'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Settings.module.css'

type Step = 'benefits' | 'reason' | 'confirm'

type Props = { tier: SubscriptionTier; selfService: boolean; open: boolean; onClose: () => void }

/** Le parent change la `key` à chaque ouverture : le parcours repart de la première étape. */
export default function CancellationSheet({ tier, selfService, open, onClose }: Props) {
  const [step, setStep] = useState<Step>('benefits')
  const [reason, setReason] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [scheduledAt, setScheduledAt] = useState<string | null>(null)
  const label = tierLabel(tier)

  function submit() {
    setError(null)
    startTransition(async () => {
      const result = selfService
        ? await requestSelfServiceCancellation(reason)
        : await createStripePortalSession(`${window.location.origin}/settings?tab=abonnement`)
      if ('error' in result) setError(result.error)
      else if (selfService && 'cancel_at' in result) setScheduledAt(result.cancel_at)
      else window.location.href = (result as { url: string }).url
    })
  }

  const onConfirm = scheduledAt ? undefined
    : step === 'benefits' ? () => setStep('reason')
      : step === 'reason' ? () => setStep('confirm')
        : submit
  const confirmLabel = step === 'confirm' ? 'Résilier' : 'Continuer'
  const confirmDisabled = step === 'reason' ? !reason : step === 'confirm' ? !isCancelConfirmed(confirmText) : false

  return (
    <Sheet
      open={open}
      onOpenChange={o => { if (!o) onClose() }}
      title="Résilier mon abonnement"
      cancelLabel={scheduledAt ? 'Fermer' : 'Garder mon offre'}
      onConfirm={onConfirm}
      confirmLabel={confirmLabel}
      confirmDisabled={confirmDisabled}
      confirmLoading={pending}
    >
      <div className={local.sheetBody}>
        {scheduledAt ? (
          <div role="status">
            <div className={local.avatarRow}><span className={local.logoEmpty}><Check size={22} aria-hidden="true" /></span></div>
            <p className={styles.hint} style={{ textAlign: 'center' }}>
              Résiliation programmée. Votre accès reste actif jusqu’au {frDate(scheduledAt)}. La dernière période sera calculée au prorata par Stripe.
            </p>
          </div>
        ) : step === 'benefits' ? (
          <ListGroup title={`Ce que vous perdez avec l’offre ${label}`} description="Sans engagement. Après le préavis de 30 jours, l’accès aux fonctions IA est coupé. Vos données restent accessibles et exportables.">
            {(CURRENT_TIER_BENEFITS[tier] ?? []).map(b => <ListRow key={b} title={b} />)}
          </ListGroup>
        ) : step === 'reason' ? (
          <ListGroup title="Pourquoi résiliez-vous ?" description="Cette information nous aide à améliorer le service.">
            {CANCEL_REASONS.map(r => (
              <ListRow key={r} title={r} trailing={reason === r ? <span className={local.tick}><Check size={18} aria-label="Choisi" role="img" /></span> : undefined} onClick={() => setReason(r)} />
            ))}
          </ListGroup>
        ) : (
          <>
            <ListGroup
              title="Ce que vous perdez définitivement"
              description={`Votre offre ${label} reste active 30 jours à compter d’aujourd’hui (préavis contractuel), puis l’accès aux fonctions IA est suspendu. La résiliation est programmée à J+30 et confirmée par email.`}
            >
              <ListRow title={`L’accès opérationnel à Atelier (${label})`} />
              <ListRow title="Sarah et les assistants métier" />
              <ListRow title="Les automatisations de suivi" />
            </ListGroup>
            <div>
              <div className={styles.fields}>
                <Field type="text" label={`Tapez ${CANCEL_CONFIRM_WORD}`} placeholder={CANCEL_CONFIRM_WORD} autoComplete="off" value={confirmText} onChange={e => setConfirmText(e.target.value)} />
              </div>
              <p className={styles.hint}>Pour confirmer, saisissez le mot « {CANCEL_CONFIRM_WORD} ».</p>
            </div>
            {error && <p className={screen.error} role="alert">{error}</p>}
          </>
        )}
      </div>
    </Sheet>
  )
}
