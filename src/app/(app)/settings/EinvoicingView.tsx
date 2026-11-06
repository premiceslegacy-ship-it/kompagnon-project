'use client'
// @atelier-migrated
// Facturation électronique : connexion Super PDP, réception et émission des factures.

import { useState, useTransition } from 'react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { StatusPill } from '@/components/ui/StatusPill'
import { Switch } from '@/components/ui/Switch'
import { setEmissionEnabled, setReceptionEnabled, startEinvoicingOauth } from '@/lib/data/mutations/einvoicing'
import { OAUTH_STATUS_LABELS, activateLabel, frDate, oauthPill } from './abonnementModel'
import type { SettingsState } from './useSettings'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Settings.module.css'

export default function EinvoicingView({ q }: { q: SettingsState }) {
  const config = q.einvoicingConfig
  const canConfigure = q.canConfigureEinvoicing
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [emissionPending, startEmission] = useTransition()
  const [emissionError, setEmissionError] = useState<string | null>(null)
  const [receptionPending, startReception] = useTransition()
  const [receptionError, setReceptionError] = useState<string | null>(null)
  const [warn, setWarn] = useState(false)
  const connected = config.oauth_status === 'connected'

  function activate() {
    setError(null)
    startTransition(async () => {
      const result = await startEinvoicingOauth()
      if ('error' in result) { setError(result.error); return }
      window.location.href = result.url
    })
  }

  function toggleEmission(next: boolean) {
    setEmissionError(null)
    startEmission(async () => { const r = await setEmissionEnabled(next); if (r.error) setEmissionError(r.error) })
  }

  function applyReception(next: boolean) {
    setReceptionError(null)
    startReception(async () => { const r = await setReceptionEnabled(next); if (r.error) setReceptionError(r.error) })
  }

  // La désactivation demande une confirmation : la réception est obligatoire depuis le 01/09/2026, sans dérogation.
  const toggleReception = (next: boolean) => (next ? applyReception(true) : setWarn(true))

  return (
    <div className={local.detail}>
      <div className={local.sections}>
        <p className={styles.hint} style={{ margin: '0 16px' }}>
          Cette option reste votre choix dans Atelier : activez-la ici lorsque vous souhaitez transmettre et recevoir vos factures électroniques.
        </p>

        {config.environment === 'sandbox' && (
          <p className={local.notice} data-tone="warn" role="status">
            <strong>Super PDP est encore en mode test.</strong> Aucune transmission vers la production n’est activée : les réglages ci-dessous servent aux essais techniques.
          </p>
        )}
        {q.oauthResult === 'success' && <p className={screen.ok} role="status">Connexion Super PDP réussie.</p>}
        {q.oauthResult === 'error' && (
          <p className={screen.error} role="alert">La connexion a échoué{q.oauthDetail ? ` (${q.oauthDetail})` : ''}. Réessayez, ou contactez le support si le problème persiste.</p>
        )}

        <ListGroup title="Super PDP" description={!canConfigure ? 'Seul un titulaire des droits de configuration peut activer la facturation électronique.' : undefined}>
          <ListRow
            title="Statut"
            description={connected && config.oauth_connected_at ? `${OAUTH_STATUS_LABELS[config.oauth_status]} depuis le ${frDate(config.oauth_connected_at)}` : undefined}
            trailing={<StatusPill status={oauthPill(config.oauth_status)}>{OAUTH_STATUS_LABELS[config.oauth_status]}</StatusPill>}
          />
          {canConfigure && !connected && (
            <ListRow title={pending ? 'Ouverture…' : activateLabel(config.environment)} className={styles.accentRow} disabled={pending} onClick={activate} />
          )}
        </ListGroup>
        {canConfigure && !connected && config.onboarding_intent === 'activate' && (
          <p className={styles.hint} style={{ margin: '0 16px' }}>Lors de votre inscription, vous aviez indiqué vouloir activer la facturation électronique dès que possible : c’est le moment.</p>
        )}
        {error && <p className={screen.error} role="alert">{error}</p>}

        {canConfigure && connected && (
          <>
            <ListGroup description="Obligatoire par la loi depuis le 1er septembre 2026, sans dérogation possible. Vous restez libre de désactiver ce réglage, mais cela ne vous dispense pas de l’obligation légale.">
              <ListRow
                title="Recevoir mes factures fournisseurs"
                description={config.reception_enabled ? 'Activé' : 'Désactivé'}
                trailing={<Switch label="Recevoir mes factures fournisseurs via Super PDP" checked={config.reception_enabled} disabled={receptionPending} onChange={toggleReception} />}
              />
            </ListGroup>
            {receptionError && <p className={screen.error} role="alert">{receptionError}</p>}
            <ListGroup description="Facultatif jusqu’au 1er septembre 2027. Activez-la dès maintenant si vous souhaitez être prêt en avance.">
              <ListRow
                title="Transmettre mes factures émises"
                description={config.emission_enabled ? 'Activé' : 'Désactivé'}
                trailing={<Switch label="Transmettre mes factures émises via Super PDP" checked={config.emission_enabled} disabled={emissionPending} onChange={toggleEmission} />}
              />
            </ListGroup>
            {emissionError && <p className={screen.error} role="alert">{emissionError}</p>}
          </>
        )}
      </div>

      <AlertDialog
        open={warn}
        onOpenChange={setWarn}
        title="Désactiver la réception des factures ?"
        description="La réception de factures électroniques est une obligation légale depuis le 1er septembre 2026, pour toutes les entreprises, sans dérogation possible. La désactiver dans Atelier ne vous en dispense pas : en cas de manquement constaté, vous vous exposez à une mise en demeure puis à une amende de 500 €. Vous restez libre de ce choix, mais nous devons vous en informer avant de continuer."
        confirmLabel="Désactiver quand même"
        onConfirm={() => { setWarn(false); applyReception(false) }}
      />
    </div>
  )
}
