'use client'
// @atelier-migrated
// Données et confidentialité : pages publiques, export comptable, mémoire des assistants, sauvegarde, fermeture du compte.

import { useState } from 'react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Button } from '@/components/ui/Button'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { StatusPill } from '@/components/ui/StatusPill'
import { cancelAccountDeletion } from '@/lib/data/mutations/account-deletion'
import { AI_NAME } from '@/lib/brand'
import { LANDING_LEGAL_SNIPPETS, LEGAL_PATHS } from '@/lib/legal'
import ClosureSheet from './ClosureSheet'
import ExportComptableSheet from './ExportComptableSheet'
import { backupStatus, formatFileSize, memoryTypeLabel } from './exportComptableModel'
import type { SettingsState } from './useSettings'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Settings.module.css'

const frDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')

export default function DonneesView({ q }: { q: SettingsState }) {
  const org = q.organization
  const [exportKey, setExportKey] = useState(0)
  const [exportOpen, setExportOpen] = useState(false)
  const [closureOpen, setClosureOpen] = useState(false)
  const [forget, setForget] = useState<string | null>(null)
  const exports = q.organizationExports
  const backupBusy = q.isPending || q.hasProcessingExport || q.exportSaveStatus === 'saving'

  return (
    <div className={local.detail}>
      <div className={local.sections}>
        <ListGroup title="Pages publiques" description="Nos engagements sur la gestion et la protection de vos données métier et personnelles.">
          <ListRow title="Politique de confidentialité" href={LEGAL_PATHS.privacy} target="_blank" rel="noopener noreferrer" />
          <ListRow title="Conditions d’utilisation" href={LEGAL_PATHS.terms} target="_blank" rel="noopener noreferrer" />
          <ListRow title="Mentions légales" href={LEGAL_PATHS.legal} target="_blank" rel="noopener noreferrer" />
        </ListGroup>

        <ListGroup>
          {LANDING_LEGAL_SNIPPETS.map(snippet => <ListRow key={snippet.title} title={snippet.title} description={snippet.body} />)}
        </ListGroup>

        <ListGroup title="Comptabilité" description="FEC conforme (art. A. 47 A-1 LPF) ou CSV pour Excel, par période. Réservé aux administrateurs.">
          {q.isAdmin
            ? <ListRow title="Exporter mes factures" onClick={() => { setExportKey(k => k + 1); setExportOpen(true) }} />
            : <ListRow title="Exporter mes factures" description="Seul un administrateur peut générer un export comptable." />}
        </ListGroup>

        <div>
          <ListGroup title="Mémoire des assistants" description={`Ce que ${AI_NAME} a retenu au fil des conversations et des devis (préférences client, prix corrigés, habitudes). Vous pouvez en supprimer un élément à tout moment.`}>
            {q.memories.length === 0 && <ListRow title="Aucun élément mémorisé pour le moment" />}
            {q.memoriesPageItems.map(memory => (
              <ListRow
                key={memory.id}
                title={memory.content}
                description={`${memoryTypeLabel(memory.type, AI_NAME, memory.metadata)} · ${frDate(memory.created_at)}`}
                trailing={<Button type="button" variant="secondary" size="sm" disabled={q.deletingMemoryId === memory.id} onClick={() => setForget(memory.id)}>Oublier</Button>}
              />
            ))}
          </ListGroup>
          {q.memoriesPageCount > 1 && (
            <div className={local.pager} style={{ marginTop: 12 }}>
              <Button type="button" variant="text" size="sm" disabled={q.memoriesPage === 0} onClick={() => q.setMemoriesPage(p => Math.max(0, p - 1))}>Précédent</Button>
              <span className={local.pagerLabel}>Page {q.memoriesPage + 1} sur {q.memoriesPageCount}</span>
              <Button type="button" variant="text" size="sm" disabled={q.memoriesPage >= q.memoriesPageCount - 1} onClick={() => q.setMemoriesPage(p => Math.min(q.memoriesPageCount - 1, p + 1))}>Suivant</Button>
            </div>
          )}
          {q.memoryError && <p className={screen.error} role="alert">{q.memoryError}</p>}
        </div>

        <div>
          <ListGroup title="Sauvegarde" description="Archive ZIP de tout votre espace (fichiers clients, devis, factures, photos). Le lien est actif pendant 7 jours ; vous pouvez la régénérer à tout moment. Réservé au propriétaire.">
            {q.isOwner
              ? <ListRow title={q.hasProcessingExport ? 'Sauvegarde en cours…' : q.exportSaveStatus === 'saving' ? 'Génération en cours…' : 'Générer une sauvegarde'} className={styles.accentRow} disabled={backupBusy} onClick={q.handleCreateOrganizationExport} />
              : <ListRow title="Générer une sauvegarde" description="Seul l’administrateur principal peut générer et récupérer ces sauvegardes." />}
          </ListGroup>
          {q.exportFeedback && <p className={q.exportSaveStatus === 'error' ? screen.error : screen.ok} role={q.exportSaveStatus === 'error' ? 'alert' : 'status'}>{q.exportFeedback}</p>}
        </div>

        <ListGroup title="Dernières sauvegardes">
          {exports.length === 0 && <ListRow title="Aucune sauvegarde pour l’instant" description="Générez-en une ci-dessus." />}
          {exports.map(item => {
            const status = backupStatus(item.status)
            const details = [
              `Demandée par ${item.requestedByEmail}`,
              formatFileSize(item.bundleSizeBytes),
              item.expiresAt ? `disponible jusqu’au ${q.formatExportDate(item.expiresAt)}` : null,
              item.errorMessage,
              ...item.warnings,
            ].filter(Boolean).join(' · ')
            return (
              <ListRow
                key={item.id}
                title={q.formatExportDate(item.createdAt)}
                description={details}
                trailing={item.downloadUrl
                  ? <a className={local.linkPill} href={item.downloadUrl} target="_blank" rel="noreferrer">Télécharger</a>
                  : <StatusPill status={status.pill}>{status.label}</StatusPill>}
              />
            )
          })}
        </ListGroup>

        <ListGroup description="Vos devis et factures sont conservés 10 ans (obligations comptables et fiscales), même après la fermeture du compte. Toutes vos autres données sont supprimées 30 jours après la demande.">
          {org?.deletion_requested_at ? (
            <>
              <ListRow
                title="Suppression programmée"
                description={`Votre compte sera définitivement supprimé le ${org.deletion_scheduled_at ? new Date(org.deletion_scheduled_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'}. Vous pouvez annuler avant cette date.`}
              />
              <ListRow
                title={q.cancelDeletionStatus === 'pending' ? 'Annulation…' : 'Annuler la suppression'}
                className={styles.accentRow}
                disabled={q.cancelDeletionStatus === 'pending'}
                onClick={async () => {
                  q.setCancelDeletionStatus('pending')
                  const result = await cancelAccountDeletion()
                  q.setCancelDeletionStatus(result.error ? 'idle' : 'done')
                  if (!result.error) q.router.refresh()
                }}
              />
            </>
          ) : q.isOwner ? (
            <li className={styles.destructiveRow}><button type="button" onClick={() => { q.setDeletionStep(0); q.setDeletionConfirmText(''); q.setDeletionError(null); setClosureOpen(true) }}>Fermer le compte</button></li>
          ) : (
            <ListRow title="Fermer le compte" description="Réservé au propriétaire de l’organisation." />
          )}
          <ListRow title="Lire la politique de suppression détaillée" href={`${LEGAL_PATHS.privacy}#suppression`} target="_blank" rel="noopener noreferrer" />
        </ListGroup>
      </div>

      <ExportComptableSheet
        key={exportKey}
        open={exportOpen}
        isVatSubject={org?.is_vat_subject ?? false}
        isMicro={!(org?.is_vat_subject ?? true) && !org?.business_profile}
        tvaLabel={!org?.is_vat_subject ? 'Franchise TVA art. 293 B CGI' : org?.tva_sur_debits ? 'TVA sur débits' : 'TVA sur encaissements'}
        siren={org?.siren ?? null}
        onClose={() => setExportOpen(false)}
      />
      <ClosureSheet q={q} open={closureOpen} onClose={() => setClosureOpen(false)} />
      <AlertDialog
        open={forget !== null}
        onOpenChange={o => { if (!o) setForget(null) }}
        title="Oublier cet élément ?"
        description={`${AI_NAME} ne s’en servira plus.`}
        confirmLabel="Oublier"
        onConfirm={() => { if (forget) q.handleDeleteMemory(forget); setForget(null) }}
      />
    </div>
  )
}
