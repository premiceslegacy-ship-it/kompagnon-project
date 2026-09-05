'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, AlertTriangle, Loader2, FileText, ShieldAlert } from 'lucide-react'
import { startEinvoicingOauth, setEmissionEnabled, setReceptionEnabled } from '@/lib/data/mutations/einvoicing'
import type { EinvoicingConfig } from '@/lib/einvoicing-config'
import { Switch } from '@/components/ui/Switch'
import { Modal } from '@/components/ui/Modal'

type EinvoicingTabProps = {
  config: EinvoicingConfig
  canConfigure: boolean
  oauthResult: 'success' | 'error' | null
  oauthDetail: string | null
}

const STATUS_LABELS: Record<EinvoicingConfig['oauth_status'], string> = {
  not_connected: 'Non connecté',
  pending: 'Connexion en cours',
  connected: 'Connecté',
  error: 'Erreur de connexion',
  revoked: 'Connexion révoquée',
}

export default function EinvoicingTab({ config, canConfigure, oauthResult, oauthDetail }: EinvoicingTabProps) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [isEmissionPending, startEmissionTransition] = useTransition()
  const [emissionError, setEmissionError] = useState<string | null>(null)
  const [isReceptionPending, startReceptionTransition] = useTransition()
  const [receptionError, setReceptionError] = useState<string | null>(null)
  const [showReceptionWarning, setShowReceptionWarning] = useState(false)

  const isConnected = config.oauth_status === 'connected'
  const hasIssue = config.oauth_status === 'error' || config.oauth_status === 'revoked'

  function handleActivate() {
    setError(null)
    startTransition(async () => {
      const result = await startEinvoicingOauth()
      if ('error' in result) {
        setError(result.error)
        return
      }
      window.location.href = result.url
    })
  }

  function handleToggleEmission(next: boolean) {
    setEmissionError(null)
    startEmissionTransition(async () => {
      const result = await setEmissionEnabled(next)
      if (result.error) setEmissionError(result.error)
    })
  }

  function applyReceptionChange(next: boolean) {
    setReceptionError(null)
    startReceptionTransition(async () => {
      const result = await setReceptionEnabled(next)
      if (result.error) setReceptionError(result.error)
    })
  }

  function handleToggleReception(next: boolean) {
    // La désactivation demande une confirmation explicite : la réception est
    // obligatoire par la loi depuis le 01/09/2026, sans dérogation possible.
    if (!next) {
      setShowReceptionWarning(true)
      return
    }
    applyReceptionChange(true)
  }

  function confirmDisableReception() {
    setShowReceptionWarning(false)
    applyReceptionChange(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-primary">Facturation électronique</h2>
        <p className="text-secondary text-sm mt-1">
          Connectez votre compte Super PDP pour transmettre et recevoir vos factures électroniques directement depuis Atelier.
        </p>
      </div>

      {oauthResult === 'success' && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p className="text-sm text-emerald-800 dark:text-emerald-200">Connexion Super PDP réussie.</p>
        </div>
      )}

      {oauthResult === 'error' && (
        <div className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10">
          <AlertTriangle className="h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" />
          <p className="text-sm text-red-800 dark:text-red-200">
            La connexion a échoué{oauthDetail ? ` (${oauthDetail})` : ''}. Réessayez, ou contactez le support si le problème persiste.
          </p>
        </div>
      )}

      <section className="rounded-2xl border border-[var(--elevation-border)] bg-surface dark:bg-white/5 p-5 space-y-4">
        <div className="flex items-center gap-3">
          <FileText className="h-5 w-5 text-secondary" />
          <div>
            <p className="font-semibold text-primary">Super PDP</p>
            <p className="text-sm text-secondary">
              Statut : <span className={isConnected ? 'text-emerald-600 dark:text-emerald-400 font-medium' : hasIssue ? 'text-red-600 dark:text-red-400 font-medium' : ''}>{STATUS_LABELS[config.oauth_status]}</span>
              {config.oauth_connected_at && isConnected && (
                <> — depuis le {new Date(config.oauth_connected_at).toLocaleDateString('fr-FR')}</>
              )}
            </p>
          </div>
        </div>

        {!canConfigure && (
          <p className="text-sm text-secondary">Seul un titulaire des droits de configuration peut activer la facturation électronique.</p>
        )}

        {canConfigure && !isConnected && (
          <div className="space-y-3">
            {config.onboarding_intent === 'activate' && (
              <p className="text-sm text-secondary">
                Lors de votre inscription, vous aviez indiqué vouloir activer la facturation électronique dès que
                possible — c'est le moment.
              </p>
            )}
            <button
              onClick={handleActivate}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50"
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Activer la facturation électronique
            </button>
          </div>
        )}

        {canConfigure && isConnected && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 pt-2 border-t border-[var(--elevation-border)]">
              <Switch
                checked={config.reception_enabled}
                onChange={handleToggleReception}
                disabled={isReceptionPending}
                label="Recevoir mes factures fournisseurs via Super PDP"
              />
              <div className="flex-1">
                <span className="font-medium text-primary flex items-center gap-2">
                  Recevoir mes factures fournisseurs
                  {isReceptionPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-secondary" />}
                </span>
                <p className="text-sm text-secondary mt-0.5">
                  Obligatoire par la loi depuis le 1er septembre 2026, sans dérogation possible. Vous restez libre de
                  désactiver ce réglage, mais cela ne vous dispense pas de l’obligation légale.
                </p>
              </div>
            </div>
            {receptionError && <p className="text-sm text-red-500">{receptionError}</p>}

            <div className="flex items-start gap-3 pt-2 border-t border-[var(--elevation-border)]">
              <Switch
                checked={config.emission_enabled}
                onChange={handleToggleEmission}
                disabled={isEmissionPending}
                label="Transmettre mes factures émises via Super PDP"
              />
              <div className="flex-1">
                <span className="font-medium text-primary flex items-center gap-2">
                  Transmettre mes factures émises
                  {isEmissionPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-secondary" />}
                </span>
                <p className="text-sm text-secondary mt-0.5">
                  Facultatif jusqu’au 1er septembre 2027 — activez-la dès maintenant si vous souhaitez être prêt en avance.
                </p>
              </div>
            </div>
            {emissionError && <p className="text-sm text-red-500">{emissionError}</p>}
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}
      </section>

      <Modal
        open={showReceptionWarning}
        onClose={() => setShowReceptionWarning(false)}
        title="Désactiver la réception des factures ?"
        size="sm"
        footer={
          <>
            <button
              onClick={() => setShowReceptionWarning(false)}
              className="inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-primary hover:bg-black/5 dark:hover:bg-white/5"
            >
              Annuler
            </button>
            <button
              onClick={confirmDisableReception}
              className="inline-flex items-center justify-center rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
            >
              Je confirme, désactiver quand même
            </button>
          </>
        }
      >
        <div className="flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400 mt-0.5" />
          <p className="text-sm text-secondary leading-relaxed">
            La réception de factures électroniques est une obligation légale depuis le 1er septembre 2026, pour toutes
            les entreprises, sans dérogation possible. La désactiver dans Atelier ne vous dispense pas de cette
            obligation : en cas de manquement constaté, vous vous exposez à une mise en demeure puis à une amende de
            500 €. Vous restez libre de ce choix, mais nous devons vous en informer avant de continuer.
          </p>
        </div>
      </Modal>
    </div>
  )
}
