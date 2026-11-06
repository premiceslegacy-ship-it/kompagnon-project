'use client'
// @atelier-migrated
// Fermeture du compte : sauvegarde, confirmation par le nom de l'organisation, suppression programmée à 30 jours.

import { Check } from 'lucide-react'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Sheet } from '@/components/ui/Sheet'
import { requestAccountDeletion } from '@/lib/data/mutations/account-deletion'
import { closureNameMatches } from './exportComptableModel'
import type { SettingsState } from './useSettings'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Settings.module.css'

export default function ClosureSheet({ q, open, onClose }: { q: SettingsState; open: boolean; onClose: () => void }) {
  const orgName = q.organization?.name ?? ''
  const step = q.deletionStep
  const pending = q.deletionStatus === 'pending'

  async function launch() {
    q.setDeletionStatus('pending')
    q.setDeletionError(null)
    const result = await requestAccountDeletion()
    if (result.error) { q.setDeletionStatus('error'); q.setDeletionError(result.error) }
    else { q.setDeletionStatus('done'); q.setDeletionStep(3); q.router.refresh() }
  }

  const confirm = step === 0 ? { label: 'Générer l’archive', run: () => { q.handleCreateOrganizationExport(); q.setDeletionStep(1) }, disabled: q.hasProcessingExport }
    : step === 1 ? { label: 'Continuer', run: () => q.setDeletionStep(2), disabled: !closureNameMatches(q.deletionConfirmText, orgName) }
      : step === 2 ? { label: 'Fermer le compte', run: () => void launch(), disabled: pending }
        : null

  return (
    <Sheet
      open={open}
      onOpenChange={o => { if (!o) onClose() }}
      title="Fermer le compte"
      cancelLabel={step === 3 ? 'Fermer' : 'Annuler'}
      onConfirm={confirm?.run}
      confirmLabel={confirm?.label ?? ''}
      confirmDisabled={confirm?.disabled}
      confirmLoading={pending}
    >
      <div className={local.sheetBody}>
        {step === 0 && (
          <ListGroup title="1. Sauvegarder vos données" description="Téléchargez votre archive complète avant de continuer. Elle sera générée en arrière-plan : le lien apparaît dans « Dernières sauvegardes ».">
            <ListRow title="Archive ZIP de tout votre espace" description="Fichiers clients, devis, factures, photos." />
          </ListGroup>
        )}
        {step === 1 && (
          <div>
            <div className={styles.fields}>
              <Field type="text" label="Nom" placeholder={orgName} autoComplete="off" value={q.deletionConfirmText} onChange={e => q.setDeletionConfirmText(e.target.value)} />
            </div>
            <p className={styles.hint}>2. Saisissez exactement « {orgName} » pour confirmer.</p>
          </div>
        )}
        {step === 2 && (
          <ListGroup title="3. Lancer la suppression" description="La suppression sera effective dans 30 jours et peut être annulée pendant ce délai. Vos devis et factures sont conservés 10 ans.">
            <ListRow title="Suppression définitive des autres données" description="Effective 30 jours après votre demande." />
          </ListGroup>
        )}
        {step === 3 && (
          <div role="status">
            <div className={local.avatarRow}><span className={local.logoEmpty}><Check size={22} aria-hidden="true" /></span></div>
            <p className={styles.hint} style={{ textAlign: 'center' }}>Suppression programmée. Vous pouvez l’annuler depuis cet écran pendant 30 jours.</p>
          </div>
        )}
        {q.deletionError && <p className={screen.error} role="alert">{q.deletionError}</p>}
      </div>
    </Sheet>
  )
}
