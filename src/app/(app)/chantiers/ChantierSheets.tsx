'use client'
// @atelier-migrated

import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Field } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import type { Client } from '@/lib/data/queries/clients'
import type { QuoteStub } from '@/lib/data/queries/quotes'
import { useNewChantierForm } from './useChantiers'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'

/** Premier choix : un chantier de travaux ou un entretien récurrent. */
export function CreateChoiceSheet({ onClose, onSelectChantier, onSelectEntretien }: {
  onClose: () => void
  onSelectChantier: () => void
  onSelectEntretien: () => void
}) {
  return (
    <Sheet open onOpenChange={o => { if (!o) onClose() }} title="Créer un suivi" description="Choisissez le bon type de dossier à ouvrir.">
      <ListGroup description="Un entretien récurrent regroupe contrat, interventions, équipements et facturation périodique.">
        <ListRow
          title="Chantier / travaux"
          description="Devis, situations, planning, budget, photos, équipes et rentabilité."
          onClick={onSelectChantier}
        />
        <ListRow
          title="Entretien récurrent"
          description="Contrat d'entretien avec interventions, équipements et facturation périodique."
          onClick={onSelectEntretien}
        />
      </ListGroup>
    </Sheet>
  )
}

/** Création d'un chantier. Un devis choisi pré-remplit tout le reste. */
export function NewChantierSheet({ clients, linkableQuotes, onClose, onCreated }: {
  clients: Client[]
  linkableQuotes: QuoteStub[]
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const f = useNewChantierForm(linkableQuotes, onCreated)
  const { form, set } = f

  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) onClose() }}
      title="Nouveau chantier"
      description="Renseignez les informations du chantier."
      confirmLabel="Créer le chantier"
      confirmLoading={f.loading}
      confirmDisabled={!form.title.trim()}
      onConfirm={f.submit}
    >
      <div className={styles.stack}>
        {linkableQuotes.length > 0 && (
          <Field
            type="select"
            label="Issu d'un devis"
            hint="Optionnel : pré-remplit les informations."
            value={form.quoteId}
            onChange={e => f.handleQuoteChange(e.target.value)}
          >
            <option value="">Nouveau chantier sans devis</option>
            {linkableQuotes.map(q => (
              <option key={q.id} value={q.id}>
                {q.number ? `${q.number} · ` : ''}{q.title ?? 'Sans titre'}{q.client_name ? ` (${q.client_name})` : ''}
              </option>
            ))}
          </Field>
        )}
        <div className={styles.fields}>
          <Field type="text" label="Titre du chantier" placeholder="Réfection toiture bâtiment A" value={form.title} onChange={e => set('title', e.target.value)} required />
          <Field type="select" label="Client" value={form.clientId} onChange={e => set('clientId', e.target.value)}>
            <option value="">Aucun client associé</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.company_name ?? [c.first_name, c.last_name].filter(Boolean).join(' ')}</option>
            ))}
          </Field>
        </div>
        <div className={styles.fields}>
          <Field type="text" label="Adresse" placeholder="Rue, numéro" value={form.addressLine1} onChange={e => set('addressLine1', e.target.value)} />
          <Field type="text" label="Code postal" inputMode="numeric" value={form.postalCode} onChange={e => set('postalCode', e.target.value)} />
          <Field type="text" label="Ville" value={form.city} onChange={e => set('city', e.target.value)} />
        </div>
        <div className={styles.fields}>
          <div className={styles.fieldRow}>
            <label htmlFor="new-chantier-start">Début</label>
            <input id="new-chantier-start" type="date" className={styles.dateInput} value={form.startDate} onChange={e => set('startDate', e.target.value)} />
          </div>
          <div className={styles.fieldRow}>
            <label htmlFor="new-chantier-end">Fin estimée</label>
            <input id="new-chantier-end" type="date" className={styles.dateInput} value={form.estimatedEndDate} onChange={e => set('estimatedEndDate', e.target.value)} />
          </div>
          <Field type="text" label="Budget HT (€)" inputMode="decimal" placeholder="0" value={form.budgetHt} onChange={e => set('budgetHt', e.target.value)} />
        </div>
        <div className={styles.fields}>
          <Field type="text" label="Personne référente" placeholder="Nom du contact" value={form.contactName} onChange={e => set('contactName', e.target.value)} />
          <Field type="text" label="Email" inputMode="email" value={form.contactEmail} onChange={e => set('contactEmail', e.target.value)} />
          <Field type="text" label="Téléphone" inputMode="tel" value={form.contactPhone} onChange={e => set('contactPhone', e.target.value)} />
        </div>
        {f.error && <p className={screen.error} role="alert">{f.error}</p>}
      </div>
    </Sheet>
  )
}
