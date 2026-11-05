'use client'
// @atelier-migrated

import { useState } from 'react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import { CLAUSE_LABELS, CONTRACT_DISCLAIMER, CONTRACT_TYPE_LABELS, getRoleLabel, type ContractClauses, type ContractCustomSection, type ContractType } from '@/lib/contracts/templates'
import type { Chantier } from '@/lib/data/queries/chantiers'
import type { Client } from '@/lib/data/queries/clients'
import type { ContractListItem, ContractTemplateOption } from '@/lib/data/queries/contracts'
import type { Quote } from '@/lib/data/queries/quotes'
import { CLAUSE_ORDER, STATUS_LABELS, clientName } from './contractsModel'
import { useContractForm, useContractTemplates, type Contracts } from './useContracts'
import styles from '../finances/quote-editor/QuoteEditor.module.css'

const TYPE_OPTIONS = [
  { value: 'sous_traitance', label: 'Sous-traitance' },
  { value: 'maintenance', label: 'Maintenance' },
] as const

const preview = (text: string | undefined, max = 70) => {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim()
  return flat ? (flat.length > max ? `${flat.slice(0, max)}…` : flat) : 'À renseigner'
}

/** Clauses : une ligne par clause, qui ouvre une feuille de texte. */
function ClausesEditor({ clauses, onChange }: { clauses: ContractClauses; onChange: (key: (typeof CLAUSE_ORDER)[number], value: string) => void }) {
  const [editing, setEditing] = useState<(typeof CLAUSE_ORDER)[number] | null>(null)
  return (
    <>
      <ListGroup title="Clauses" description="Chaque clause part du modèle choisi et reste modifiable.">
        {CLAUSE_ORDER.map(key => (
          <ListRow key={key} title={CLAUSE_LABELS[key]} description={preview(clauses[key])} onClick={() => setEditing(key)} />
        ))}
      </ListGroup>
      {editing && (
        <Sheet open onOpenChange={open => { if (!open) setEditing(null) }} title={CLAUSE_LABELS[editing]} cancelLabel="Fermer" onConfirm={() => setEditing(null)} confirmLabel="OK">
          <div className={styles.fields}>
            <textarea
              className={styles.textarea}
              aria-label={CLAUSE_LABELS[editing]}
              style={{ minHeight: 260 }}
              value={clauses[editing] ?? ''}
              onChange={e => onChange(editing, e.target.value)}
            />
          </div>
        </Sheet>
      )}
    </>
  )
}

/** Sections supplémentaires : titre et contenu libres. */
function SectionsEditor({ sections, onAdd, onUpdate, onRemove }: {
  sections: ContractCustomSection[]
  onAdd: () => void
  onUpdate: (id: string, patch: Partial<ContractCustomSection>) => void
  onRemove: (id: string) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const editing = sections.find(s => s.id === editingId)
  return (
    <>
      <ListGroup title="Sections supplémentaires">
        {sections.length === 0 && <li><p className={styles.notice}>Aucune section supplémentaire.</p></li>}
        {sections.map((s, i) => (
          <ListRow key={s.id} title={s.title || `Section ${i + 1}`} description={preview(s.content)} onClick={() => setEditingId(s.id)} />
        ))}
        <ListRow title="Ajouter une section" className={styles.accentRow} onClick={onAdd} />
      </ListGroup>
      {editing && (
        <Sheet open onOpenChange={open => { if (!open) setEditingId(null) }} title="Section" cancelLabel="Fermer" onConfirm={() => setEditingId(null)} confirmLabel="OK">
          <div className={styles.detail}>
            <div className={styles.fields}>
              <Field type="text" label="Titre" placeholder="Titre de la section" value={editing.title} onChange={e => onUpdate(editing.id, { title: e.target.value })} />
            </div>
            <div className={styles.fields}>
              <textarea className={styles.textarea} aria-label="Contenu de la section" placeholder="Contenu de la section" value={editing.content}
                onChange={e => onUpdate(editing.id, { content: e.target.value })} />
            </div>
            <ListGroup>
              <li className={styles.destructiveRow}>
                <button type="button" onClick={() => { onRemove(editing.id); setEditingId(null) }}>Supprimer la section</button>
              </li>
            </ListGroup>
          </div>
        </Sheet>
      )}
    </>
  )
}

/** Création ou modification d'un contrat. */
export function ContractFormSheet({ contract, clients, chantiers, templates, quotes, onClose, onSaved }: {
  contract?: ContractListItem | null
  clients: Client[]
  chantiers: Chantier[]
  templates: ContractTemplateOption[]
  quotes: Quote[]
  onClose: () => void
  onSaved: () => void
}) {
  const f = useContractForm({ contract, clients, chantiers, templates, quotes, onSaved })
  const { form } = f
  const money = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n)
  return (
    <Sheet
      open
      onOpenChange={open => { if (!open) onClose() }}
      title={f.mode === 'edit' ? 'Modifier le contrat' : 'Nouveau contrat'}
      description={f.mode === 'edit' ? 'Les modifications nécessitent de régénérer le PDF.' : undefined}
      onConfirm={() => void f.submit()}
      confirmLabel={f.mode === 'edit' ? 'Enregistrer' : 'Créer'}
      confirmLoading={f.loading}
      confirmDisabled={!form.templateKey}
    >
      <div className={styles.detail}>
        {f.error && <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>{f.error}</p>}

        <SegmentedControl fullWidth label="Type de contrat" value={form.contractType} options={TYPE_OPTIONS} onChange={v => f.changeType(v as ContractType)} />

        <ListGroup description="Choisissez le modèle de base ou un modèle personnalisé.">
          <li className={styles.fieldItem}>
            <Field type="select" label="Modèle" value={form.templateKey} onChange={e => f.changeTemplate(e.target.value)}>
              {f.availableTemplates.map(t => <option key={t.key} value={t.key}>{t.title}{t.isCustom ? ' · personnalisé' : ''}</option>)}
            </Field>
          </li>
          <li className={styles.fieldItem}>
            <Field type="select" label="Rôle" value={form.role} onChange={e => f.set('role', e.target.value)}>
              <option value="donneur_ordre">{getRoleLabel('donneur_ordre', form.contractType)}</option>
              <option value="sous_traitant">{getRoleLabel('sous_traitant', form.contractType)}</option>
            </Field>
          </li>
          <li className={styles.fieldItem}>
            <Field type="text" label="Titre" placeholder="Ex : Entretien chaufferie 2026" value={form.title} onChange={e => f.set('title', e.target.value)} />
          </li>
          <li className={styles.fieldItem}>
            <Field type="select" label="Client lié" value={form.clientId} onChange={e => f.changeClient(e.target.value)}>
              <option value="">Aucun client lié</option>
              {clients.map(c => <option key={c.id} value={c.id}>{clientName(c)}</option>)}
            </Field>
          </li>
          <li className={styles.fieldItem}>
            <Field type="select" label="Chantier lié" value={form.chantierId} onChange={e => f.changeChantier(e.target.value)}>
              <option value="">Aucun chantier lié</option>
              {chantiers.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </Field>
          </li>
          <li className={styles.fieldItem}>
            <Field type="select" label="Devis lié" value={form.quoteId} onChange={e => f.set('quoteId', e.target.value)}
              hint="Facultatif : le client pourra valider ce devis en signant le contrat.">
              <option value="">Aucun devis lié</option>
              {f.availableQuotes.map(q => (
                <option key={q.id} value={q.id}>{q.number} - {q.title ?? 'Sans titre'}{q.total_ttc != null ? ` · ${money(q.total_ttc)}` : ''}</option>
              ))}
            </Field>
          </li>
        </ListGroup>

        <ListGroup title="Partie contractante">
          <li className={styles.fieldItem}><Field type="text" label="Nom" placeholder="Raison sociale" value={form.counterpartyName} onChange={e => f.set('counterpartyName', e.target.value)} /></li>
          <li className={styles.fieldItem}><Field type="text" label="E-mail" inputMode="email" placeholder="contact@entreprise.fr" value={form.counterpartyEmail} onChange={e => f.set('counterpartyEmail', e.target.value)} /></li>
          <li className={styles.fieldItem}><Field type="text" label="Téléphone" inputMode="tel" value={form.counterpartyPhone} onChange={e => f.set('counterpartyPhone', e.target.value)} /></li>
          <li className={styles.fieldItem}><Field type="text" label="Adresse" placeholder="Facultatif" value={form.counterpartyAddress} onChange={e => f.set('counterpartyAddress', e.target.value)} /></li>
        </ListGroup>

        <ListGroup title="Durée" description="Si renseignée, cette durée est ajoutée en tête de la clause Durée du contrat.">
          <li className={styles.fieldItem}>
            <Field type="text" label="Durée" placeholder="12 mois renouvelable" value={form.durationText} onChange={e => f.set('durationText', e.target.value)} />
          </li>
        </ListGroup>

        <ClausesEditor clauses={form.clauses} onChange={f.setClause} />
        <SectionsEditor sections={form.customSections} onAdd={f.addSection} onUpdate={f.updateSection} onRemove={f.removeSection} />

        <p className={styles.hint} style={{ marginTop: 0 }}>{CONTRACT_DISCLAIMER}</p>
      </div>
    </Sheet>
  )
}

/** Modèles de contrat : liste des modèles personnalisés, création et suppression. */
export function TemplatesSheet({ templates, canCreate, canDelete, onClose, onSaved }: {
  templates: ContractTemplateOption[]
  canCreate: boolean
  canDelete: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const t = useContractTemplates({ templates, onSaved })
  const [creating, setCreating] = useState(false)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const target = t.customTemplates.find(x => x.key === confirmKey)
  return (
    <>
      <Sheet open onOpenChange={open => { if (!open) onClose() }} title="Modèles de contrat" description="Créez et gérez vos modèles réutilisables." cancelLabel="Fermer">
        <div className={styles.detail}>
          {t.error && <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>{t.error}</p>}
          <ListGroup title="Mes modèles">
            {t.customTemplates.length === 0 && <li><p className={styles.notice}>Aucun modèle personnalisé pour le moment.</p></li>}
            {t.customTemplates.map(template => (
              canDelete ? (
                <ListRow
                  key={template.key}
                  title={template.title}
                  description={`${CONTRACT_TYPE_LABELS[template.type]} · toucher pour supprimer`}
                  disabled={t.deletingKey === template.key}
                  onClick={() => setConfirmKey(template.key)}
                />
              ) : (
                <ListRow key={template.key} title={template.title} description={CONTRACT_TYPE_LABELS[template.type]} />
              )
            ))}
          </ListGroup>
          {canCreate && (
            <ListGroup>
              <ListRow title="Nouveau modèle" className={styles.accentRow} onClick={() => setCreating(true)} />
            </ListGroup>
          )}
        </div>
      </Sheet>

      {creating && (
        <Sheet open onOpenChange={open => { if (!open) setCreating(false) }} title="Nouveau modèle" onConfirm={() => void t.submit()} confirmLabel="Créer" confirmLoading={t.loading}>
          <div className={styles.detail}>
            <SegmentedControl fullWidth label="Type de contrat" value={t.contractType} options={TYPE_OPTIONS} onChange={v => t.changeType(v as ContractType)} />
            <div className={styles.fields}>
              <Field type="select" label="Base" value={t.baseKey} onChange={e => t.changeBase(e.target.value)}>
                {t.availableTemplates.map(x => <option key={x.key} value={x.key}>{x.title}</option>)}
              </Field>
              <Field type="text" label="Nom" placeholder="Ex. Maintenance copropriété" value={t.title} onChange={e => t.setTitle(e.target.value)} />
            </div>
            <ClausesEditor clauses={t.clauses} onChange={t.setClause} />
            <SectionsEditor sections={t.customSections} onAdd={t.addSection} onUpdate={t.updateSection} onRemove={t.removeSection} />
          </div>
        </Sheet>
      )}

      <AlertDialog
        open={confirmKey !== null}
        onOpenChange={open => { if (!open) setConfirmKey(null) }}
        title={`Supprimer « ${target?.title ?? 'ce modèle'} » ?`}
        description="Cette action est irréversible. Les contrats déjà créés ne sont pas touchés."
        confirmLabel="Supprimer"
        onConfirm={() => { const key = confirmKey; setConfirmKey(null); if (key) void t.remove(key) }}
      />
    </>
  )
}

/** Actions d'un contrat. */
export function ContractActionsSheet({ q, contract, canCreate, canEdit, canDelete, onClose }: {
  q: Contracts
  contract: ContractListItem
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
  onClose: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const busy = q.busyId === contract.id
  const run = (fn: () => void) => () => { onClose(); fn() }
  const status = STATUS_LABELS[contract.status]
  return (
    <>
      <Sheet open onOpenChange={open => { if (!open) onClose() }} title={contract.title} description={`${contract.counterparty_name} · ${status.label}`} cancelLabel="Fermer">
        <div className={styles.pickList}>
          <ListGroup>
            {canEdit && contract.status !== 'archived' && <ListRow title="Modifier" disabled={busy} onClick={run(() => q.setEditingContract(contract))} />}
            {canEdit && <ListRow title="Générer et ouvrir le PDF" disabled={busy} onClick={run(() => void q.generateAndOpenPdf(contract.id))} />}
            {contract.pdf_reference && <ListRow title="Télécharger le PDF" description={contract.pdf_reference} href={`/api/pdf/contract/${contract.id}?download=1`} />}
            {canEdit && contract.status === 'draft' && <ListRow title="Envoyer par e-mail" disabled={busy} onClick={run(() => void q.openSendModal(contract))} />}
            {canEdit && contract.status !== 'signed' && contract.status !== 'archived' && (
              <ListRow title="Marquer comme signé" disabled={busy} onClick={run(() => void q.markStatus(contract.id, 'signed'))} />
            )}
          </ListGroup>
          <ListGroup>
            {canCreate && <ListRow title="Créer un modèle depuis ce contrat" disabled={busy} onClick={run(() => void q.convertToTemplate(contract))} />}
            {canEdit && contract.status !== 'archived' && <ListRow title="Archiver" disabled={busy} onClick={run(() => void q.markStatus(contract.id, 'archived'))} />}
          </ListGroup>
          {canDelete && (
            <ListGroup>
              <li className={styles.destructiveRow}><button type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>Supprimer le contrat</button></li>
            </ListGroup>
          )}
        </div>
      </Sheet>
      <AlertDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Supprimer ce contrat ?"
        description="Le contrat sera supprimé définitivement."
        confirmLabel="Supprimer"
        onConfirm={() => { setConfirmDelete(false); onClose(); void q.removeContract(contract.id) }}
      />
    </>
  )
}
