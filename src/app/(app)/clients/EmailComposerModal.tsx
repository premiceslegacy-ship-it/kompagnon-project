'use client'
// @atelier-migrated

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { CheckRow, ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SearchField } from '@/components/ui/SearchField'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import type { Client } from '@/lib/data/queries/clients'
import { getClientDisplayName } from '@/lib/client'
import { CATEGORY_OPTIONS, TONE_OPTIONS, type CategoryFilter } from './emailModel'
import { useEmailComposer } from './useEmailComposer'
import styles from '../finances/quote-editor/QuoteEditor.module.css'

export type { BroadcastFilter } from './emailModel'

type Props = {
  isOpen: boolean
  onClose: () => void
  allClients: Client[]
  orgEmail: string | null
  orgName: string
  orgSignature: string | null
  hasAI: boolean
  preselectedClientId?: string
}

/** Email groupé : chaque destinataire reçoit son propre message, écrit à la main ou brouillonné par Sarah. */
export default function EmailComposerModal({ isOpen, onClose, allClients, orgEmail, orgName, orgSignature, hasAI, preselectedClientId }: Props) {
  const c = useEmailComposer({ allClients, orgEmail, orgName, preselectedClientId, onClose })
  const [pickerOpen, setPickerOpen] = useState(false)
  if (!isOpen) return null
  const count = c.recipientCount

  if (c.sent) {
    return (
      <Sheet open onOpenChange={open => { if (!open) c.handleClose() }} title="Emails envoyés" cancelLabel="Fermer">
        <div className={styles.total}>
          <b>{c.sent.count}</b>
          <small>email{c.sent.count > 1 ? 's' : ''} envoyé{c.sent.count > 1 ? 's' : ''} avec succès</small>
          {c.sent.errors > 0 && <small className={styles.warn}>{c.sent.errors} échec{c.sent.errors > 1 ? 's' : ''}</small>}
        </div>
      </Sheet>
    )
  }

  return (
    <>
      <Sheet
        open
        onOpenChange={open => { if (!open) c.handleClose() }}
        title="Envoyer un email"
        description="Chaque destinataire reçoit son propre email individuel."
        onConfirm={() => void c.handleSend()}
        confirmLabel={`Envoyer (${count})`}
        confirmLoading={c.sending}
        confirmDisabled={!orgEmail || count === 0}
      >
        <div className={styles.detail}>
          {!orgEmail && (
            <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>
              Aucune adresse expéditeur configurée. Rendez-vous dans Réglages, Relances et emails, pour en configurer une.
            </p>
          )}

          <ListGroup
            title="Destinataires"
            description={c.hasManualSelection ? undefined : `Tous les contacts de la catégorie seront inclus (${count}).`}
          >
            <li className={styles.fieldItem}>
              <Field type="select" label="Catégorie" value={c.category} onChange={e => c.changeCategory(e.target.value as CategoryFilter)}>
                {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Field>
            </li>
            <ListRow
              title="Choisir les contacts"
              description={c.hasManualSelection ? `${count} contact${count > 1 ? 's' : ''} sélectionné${count > 1 ? 's' : ''}` : 'Facultatif'}
              onClick={() => setPickerOpen(true)}
            />
          </ListGroup>

          {hasAI && (
            <SegmentedControl
              fullWidth
              label="Rédaction"
              value={c.tab}
              options={[{ value: 'manual', label: 'Écrire moi-même' }, { value: 'sarah', label: 'Demander à Sarah' }]}
              onChange={v => c.setTab(v as 'manual' | 'sarah')}
            />
          )}

          <div className={styles.fields}>
            <Field type="text" label="Objet" placeholder="Ex : Application de la TVA à partir du 1er juillet" value={c.object} onChange={e => c.setObject(e.target.value)} />
          </div>

          {c.tab === 'manual' && (
            <>
              <div className={styles.fields}>
                <textarea
                  className={styles.textarea}
                  aria-label="Corps du message"
                  style={{ minHeight: 200 }}
                  value={c.body}
                  onChange={e => c.setBody(e.target.value)}
                  placeholder={'Bonjour Jean,\n\nRédigez votre message ici...\n\nCordialement,'}
                />
              </div>
              <p className={styles.hint} style={{ marginTop: 0 }}>
                Si votre première ligne est une salutation (Bonjour, Salut, Madame, Monsieur...), elle sera remplacée automatiquement pour chaque destinataire par son prénom, le nom du contact référent, ou « l’équipe [Entreprise] » selon ce qui est renseigné sur sa fiche.
              </p>
              <ListGroup title="Signature">
                {orgSignature
                  ? <li><p className={styles.requestText}>{orgSignature}</p></li>
                  : orgEmail
                    ? <ListRow title={orgName} description={orgEmail} />
                    : <li><p className={styles.notice}>Aucune signature configurée. Rendez-vous dans Réglages, Relances et emails.</p></li>}
              </ListGroup>
              {c.sendError && <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>{c.sendError}</p>}
            </>
          )}

          {c.tab === 'sarah' && hasAI && (
            <>
              <p className={styles.hint} style={{ marginTop: 0 }}>
                Sarah, secrétaire métier : donnez-lui le contexte. Elle génère un brouillon que vous pourrez relire et modifier librement avant l’envoi.
              </p>
              <SegmentedControl fullWidth label="Ton souhaité" value={c.sarahTone} options={TONE_OPTIONS} onChange={c.setSarahTone} />
              <Field
                type="textarea"
                label="Contexte"
                rows={5}
                controlClassName={styles.areaCompact}
                hint="Facultatif"
                placeholder="Ex : À partir du 1er juillet nous dépassons le seuil de franchise TVA. Les tarifs restent inchangés mais la TVA à 20 % s'appliquera désormais..."
                value={c.sarahContext}
                onChange={e => c.setSarahContext(e.target.value)}
              />
              {c.aiError && <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>{c.aiError}</p>}
              <Button size="lg" loading={c.aiLoading} loadingText="Sarah rédige…" onClick={() => void c.handleAskSarah()}>Générer le brouillon</Button>
            </>
          )}
        </div>
      </Sheet>

      <Sheet open={pickerOpen} onOpenChange={setPickerOpen} title="Destinataires" cancelLabel="Fermer" onConfirm={() => setPickerOpen(false)} confirmLabel="OK">
        <div className={styles.pickList}>
          <SearchField value={c.searchRecipient} onChange={c.setSearchRecipient} label="Rechercher un destinataire" placeholder="Rechercher" />
          {c.visibleContacts.length === 0 ? (
            <p className={styles.hint}>{c.searchRecipient ? 'Aucun résultat.' : 'Aucun contact avec une adresse email dans cette catégorie.'}</p>
          ) : (
            <ListGroup description={c.hasManualSelection ? `${count} contact${count > 1 ? 's' : ''} sélectionné${count > 1 ? 's' : ''}` : undefined}>
              <CheckRow
                title={c.allVisibleChecked ? 'Tout décocher' : 'Tout cocher'}
                description={`${c.visibleContacts.length} contact${c.visibleContacts.length > 1 ? 's' : ''}`}
                checked={c.allVisibleChecked}
                onCheckedChange={c.toggleAllVisible}
              />
              {c.visibleContacts.map(client => (
                <CheckRow
                  key={client.id}
                  title={getClientDisplayName(client)}
                  description={client.email ?? undefined}
                  checked={c.selectedIds.has(client.id)}
                  onCheckedChange={() => c.toggleContact(client.id)}
                />
              ))}
            </ListGroup>
          )}
          {c.hasManualSelection && <Button variant="text" onClick={() => c.setSelectedIds(new Set())}>Tout décocher</Button>}
        </div>
      </Sheet>
    </>
  )
}
