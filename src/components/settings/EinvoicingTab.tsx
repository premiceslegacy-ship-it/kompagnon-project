'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, AlertTriangle, Loader2, FileText } from 'lucide-react'
import { startEinvoicingOauth } from '@/lib/data/mutations/einvoicing'
import type { EinvoicingConfig } from '@/lib/einvoicing-config'

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
          <button
            onClick={handleActivate}
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Activer la facturation électronique
          </button>
        )}

        {canConfigure && isConnected && (
          <p className="text-sm text-secondary">
            Votre compte est connecté. La transmission de vos factures via Super PDP sera disponible prochainement.
          </p>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}
      </section>
    </div>
  )
}
