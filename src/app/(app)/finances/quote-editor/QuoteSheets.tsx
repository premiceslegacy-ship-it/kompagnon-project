'use client'
// @atelier-migrated

import { useState } from 'react'
import { Check } from 'lucide-react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SearchField } from '@/components/ui/SearchField'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { NumericInput } from '@/components/ui/NumericInput'
import { Sheet } from '@/components/ui/Sheet'
import { StatusPill } from '@/components/ui/StatusPill'
import { hasDimensionPricing } from '@/lib/catalog-pricing'
import { getCatalogSaleUnitPrice, getInternalResourceUnitCost } from '@/lib/catalog-ui'
import type { CatalogLaborRate, CatalogMaterial } from '@/lib/data/queries/catalog'
import { clientDisplayName, fmt } from './quoteEditorModel'
import type { QuoteEditor } from './useQuoteEditor'
import styles from './QuoteEditor.module.css'

type SheetProps = { q: QuoteEditor; open: boolean; onClose: () => void }

const tick = <Check size={18} aria-hidden="true" className={styles.accentRow} />

/** Choix du client, avec création à la volée. */
export function ClientSheet({ q, open, onClose, onNewClient }: SheetProps & { onNewClient: () => void }) {
  const [search, setSearch] = useState('')
  const needle = search.trim().toLowerCase()
  const clients = q.clients.filter(c => !needle || clientDisplayName(c).toLowerCase().includes(needle) || (c.email ?? '').toLowerCase().includes(needle))
  const select = (id: string) => {
    q.setClientId(id)
    q.scheduleHeaderSave({ client_id: id || null })
    onClose()
  }
  return (
    <Sheet open={open} onOpenChange={next => { if (!next) onClose() }} title="Client" cancelLabel="Fermer">
      <div className={styles.pickList}>
        <SearchField value={search} onChange={setSearch} label="Rechercher un client" placeholder="Rechercher" />
        <ListGroup>
          <ListRow title="Nouveau client" description="Créer et sélectionner" className={styles.accentRow} onClick={onNewClient} />
        </ListGroup>
        <ListGroup>
          <ListRow title="Sans client" trailing={q.clientId === '' ? tick : undefined} onClick={() => select('')} />
          {clients.map(c => (
            <ListRow
              key={c.id}
              title={clientDisplayName(c)}
              description={c.email ?? undefined}
              trailing={q.clientId === c.id ? tick : undefined}
              onClick={() => select(c.id)}
            />
          ))}
        </ListGroup>
      </div>
    </Sheet>
  )
}

export function NewClientSheet({ q, open, onClose }: SheetProps) {
  const form = q.newClientForm
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    q.setNewClientForm(p => ({ ...p, [key]: e.target.value }))
  const individual = q.newClientType === 'individual'
  return (
    <Sheet
      open={open}
      onOpenChange={next => { if (!next) onClose() }}
      title="Nouveau client"
      onConfirm={q.handleCreateClientInline}
      confirmLabel="Créer"
      confirmLoading={q.newClientPending}
    >
      <div className={styles.detail}>
        <SegmentedControl
          fullWidth
          label="Type de client"
          value={q.newClientType}
          options={[{ value: 'company', label: 'Professionnel' }, { value: 'individual', label: 'Particulier' }]}
          onChange={v => q.setNewClientType(v as 'company' | 'individual')}
        />
        <div className={styles.fields}>
          {!individual && <Field type="text" label="Raison sociale" placeholder="Obligatoire" value={form.company_name} onChange={set('company_name')} />}
          {!individual && <Field type="text" label="Contact" placeholder="Nom du référent" value={form.contact_name} onChange={set('contact_name')} />}
          <Field type="text" label="Prénom" placeholder={individual ? 'Obligatoire' : 'Facultatif'} value={form.first_name} onChange={set('first_name')} />
          <Field type="text" label="Nom" placeholder={individual ? 'Obligatoire' : 'Facultatif'} value={form.last_name} onChange={set('last_name')} />
          <Field type="text" label="Email" placeholder="nom@exemple.fr" inputMode="email" value={form.email} onChange={set('email')} />
          <Field type="text" label="Téléphone" inputMode="tel" value={form.phone} onChange={set('phone')} />
          <Field type="text" label="Adresse" value={form.address_line1} onChange={set('address_line1')} />
          <Field type="text" label="Code postal" inputMode="numeric" value={form.postal_code} onChange={set('postal_code')} />
          <Field type="text" label="Ville" value={form.city} onChange={set('city')} />
        </div>
        {q.newClientError && <p className={`${styles.hint} ${styles.warn}`} role="alert">{q.newClientError}</p>}
      </div>
    </Sheet>
  )
}

/** Devis de référence (avenant). */
export function ReferenceSheet({ q, open, onClose }: SheetProps) {
  const candidates = q.allQuotes.filter(x => x.client_id === q.clientId && x.id !== q.quoteId)
  const select = (id: string | null) => {
    q.setParentQuoteId(id)
    q.scheduleHeaderSave({ parent_quote_id: id })
    onClose()
  }
  return (
    <Sheet open={open} onOpenChange={next => { if (!next) onClose() }} title="Devis de référence" cancelLabel="Fermer">
      <div className={styles.pickList}>
        <ListGroup description="Un avenant ou modificatif : les situations de travaux se calculent sur le total du devis de référence.">
          <ListRow title="Aucun" description="Devis original" trailing={!q.parentQuoteId ? tick : undefined} onClick={() => select(null)} />
          {candidates.map(x => (
            <ListRow
              key={x.id}
              title={`${x.number ? `${x.number} · ` : ''}${x.title ?? 'Sans titre'}`}
              trailing={q.parentQuoteId === x.id ? tick : undefined}
              onClick={() => select(x.id)}
            />
          ))}
        </ListGroup>
      </div>
    </Sheet>
  )
}

/** Texte d'introduction et clauses réutilisables. */
export function IntroSheet({ q, open, onClose }: SheetProps) {
  return (
    <Sheet open={open} onOpenChange={next => { if (!next) onClose() }} title="Introduction" cancelLabel="Fermer" onConfirm={onClose} confirmLabel="OK">
      <div className={styles.detail}>
        <div className={styles.fields}>
          <textarea
            className={styles.textarea}
            aria-label="Texte d'introduction"
            value={q.notesClient}
            rows={6}
            onChange={e => q.updateIntro(e.target.value)}
          />
        </div>
        {q.clauseTemplates.length > 0 && (
          <ListGroup>
            <ListRow
              title="Insérer une clause"
              description="Acompte, délais, garanties"
              onClick={() => { q.setClauseTarget('notes'); q.setClauseModalOpen(true) }}
            />
          </ListGroup>
        )}
      </div>
    </Sheet>
  )
}

export function ClausesSheet({ q }: { q: QuoteEditor }) {
  const categories = [...new Set(q.clauseTemplates.map(c => c.category ?? 'Général'))]
  return (
    <Sheet open={q.clauseModalOpen && q.clauseTemplates.length > 0} onOpenChange={q.setClauseModalOpen} title="Insérer une clause" cancelLabel="Fermer">
      <div className={styles.pickList}>
        {categories.map(cat => (
          <ListGroup key={cat} title={cat}>
            {q.clauseTemplates.filter(c => (c.category ?? 'Général') === cat).map(clause => (
              <ListRow
                key={clause.id}
                title={clause.title}
                description={clause.body}
                onClick={() => {
                  if (q.clauseTarget === 'notes') {
                    q.updateIntro(q.notesClient + (q.notesClient ? '\n\n' : '') + clause.body)
                  }
                  q.setClauseModalOpen(false)
                }}
              />
            ))}
          </ListGroup>
        ))}
      </div>
    </Sheet>
  )
}

const AID_PRESETS = ['MaPrimeRénov\'', 'CEE', 'Éco-PTZ', 'Anah']

/** Aide ou subvention déduite du reste à charge. */
export function AidSheet({ q, open, onClose }: SheetProps) {
  const currency = q.initialQuote?.currency === 'USD' ? '$' : '€'
  const remove = () => {
    q.setShowAid(false)
    q.setAidLabel('')
    q.setAidAmount(null)
    q.scheduleHeaderSave({ aid_label: null, aid_amount: null })
    onClose()
  }
  return (
    <Sheet open={open} onOpenChange={next => { if (!next) onClose() }} title="Aide ou subvention" cancelLabel="Fermer" onConfirm={onClose} confirmLabel="OK">
      <div className={styles.detail}>
        <ListGroup title="Type d'aide">
          {AID_PRESETS.map(preset => (
            <ListRow
              key={preset}
              title={preset}
              trailing={q.aidLabel === preset ? tick : undefined}
              onClick={() => { q.setShowAid(true); q.setAidLabel(preset); q.scheduleHeaderSave({ aid_label: preset, aid_amount: q.aidAmount }) }}
            />
          ))}
        </ListGroup>
        <SegmentedControl
          fullWidth
          label="Unité du montant"
          value={q.aidMode}
          options={[{ value: '€', label: currency }, { value: '%', label: '%' }]}
          onChange={v => q.setAidMode(v as '€' | '%')}
        />
        <div className={styles.fields}>
          <Field
            type="text"
            label="Libellé"
            placeholder="Autre aide"
            value={q.aidLabel}
            onChange={e => { q.setShowAid(true); q.setAidLabel(e.target.value); q.scheduleHeaderSave({ aid_label: e.target.value || null, aid_amount: q.aidAmount }) }}
          />
          <Field
            type="number"
            label="Montant déduit"
            min={0}
            max={q.aidMode === '%' ? 100 : q.totalTtc}
            placeholder="0"
            value={q.aidMode === '%'
              ? (q.aidAmount != null && q.totalTtc > 0 ? Math.round((q.aidAmount / q.totalTtc) * 10000) / 100 : null)
              : q.aidAmount}
            onChange={v => {
              q.setShowAid(true)
              if (v == null) { q.setAidAmount(null); q.scheduleHeaderSave({ aid_label: q.aidLabel || null, aid_amount: null }); return }
              const val = q.aidMode === '%'
                ? Math.round(Math.min(100, Math.max(0, v)) * q.totalTtc) / 100
                : Math.min(q.totalTtc, Math.max(0, v))
              q.setAidAmount(val)
              q.scheduleHeaderSave({ aid_label: q.aidLabel || null, aid_amount: val })
            }}
          />
        </div>
        {q.aidAmount != null && q.aidAmount > 0 && (
          <ListGroup>
            <ListRow title="Total TTC" trailing={<span className={styles.amount}>{fmt(q.totalTtc)}</span>} />
            <ListRow title={q.aidLabel || 'Aide'} trailing={<span className={styles.amount}>−{fmt(q.aidAmount)}</span>} />
            <ListRow title="Reste à charge" trailing={<span className={styles.recapTotal}>{fmt(Math.max(0, q.totalTtc - q.aidAmount))}</span>} />
          </ListGroup>
        )}
        {q.showAid && (
          <ListGroup>
            <li className={styles.destructiveRow}><button type="button" onClick={remove}>Retirer l&apos;aide</button></li>
          </ListGroup>
        )}
      </div>
    </Sheet>
  )
}

/** Rentabilité : marge, coûts internes et répartition dans les prix visibles. */
export function RentabilitySheet({ q, open, onClose }: SheetProps) {
  return (
    <>
      <Sheet open={open} onOpenChange={next => { if (!next) onClose() }} title="Rentabilité" cancelLabel="Fermer" onConfirm={onClose} confirmLabel="OK">
        <div className={styles.detail}>
          <div className={styles.total}>
            <small>Marge brute</small>
            <b className={q.margeHt >= 0 ? styles.up : styles.down}>{fmt(q.margeHt)}</b>
            <small>{q.margePct.toFixed(1).replace('.', ',')}&nbsp;% du total HT</small>
          </div>
          <ListGroup description="Les lignes internes ne figurent pas sur le PDF du client.">
            <ListRow title="Total client HT" trailing={<span className={styles.amount}>{fmt(q.totalHt)}</span>} />
            <ListRow title="Coût interne" trailing={<span className={styles.amount}>−{fmt(q.totalInternalHt)}</span>} />
            {q.internalOnlyHt > 0 && q.internalSaleToDistributeHt !== q.internalOnlyHt && (
              <ListRow title="Dont coûts masqués" trailing={<span className={styles.amount}>{fmt(q.internalOnlyHt)}</span>} />
            )}
            {q.internalSaleToDistributeHt > 0 && (
              <ListRow title="Montant interne à vendre" trailing={<span className={styles.amount}>{fmt(q.internalSaleToDistributeHt)}</span>} />
            )}
          </ListGroup>
          {q.internalOnlyHt > 0 && q.internalSaleToDistributeHt <= 0 && (
            <p className={styles.hint}>Montants internes déjà répartis dans les lignes visibles.</p>
          )}

          {q.internalSaleToDistributeHt > 0 && !q.manualDistributionMode && (
            <ListGroup
              title="Répartir le montant interne"
              description="Auto : au prorata du montant HT visible. Manuel : vous choisissez le poids de chaque ligne. Une fois intégré, le montant à vendre est neutralisé pour éviter un double comptage."
            >
              <ListRow title="Répartir automatiquement" disabled={!q.canDistributeInternalCosts} onClick={() => q.handleDistributeInternalCostsIntoVisiblePrices()} />
              <ListRow title="Choisir le poids de chaque ligne" disabled={!q.canDistributeInternalCosts} onClick={q.openManualDistribution} />
              <ListRow title="Marquer comme intégré" description="Sans modifier les prix visibles" onClick={() => q.handleMarkInternalSalesAlreadyDistributed()} />
            </ListGroup>
          )}

          {q.manualDistributionMode && (
            <ListGroup
              title="Poids par ligne"
              description={`Répartir ${fmt(q.internalSaleToDistributeHt)} HT. Total : ${q.distributionWeightSum.toFixed(1).replace('.', ',')} %${q.distributionWeightValid ? '' : ' (doit faire 100 %)'}`}
            >
              {q.sections.flatMap(section =>
                section.items
                  .filter(item => !item.is_internal && !item.price_pending && item.quantity > 0)
                  .map(item => {
                    const key = q.distributionKey(section._tempId, item._tempId)
                    return (
                      <li key={key} className={styles.weightRow}>
                        <span>{item.description || 'Ligne sans description'}</span>
                        <NumericInput
                          aria-label={`Poids de ${item.description || 'la ligne'} en pourcentage`}
                          min={0}
                          max={100}
                          decimals={1}
                          className={styles.weightInput}
                          value={q.distributionWeights.get(key) ?? 0}
                          onChange={v => q.setDistributionWeight(section._tempId, item._tempId, v)}
                        />
                      </li>
                    )
                  }),
              )}
              <li className={styles.panel}>
                <div className={styles.inline} style={{ padding: 12 }}>
                  <Button size="md" variant="secondary" onClick={q.closeManualDistribution}>Annuler</Button>
                  <Button size="md" disabled={!q.distributionWeightValid} onClick={() => q.handleDistributeInternalCostsIntoVisiblePrices()}>Appliquer</Button>
                </div>
              </li>
            </ListGroup>
          )}
        </div>
      </Sheet>
      <AlertDialog
        open={q.distributionConfirm !== null}
        onOpenChange={next => { if (!next) q.setDistributionConfirm(null) }}
        title={q.distributionConfirm?.title ?? ''}
        description={q.distributionConfirm?.message}
        confirmLabel={q.distributionConfirm?.kind === 'integrate' ? 'Marquer' : 'Répartir'}
        onConfirm={() => {
          const kind = q.distributionConfirm?.kind
          q.setDistributionConfirm(null)
          if (kind === 'integrate') q.handleMarkInternalSalesAlreadyDistributed(true)
          else q.handleDistributeInternalCostsIntoVisiblePrices(true)
        }}
      />
    </>
  )
}

/** Titre, marge du lot et suppression d'une section. */
export function SectionSheet({ q, sectionId, onClose }: { q: QuoteEditor; sectionId: string; onClose: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const sec = q.sections.find(s => s._tempId === sectionId)
  if (!sec) return null
  const visible = sec.items.filter(i => !i.is_internal)
  const subtotal = visible.reduce((s, i) => s + i.quantity * i.unit_price, 0)
  const cost = sec.items.reduce((s, i) => s + i.quantity * (i.unit_cost_ht != null ? i.unit_cost_ht : (i.is_internal ? i.unit_price : 0)), 0)
  const margin = subtotal - cost
  const marginPct = subtotal > 0 ? (margin / subtotal) * 100 : 0
  const hasCosts = sec.items.some(i => i.unit_cost_ht != null || i.is_internal)
  return (
    <>
      <Sheet open onOpenChange={next => { if (!next) onClose() }} title="Lot" cancelLabel="Fermer" onConfirm={onClose} confirmLabel="OK">
        <div className={styles.detail}>
          <div className={styles.fields}>
            <Field type="text" label="Titre" placeholder="Nom du lot" value={sec.title} onChange={e => q.handleSectionTitleChange(sec._tempId, e.target.value)} />
          </div>
          <ListGroup>
            <ListRow title="Sous-total HT" trailing={<span className={styles.amount}>{fmt(subtotal)}</span>} />
            {hasCosts && (
              <ListRow
                title="Marge du lot"
                description={marginPct < 15 ? 'Marge inférieure à 15 %' : undefined}
                trailing={<span className={`${styles.amount} ${margin >= 0 ? '' : styles.down}`}>{fmt(margin)} · {marginPct.toFixed(0)}&nbsp;%</span>}
              />
            )}
          </ListGroup>
          <ListGroup>
            <li className={styles.destructiveRow}><button type="button" onClick={() => setConfirmDelete(true)}>Supprimer le lot</button></li>
          </ListGroup>
        </div>
      </Sheet>
      <AlertDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Supprimer ce lot ?"
        description={sec.items.length > 0 ? `Le lot et ses ${sec.items.length} ligne${sec.items.length > 1 ? 's' : ''} seront retirés du devis.` : 'Le lot sera retiré du devis.'}
        confirmLabel="Supprimer"
        onConfirm={() => { setConfirmDelete(false); onClose(); void q.handleRemoveSection(sec._tempId) }}
      />
    </>
  )
}

/** Ajout d'une ligne dans un lot : les cinq départs de l'ancien éditeur. */
export function AddLineSheet({ q, sectionId, onClose, onAdding }: { q: QuoteEditor; sectionId: string; onClose: () => void; onAdding: (knownItemIds: string[]) => void }) {
  const addFree = (internal: boolean) => {
    onAdding((q.sectionsRef.current.find(s => s._tempId === sectionId)?.items ?? []).map(i => i._tempId))
    onClose()
    void q.handleAddFreeItem(sectionId, internal)
  }
  return (
    <Sheet open onOpenChange={next => { if (!next) onClose() }} title="Ajouter une ligne" cancelLabel="Fermer">
      <div className={styles.pickList}>
        <ListGroup>
          <ListRow title="Saisie libre" description="Une prestation à décrire" onClick={() => addFree(false)} />
          <ListRow
            title="Depuis le catalogue"
            description="Matériaux, ressources"
            onClick={() => { onClose(); q.setCatalogTarget(sectionId); q.setCatalogSearch(''); q.setCatalogOpen(true) }}
          />
        </ListGroup>
        <ListGroup title="Coûts internes" description="Ces lignes comptent dans votre marge mais n'apparaissent pas sur le PDF du client.">
          <ListRow
            title="Transport"
            description="Distance et carburant"
            onClick={() => { onClose(); q.setTransportTarget(sectionId); q.setShowTransport(true) }}
          />
          <ListRow
            title="Équipement amorti"
            description="Coût par usage d'un outil"
            onClick={() => {
              onClose()
              q.setEquipmentTarget(sectionId); q.setEquipmentName(''); q.setEquipmentPurchase(0); q.setEquipmentUses(100)
              q.setShowEquipment(true)
            }}
          />
          <ListRow title="Coût interne" description="Une ligne de coût libre" onClick={() => addFree(true)} />
        </ListGroup>
      </div>
    </Sheet>
  )
}

export function TransportSheet({ q }: { q: QuoteEditor }) {
  return (
    <Sheet
      open={q.showTransport}
      onOpenChange={q.setShowTransport}
      title="Transport"
      onConfirm={() => void q.handleAddTransport()}
      confirmLabel="Ajouter"
    >
      <div className={styles.detail}>
        <div className={styles.total}>
          <small>Coût du carburant</small>
          <b>{fmt(q.transportCost)}</b>
        </div>
        <div className={styles.fields}>
          <Field type="number" label="Distance A/R (km)" min={1} value={q.transportKm} onChange={v => q.setTransportKm(v ?? 1)} />
          <Field type="number" label="Conso (L/100 km)" min={1} decimals={2} value={q.transportConso} onChange={v => q.setTransportConso(v ?? 1)} />
          <Field type="number" label="Carburant (€/L)" min={0} decimals={3} value={q.transportPrixL} onChange={v => q.setTransportPrixL(v ?? 0)} />
        </div>
        <p className={styles.hint}>Volume de carburant : {q.transportLiters.toFixed(2).replace('.', ',')}&nbsp;L. Ligne interne, absente du PDF du client.</p>
      </div>
    </Sheet>
  )
}

export function EquipmentSheet({ q }: { q: QuoteEditor }) {
  return (
    <Sheet
      open={q.showEquipment}
      onOpenChange={q.setShowEquipment}
      title="Équipement amorti"
      onConfirm={() => void q.handleAddEquipment()}
      confirmLabel="Ajouter"
      confirmDisabled={q.equipmentPurchase <= 0 || q.equipmentUses <= 0}
    >
      <div className={styles.detail}>
        <div className={styles.total}>
          <small>Coût par usage</small>
          <b>{fmt(q.equipmentPurchase > 0 ? q.equipmentCostPerUse : 0)}</b>
        </div>
        <div className={styles.fields}>
          <Field type="text" label="Équipement" placeholder="Aspirateur industriel" value={q.equipmentName} onChange={e => q.setEquipmentName(e.target.value)} />
          <Field type="number" label="Prix d'achat (€)" min={0} decimals={2} value={q.equipmentPurchase || null} onChange={v => q.setEquipmentPurchase(v ?? 0)} />
          <Field type="number" label="Usages sur la vie" min={1} decimals={0} value={q.equipmentUses} onChange={v => q.setEquipmentUses(v ?? 1)} />
        </div>
        <p className={styles.hint}>Le coût par usage est ajouté à votre coût interne, sans modifier les prix visibles.</p>
      </div>
    </Sheet>
  )
}

export function CatalogSheet({ q }: { q: QuoteEditor }) {
  const materials = q.catalogFiltered.filter((e): e is CatalogMaterial & { _type: 'material' } => e._type === 'material')
  const labor = q.catalogFiltered.filter((e): e is CatalogLaborRate & { _type: 'labor' } => e._type === 'labor')
  return (
    <Sheet open={q.catalogOpen} onOpenChange={q.setCatalogOpen} title={q.catalogContext.labelSet.catalogTitle} cancelLabel="Fermer">
      <div className={styles.pickList}>
        <SearchField value={q.catalogSearch} onChange={q.setCatalogSearch} label="Rechercher dans le catalogue" placeholder="Rechercher" />
        {materials.length === 0 && labor.length === 0 && (
          <p className={styles.hint}>Aucun résultat. Ajoutez des éléments dans le catalogue pour les retrouver ici.</p>
        )}
        {materials.length > 0 && (
          <ListGroup title={q.catalogContext.labelSet.material.plural}>
            {materials.map(mat => (
              <ListRow
                key={mat.id}
                title={mat.name}
                description={[mat.category, hasDimensionPricing(mat) ? 'dimensionnel' : null].filter(Boolean).join(' · ') || undefined}
                trailing={<span className={styles.amount}>{fmt(getCatalogSaleUnitPrice(mat))}&nbsp;/&nbsp;{mat.unit ?? 'u'}</span>}
                onClick={() => void q.handleCatalogSelect(mat, 'material')}
              />
            ))}
          </ListGroup>
        )}
        {labor.length > 0 && (
          <ListGroup title={q.catalogContext.labelSet.laborRate.plural}>
            {labor.map(lr => (
              <ListRow
                key={lr.id}
                title={lr.designation}
                description={lr.category ?? undefined}
                trailing={<span className={styles.amount}>{fmt(getInternalResourceUnitCost(lr))}&nbsp;/&nbsp;{lr.unit ?? 'h'}</span>}
                onClick={() => void q.handleCatalogSelect(lr, 'labor')}
              />
            ))}
          </ListGroup>
        )}
      </div>
    </Sheet>
  )
}

export function PrestationSheet({ q }: { q: QuoteEditor }) {
  const needle = q.prestationSearch.toLowerCase()
  const list = q.prestationTypes.filter(p => p.is_active && (!needle || p.name.toLowerCase().includes(needle) || (p.category ?? '').toLowerCase().includes(needle)))
  const bundle = q.catalogContext.labelSet.bundleTemplate
  return (
    <Sheet open={q.prestationOpen} onOpenChange={q.setPrestationOpen} title={bundle.plural} cancelLabel="Fermer">
      <div className={styles.pickList}>
        <SearchField value={q.prestationSearch} onChange={q.setPrestationSearch} label={`Rechercher ${bundle.singular.toLowerCase()}`} placeholder="Rechercher" />
        {list.length === 0 ? (
          <p className={styles.hint}>Aucune prestation trouvée. Créez des {bundle.plural.toLowerCase()} dans le catalogue.</p>
        ) : (
          <ListGroup>
            {list.map(p => (
              <ListRow
                key={p.id}
                title={p.name}
                description={[p.category, p.items && p.items.length > 0 ? `${p.items.length} ligne${p.items.length > 1 ? 's' : ''}` : null].filter(Boolean).join(' · ') || undefined}
                trailing={<span className={styles.amount}>{fmt(p.base_price_ht)}&nbsp;/&nbsp;{p.unit}</span>}
                onClick={() => void q.handlePrestationSelect(p)}
              />
            ))}
          </ListGroup>
        )}
      </div>
    </Sheet>
  )
}

export function VariantSheet({ q }: { q: QuoteEditor }) {
  return (
    <Sheet
      open={q.variantModalOpen}
      onOpenChange={q.setVariantModalOpen}
      title="Nouvelle variante"
      description="Ce devis sera dupliqué. Donnez un nom à cette variante, par exemple « Version B inox » ou « Option sans pose »."
      onConfirm={() => void q.handleCreateVariant()}
      confirmLabel="Créer"
      confirmLoading={q.variantCreating}
      confirmDisabled={!q.variantNewLabel.trim()}
    >
      <div className={styles.detail}>
        <div className={styles.fields}>
          {q.variantLabel === '' && (
            <Field
              type="text"
              label="Version actuelle"
              placeholder="Version A acier"
              value={q.variantLabel}
              onChange={e => { q.setVariantLabel(e.target.value); if (q.quoteId) q.scheduleHeaderSave({ variant_label: e.target.value }) }}
            />
          )}
          <Field
            type="text"
            label="Nouvelle variante"
            placeholder="Version B inox"
            value={q.variantNewLabel}
            onChange={e => q.setVariantNewLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && q.variantNewLabel.trim()) void q.handleCreateVariant() }}
          />
        </div>
      </div>
    </Sheet>
  )
}

/** Points à vérifier : liste simple, avec envoi quand même si on arrive ici en envoyant. */
export function CheckSheet({ warnings, open, onClose, onSendAnyway }: { warnings: string[]; open: boolean; onClose: () => void; onSendAnyway?: () => void }) {
  return (
    <Sheet
      open={open}
      onOpenChange={next => { if (!next) onClose() }}
      title={onSendAnyway ? 'Avant d\'envoyer' : 'Points à vérifier'}
      description="Ces points demandent votre attention."
      cancelLabel="Corriger"
      onConfirm={onSendAnyway}
      confirmLabel="Envoyer quand même"
    >
      <ListGroup>
        {warnings.map((w, i) => (
          <ListRow key={i} title={w} trailing={<StatusPill status="wait">À vérifier</StatusPill>} />
        ))}
      </ListGroup>
    </Sheet>
  )
}
