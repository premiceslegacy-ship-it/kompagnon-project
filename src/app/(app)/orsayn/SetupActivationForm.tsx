'use client'

import { activateOperatorSetup } from './actions'
import ActionForm from './ActionForm'
import type { ClientRow } from './types'
import { formatMoney } from './utils'
import { UNRESOLVED_ORGANIZATION_ID } from '@/lib/operator/trial-lifecycle'


function hasNoActiveStripeFlow(row: ClientRow): boolean {
  const status = row.stripeStatus?.toLowerCase()
  return !row.paymentFailedAt && (!status || status === 'canceled' || status === 'incomplete_expired')
}

export default function SetupActivationForm({ row }: { row: ClientRow }) {
  if (row.sourceInstance !== 'atelier-app') return null

  const organizationResolved = row.isOrganizationResolved
    && Boolean(row.organizationId)
    && row.organizationId !== UNRESOLVED_ORGANIZATION_ID
  const officialAppUrl = row.appUrl?.replace(/\/$/, '') === 'https://app.atelier-btp.fr'
  const stripeClear = hasNoActiveStripeFlow(row)

  return (
    <section className="cockpit-panel space-y-4 p-5 sm:p-6">
      <div>
        <h2 className="text-lg font-semibold text-primary">Achat setup · 3 000 € HT</h2>
        {row.billingModel === 'setup' ? (
          <div className="mt-2 space-y-1 text-sm text-secondary">
            <p>Achat setup activé. Accès Atelier hors abonnement récurrent.</p>
            <p>MRR HT : {formatMoney(0, 'EUR')} par mois.</p>
            <p>La consommation IA est imputée au compte OpenRouter du client.</p>
          </div>
        ) : (
          <p className="mt-2 text-sm leading-6 text-secondary">
            Confirmez ici un règlement déjà reçu. Cette action ne prélève aucun montant. L’accès est hors abonnement récurrent et la consommation IA utilise le compte OpenRouter du client.
          </p>
        )}
      </div>

      {row.billingModel !== 'setup' && (
        organizationResolved && officialAppUrl && stripeClear ? (
          <ActionForm
            action={activateOperatorSetup}
            className="space-y-4 border-t border-[var(--cockpit-line)] pt-4"
            successMessage="Achat setup enregistré et accès activé."
          >
            <input type="hidden" name="sourceInstance" value="atelier-app" />
            <input type="hidden" name="organizationId" value={row.organizationId!} />
            <p className="text-sm text-secondary">Organisation : <strong>{row.label}</strong> <code className="break-all text-xs">{row.organizationId}</code></p>
            <label className="block">
              <span className="cockpit-label">Référence du règlement</span>
              <input name="paymentReference" required minLength={3} maxLength={200} autoComplete="off" className="cockpit-input w-full" />
            </label>
            <div className="space-y-3 text-sm text-secondary">
              <label className="flex items-start gap-2">
                <input name="paymentConfirmed" type="checkbox" required className="mt-0.5 h-4 w-4 accent-accent" />
                <span>J’ai vérifié le règlement de 3 000 € HT.</span>
              </label>
              <label className="flex items-start gap-2">
                <input name="stripeClearConfirmed" type="checkbox" required className="mt-0.5 h-4 w-4 accent-accent" />
                <span>J’ai vérifié qu’aucun abonnement ni paiement Stripe n’est en cours.</span>
              </label>
            </div>
            <button type="submit" className="cockpit-button cockpit-button-dark">
              Confirmer le règlement et activer l’accès
            </button>
          </ActionForm>
        ) : (
          <div className="space-y-2 border-t border-[var(--cockpit-line)] pt-4 text-sm text-secondary" role="status">
            {!organizationResolved && <p>Reliez d’abord cette fiche à l’identifiant exact d’une organisation Atelier.</p>}
            {!officialAppUrl && <p>L’URL de l’application doit être https://app.atelier-btp.fr/.</p>}
            {!stripeClear && <p>Un état Stripe actif ou à régulariser est enregistré. Vérifiez aussi qu’aucune session de paiement n’est en cours.</p>}
          </div>
        )
      )}
    </section>
  )
}
