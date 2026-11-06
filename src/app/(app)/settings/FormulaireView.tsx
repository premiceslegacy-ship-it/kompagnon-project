'use client'
// @atelier-migrated
// Formulaire public : activation, message d'accueil, mode sur-mesure, notification, éléments du catalogue visibles.

import { Check } from 'lucide-react'
import { Dock } from '@/components/ui/Dock'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Menu } from '@/components/ui/Menu'
import { Switch } from '@/components/ui/Switch'
import CopyButton from './CopyButton'
import { publicFormUrl } from './integrationModel'
import { clearType, countOfType, isPublicItemSelected, selectAllOfType, selectionSummary, type PublicItemType } from './publicFormModel'
import { useSavedDirty } from './useSavedDirty'
import type { SettingsState } from './useSettings'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Settings.module.css'

function Tick() {
  return <span className={local.tick}><Check size={18} aria-label="Visible" role="img" /></span>
}

type CatalogItem = { id: string; name: string; category: string | null; unit?: string | null }

function CatalogGroup({ q, type, title, items }: { q: SettingsState; type: PublicItemType; title: string; items: CatalogItem[] }) {
  const refs = q.publicFormSettings.catalogItemIds
  const setRefs = (catalogItemIds: typeof refs) => q.setPublicFormSettings(p => ({ ...p, catalogItemIds }))
  const menu = [
    { label: 'Tout cocher', onSelect: () => setRefs(selectAllOfType(refs, type, items.map(i => i.id))) },
    { label: 'Tout décocher', onSelect: () => setRefs(clearType(refs, type)) },
  ]
  return (
    <ListGroup
      title={title}
      description={selectionSummary(countOfType(refs, type), items.length)}
      action={<Menu title={title} items={menu} trigger={<button type="button" className={local.groupAction}>Sélection</button>} />}
    >
      {items.map(item => (
        <ListRow
          key={item.id}
          title={item.name}
          description={[item.category, item.unit].filter(Boolean).join(' · ') || undefined}
          trailing={isPublicItemSelected(refs, item.id, type) ? <Tick /> : undefined}
          onClick={() => q.togglePublicCatalogItem(item.id, type)}
        />
      ))}
    </ListGroup>
  )
}

export default function FormulaireView({ q }: { q: SettingsState }) {
  const form = q.publicFormSettings
  const dirty = useSavedDirty(form, q.publicFormSaveStatus)
  const saving = q.publicFormSaveStatus === 'saving'
  const url = publicFormUrl(q.appUrl, q.organization?.slug ?? '')
  const set = (patch: Partial<typeof form>) => q.setPublicFormSettings(p => ({ ...p, ...patch }))
  const labels = q.catalogContext.labelSet

  const noCatalog = q.catalogMaterials.length === 0 && q.catalogPrestationTypes.length === 0

  return (
    <div className={local.detail}>
      <div className={local.sections}>
        <ListGroup description="Permet à vos prospects de demander un devis depuis le lien ci-dessous.">
          <ListRow
            title="Activer le formulaire public"
            description={form.enabled ? 'Activé' : 'Désactivé'}
            trailing={<Switch label="Activer le formulaire public" checked={form.enabled} onChange={enabled => set({ enabled })} />}
          />
          {form.enabled && <ListRow title="Lien du formulaire" description={url} trailing={<CopyButton text={url} />} />}
          {form.enabled && <ListRow title="Ouvrir dans un nouvel onglet" href={url} target="_blank" rel="noopener noreferrer" />}
        </ListGroup>

        <Field type="textarea" rows={3} label="Message d’accueil" placeholder="Bienvenue ! Décrivez vos travaux et nous vous répondrons sous 24 h."
          value={form.welcomeMessage} onChange={e => set({ welcomeMessage: e.target.value })} />

        <ListGroup description="Le prospect peut décrire librement son projet.">
          <ListRow
            title="Mode sur-mesure"
            description={form.customModeEnabled ? 'Description libre activée' : 'Désactivé'}
            trailing={<Switch label="Mode sur-mesure" checked={form.customModeEnabled} onChange={customModeEnabled => set({ customModeEnabled })} />}
          />
        </ListGroup>

        <div>
          <div className={styles.fields}>
            <Field type="text" inputType="email" label="Email de notification" placeholder="contact@monentreprise.fr" value={form.notificationEmail} onChange={e => set({ notificationEmail: e.target.value })} />
          </div>
          <p className={styles.hint}>Vous recevez un email à chaque nouvelle demande.</p>
        </div>

        {q.catalogMaterials.length > 0 && <CatalogGroup q={q} type="material" title={labels.material.plural} items={q.catalogMaterials} />}
        {q.catalogPrestationTypes.length > 0 && <CatalogGroup q={q} type="prestation" title={labels.bundleTemplate.plural} items={q.catalogPrestationTypes} />}
        {noCatalog
          ? <p className={styles.hint}>Aucun élément dans votre catalogue. Ajoutez des matériaux ou des prestations types dans le Catalogue.</p>
          : <p className={styles.hint}>Choisissez ce que vos prospects voient : {labels.material.plural.toLowerCase()} et {labels.bundleTemplate.plural.toLowerCase()}. Les prix, marges et coûts internes ne sont jamais affichés, et la main d’œuvre n’est pas proposée.</p>}
      </div>

      {(dirty || saving) && (
        <Dock totalLabel="Formulaire public" total="Modifié" actionLabel="Enregistrer" onAction={q.handleSavePublicForm} loading={saving} disabled={q.isPending} />
      )}
      {q.publicFormSaveStatus === 'error' && <p className={screen.error} role="alert">Le formulaire n’a pas pu être enregistré.</p>}
    </div>
  )
}
