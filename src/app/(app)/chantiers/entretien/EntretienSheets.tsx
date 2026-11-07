'use client'
// @atelier-migrated
// Feuilles de l'entretien : contrat, intervention, coûts prévus par période, détail d'une période.

import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import { StatusPill } from '@/components/ui/StatusPill'
import { Switch } from '@/components/ui/Switch'
import { Button } from '@/components/ui/Button'
import { LEGAL_VAT_RATES } from '@/lib/utils'
import { DateRow } from '../FormRows'
import {
  BUDGET_SOURCE_LABELS, COST_CATEGORIES, COST_CATEGORY_META, CONTRACT_STATUS, FREQUENCE_LABELS,
  expectedBudgetTotals, fmtMoney, fmtPct, marginStatus, withTimeField, withTravelField,
  type BudgetSource, type ExpectedCostCategory, type PeriodRow,
} from './entretienModel'
import type { ContractDetailState } from './useContractDetail'
import type { EntretienProps, EntretienState } from './useEntretien'
import type { InterventionStatut, MaintenanceContract, MaintenanceFrequence, MaintenanceStatus } from '@/lib/data/queries/maintenance'
import { getClientDisplayName } from '@/lib/client'
import screen from '@/components/layout/Screen.module.css'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'
import local from './Entretien.module.css'

const NB = ' '

/** Contrat : création ou modification. */
export function ContractSheet({ q, clients, quotes }: { q: EntretienState; clients: EntretienProps['clients']; quotes: EntretienProps['quotes'] }) {
  if (!q.showContractModal) return null
  const f = q.contractForm
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => q.setContractForm(prev => ({ ...prev, [k]: v }))
  const editing = !!q.editingContract
  const sourceQuote = quotes.find(x => x.id === f.source_quote_id)
  const autoMode = f.auto_send_delay_days ? 'auto' : 'manual'
  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) q.setShowContractModal(false) }}
      title={editing ? 'Modifier le contrat' : 'Nouveau contrat d’entretien'}
      confirmLabel={editing ? 'Enregistrer' : 'Créer'}
      confirmLoading={q.saving}
      confirmDisabled={!f.title.trim()}
      onConfirm={q.saveContract}
    >
      <div className={local.sheetBody}>
        <div className={styles.fields}>
          <Field type="text" label="Intitulé du contrat" placeholder="Entretien PAC - Résidence Bellevue" value={f.title} onChange={e => set('title', e.target.value)} />
          <Field type="select" label="Client" value={f.client_id} onChange={e => q.setContractForm(prev => ({ ...prev, client_id: e.target.value, source_quote_id: '' }))}>
            <option value="">Aucun</option>
            {clients.map(c => <option key={c.id} value={c.id}>{getClientDisplayName(c)}</option>)}
          </Field>
          <Field type="select" label="Fréquence" value={f.frequence} onChange={e => set('frequence', e.target.value as MaintenanceFrequence)}>
            {(Object.keys(FREQUENCE_LABELS) as MaintenanceFrequence[]).map(k => <option key={k} value={k}>{FREQUENCE_LABELS[k]}</option>)}
          </Field>
          <Field type="select" label="Statut" value={f.status} onChange={e => set('status', e.target.value as MaintenanceStatus)}>
            {(Object.keys(CONTRACT_STATUS) as MaintenanceStatus[]).map(s => <option key={s} value={s}>{CONTRACT_STATUS[s].label}</option>)}
          </Field>
        </div>

        <div className={local.sheetSection}>
          <div className={styles.fields}>
            <Field
              type="select"
              label="Devis source"
              disabled={!f.client_id || q.clientQuotes.length === 0}
              value={f.source_quote_id}
              onChange={e => q.chooseQuote(e.target.value)}
            >
              <option value="">{!f.client_id ? 'Choisissez d’abord un client' : q.clientQuotes.length === 0 ? 'Aucun devis pour ce client' : 'Aucun devis lié'}</option>
              {q.clientQuotes.map(x => (
                <option key={x.id} value={x.id}>
                  {[x.number, x.title].filter(Boolean).join(' · ') || 'Devis'}{x.total_ht != null ? ` · ${fmtMoney(x.total_ht)} HT` : ''}{x.internal_cost_total_ht > 0 ? ` · coût ${fmtMoney(x.internal_cost_total_ht)}` : ''}
                </option>
              ))}
            </Field>
          </div>
          {sourceQuote && sourceQuote.internal_cost_total_ht > 0 && (
            <p className={screen.note}>Coût interne importé du devis : {fmtMoney(sourceQuote.internal_cost_total_ht)}.</p>
          )}
        </div>

        <div className={local.sheetSection}>
          <h3 className={local.sheetHeading}>Tarif</h3>
          <div className={styles.fields}>
            <Field type="text" label="Prix facturé par période HT (€)" inputMode="decimal" placeholder="0,00" value={f.montant_ht} onChange={e => set('montant_ht', e.target.value)} />
            <Field type="select" label="Taux de TVA" value={String(f.vat_rate)} onChange={e => set('vat_rate', parseFloat(e.target.value))}>
              {LEGAL_VAT_RATES.map(r => <option key={r} value={r}>{r}{NB}%</option>)}
            </Field>
            <DateRow label="Début" value={f.date_debut} onChange={v => set('date_debut', v)} />
            <DateRow label="Fin" value={f.date_fin} onChange={v => set('date_fin', v)} />
            {editing && <DateRow label="Prochaine intervention" value={f.prochaine_intervention} onChange={v => set('prochaine_intervention', v)} />}
          </div>
        </div>

        <div className={local.sheetSection}>
          <h3 className={local.sheetHeading}>Facturation</h3>
          <ListGroup description="La facture est préparée à chaque période à partir du prix ci-dessus.">
            <ListRow
              title="Facturation automatique récurrente"
              trailing={<Switch label="Facturation automatique récurrente" checked={f.facturation_auto} onChange={v => q.setContractForm(prev => ({ ...prev, facturation_auto: v, auto_send_delay_days: v ? prev.auto_send_delay_days : '' }))} />}
            />
          </ListGroup>
          {f.facturation_auto && (
            <>
              <SegmentedControl
                label="Validation avant envoi"
                fullWidth
                value={autoMode}
                onChange={v => set('auto_send_delay_days', v === 'auto' ? (f.auto_send_delay_days || '1') : '')}
                options={[{ value: 'manual', label: 'Je valide' }, { value: 'auto', label: 'Envoi automatique' }]}
              />
              {autoMode === 'manual'
                ? <p className={screen.note}>La facture est préparée, puis attend votre validation.</p>
                : (
                  <div className={styles.fields}>
                    <Field type="text" label="Délai d’envoi (jours)" inputMode="numeric" hint="Si personne ne touche au brouillon, il partira avec son PDF après ce délai." value={f.auto_send_delay_days} onChange={e => set('auto_send_delay_days', e.target.value)} />
                  </div>
                )}
            </>
          )}
        </div>

        <div className={local.sheetSection}>
          <h3 className={local.sheetHeading}>Site d’intervention</h3>
          <div className={styles.fields}>
            <Field type="text" label="Nom du lieu" placeholder="Résidence Bellevue, local technique…" value={f.site_name} onChange={e => set('site_name', e.target.value)} />
            <Field type="text" label="Contact sur site" placeholder="Nom du référent" value={f.site_contact_name} onChange={e => set('site_contact_name', e.target.value)} />
            <Field type="text" label="Téléphone" inputMode="tel" value={f.site_contact_phone} onChange={e => set('site_contact_phone', e.target.value)} />
            <Field type="text" label="Email" inputMode="email" value={f.site_contact_email} onChange={e => set('site_contact_email', e.target.value)} />
            <Field type="text" label="Adresse" placeholder="Numéro et rue" value={f.site_address_line1} onChange={e => set('site_address_line1', e.target.value)} />
            <Field type="text" label="Code postal" inputMode="numeric" value={f.site_postal_code} onChange={e => set('site_postal_code', e.target.value)} />
            <Field type="text" label="Ville" value={f.site_city} onChange={e => set('site_city', e.target.value)} />
          </div>
        </div>

        <div className={local.sheetSection}>
          <h3 className={local.sheetHeading}>Installations à maintenir</h3>
          {f.equipements.map((eq, i) => (
            <div key={i} className={styles.fields}>
              <Field type="text" label="Nom" value={eq.nom} onChange={e => q.updateEquipement(i, 'nom', e.target.value)} />
              <Field type="text" label="Référence" value={eq.ref ?? ''} onChange={e => q.updateEquipement(i, 'ref', e.target.value)} />
              <Field type="text" label="Localisation" value={eq.localisation ?? ''} onChange={e => q.updateEquipement(i, 'localisation', e.target.value)} />
              <div className={styles.destructiveRow}><button type="button" onClick={() => q.removeEquipement(i)}>Retirer cette installation</button></div>
            </div>
          ))}
          <ListGroup description={f.equipements.length === 0 ? 'Facultatif : ajoutez une PAC, chaudière, portail, groupe froid, zone ou élément précis à suivre.' : undefined}>
            <ListRow title="Ajouter une installation" className={styles.accentRow} onClick={q.addEquipement} />
          </ListGroup>
        </div>

        <div className={local.sheetSection}>
          <Field type="textarea" label="Description et observations" rows={3} placeholder="Périmètre du contrat, conditions particulières…" value={f.description} onChange={e => set('description', e.target.value)} />
        </div>

        {q.formError && <p className={screen.error} role="alert">{q.formError}</p>}
      </div>
    </Sheet>
  )
}

/** Intervention : saisie ou modification (coûts et facturation une fois réalisée). */
export function InterventionSheet({ q, teamMembers, ghostMembers, currentUserId, currentUserName }: {
  q: EntretienState
  teamMembers: EntretienProps['teamMembers']
  ghostMembers: EntretienProps['ghostMembers']
  currentUserId: string | null
  currentUserName: string | null
}) {
  if (!q.showInterventionModal) return null
  const f = q.interventionForm
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => q.setInterventionForm(prev => ({ ...prev, [k]: v }))
  const editing = !!q.editingIntervention
  const done = f.statut === 'réalisée'
  const others = teamMembers.filter(m => m.user_id !== currentUserId)
  const km = parseFloat(f.travel_km)
  const conso = parseFloat(f.travel_fuel_consumption_per_100km)
  const price = parseFloat(f.travel_fuel_price_per_liter)
  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) q.setShowInterventionModal(false) }}
      title={editing ? 'Modifier l’intervention' : 'Saisir une intervention'}
      confirmLabel={editing ? 'Enregistrer' : 'Saisir'}
      confirmLoading={q.saving}
      confirmDisabled={!f.date_intervention}
      onConfirm={q.saveIntervention}
    >
      <div className={local.sheetBody}>
        <div className={styles.fields}>
          <DateRow label="Date" value={f.date_intervention} onChange={v => set('date_intervention', v)} required />
          <Field type="select" label="Statut" value={f.statut} onChange={e => set('statut', e.target.value as InterventionStatut)}>
            <option value="planifiée">Planifiée</option>
            <option value="réalisée">Réalisée</option>
            <option value="annulée">Annulée</option>
          </Field>
          <Field type="select" label="Intervenant" value={f.intervenant_id} onChange={e => set('intervenant_id', e.target.value)}>
            <option value="">Non assigné</option>
            {currentUserId && currentUserName && <optgroup label="Moi"><option value={currentUserId}>{currentUserName}</option></optgroup>}
            {others.length > 0 && (
              <optgroup label="Équipe">
                {others.map(m => <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>)}
              </optgroup>
            )}
            {ghostMembers.length > 0 && (
              <optgroup label="Intervenants terrain">
                {ghostMembers.map(m => <option key={m.id} value={m.id}>{[m.prenom, m.name].filter(Boolean).join(' ')}</option>)}
              </optgroup>
            )}
          </Field>
        </div>

        <div className={local.sheetSection}>
          <h3 className={local.sheetHeading}>Horaires</h3>
          <div className={styles.fields}>
            <DateRow label="Début" type="time" value={f.start_time} onChange={v => q.setInterventionForm(prev => withTimeField(prev, 'start_time', v))} />
            <DateRow label="Fin" type="time" value={f.end_time} onChange={v => q.setInterventionForm(prev => withTimeField(prev, 'end_time', v))} />
            <Field type="text" label="Durée (h)" inputMode="decimal" value={f.duration_hours} onChange={e => set('duration_hours', e.target.value)} />
          </div>
        </div>

        <div className={local.sheetSection}>
          <Field type="textarea" label="Rapport d’intervention" rows={3} placeholder="Travaux effectués, constats, relevés…" value={f.rapport} onChange={e => set('rapport', e.target.value)} />
          <Field type="textarea" label="Observations et pièces changées" rows={2} placeholder="Anomalies, pièces remplacées, recommandations…" value={f.observations} onChange={e => set('observations', e.target.value)} />
          {(done || q.editingIntervention?.invoice_id) && (
            <Field type="textarea" label="Observations facturables" rows={2} hint="Ajoutées en ligne sur la facture." placeholder="Remplacement filtre, recharge fluide…" value={f.billable_notes} onChange={e => set('billable_notes', e.target.value)} />
          )}
        </div>

        {done && (
          <>
            <div className={local.sheetSection}>
              <h3 className={local.sheetHeading}>Coûts</h3>
              <div className={styles.fields}>
                <Field type="text" label="Pièces HT (€)" inputMode="decimal" value={f.cost_parts_ht} onChange={e => set('cost_parts_ht', e.target.value)} />
                <Field type="text" label="Autres HT (€)" inputMode="decimal" value={f.cost_other_ht} onChange={e => set('cost_other_ht', e.target.value)} />
              </div>
            </div>

            <div className={local.sheetSection}>
              <h3 className={local.sheetHeading}>Déplacement</h3>
              <SegmentedControl
                label="Mode de calcul du déplacement"
                fullWidth
                value={f.travel_mode}
                onChange={v => set('travel_mode', v as 'manual' | 'calculated')}
                options={[{ value: 'manual', label: 'Montant libre' }, { value: 'calculated', label: 'Calcul km' }]}
              />
              <div className={styles.fields}>
                {f.travel_mode === 'calculated' && (
                  <>
                    <Field type="text" label="Distance aller-retour (km)" inputMode="decimal" placeholder="80" value={f.travel_km} onChange={e => q.setInterventionForm(prev => withTravelField(prev, 'travel_km', e.target.value))} />
                    <Field type="text" label="Prix du carburant (€/L)" inputMode="decimal" placeholder="1,85" value={f.travel_fuel_price_per_liter} onChange={e => q.setInterventionForm(prev => withTravelField(prev, 'travel_fuel_price_per_liter', e.target.value))} />
                    <Field type="text" label="Consommation (L/100 km)" inputMode="decimal" placeholder="7" value={f.travel_fuel_consumption_per_100km} onChange={e => q.setInterventionForm(prev => withTravelField(prev, 'travel_fuel_consumption_per_100km', e.target.value))} />
                  </>
                )}
                <Field
                  type="text"
                  label={f.travel_mode === 'calculated' ? 'Coût calculé HT (€)' : 'Coût du déplacement HT (€)'}
                  inputMode="decimal"
                  placeholder="0,00"
                  hint={f.travel_mode === 'calculated' && Number.isFinite(km) && Number.isFinite(conso) && Number.isFinite(price) ? `${km}${NB}km × ${(conso / 100).toFixed(3)}${NB}L/km × ${price}${NB}€/L. Modifiable.` : f.travel_mode === 'calculated' ? 'Calculé dès que les trois valeurs sont saisies ; modifiable.' : undefined}
                  value={f.cost_travel_ht}
                  onChange={e => set('cost_travel_ht', e.target.value)}
                />
              </div>
            </div>

            <div className={local.sheetSection}>
              <h3 className={local.sheetHeading}>À facturer</h3>
              <div className={styles.fields}>
                <Field type="text" label="Montant HT (€)" inputMode="decimal" value={f.billable_amount_ht} onChange={e => set('billable_amount_ht', e.target.value)} />
                <Field type="select" label="TVA de la facture" value={String(f.billable_vat_rate)} onChange={e => set('billable_vat_rate', parseFloat(e.target.value))}>
                  {LEGAL_VAT_RATES.map(r => <option key={r} value={r}>{r}{NB}%</option>)}
                </Field>
              </div>
            </div>
          </>
        )}

        {q.formError && <p className={screen.error} role="alert">{q.formError}</p>}
      </div>
    </Sheet>
  )
}

/** Coûts prévus par période : la référence de la marge prévue. */
export function BudgetSheet({ c, d, open, onClose, materials, laborRates, prestationTypes }: {
  c: MaintenanceContract
  d: ContractDetailState
  open: boolean
  onClose: () => void
  materials: EntretienProps['materials']
  laborRates: EntretienProps['laborRates']
  prestationTypes: EntretienProps['prestationTypes']
}) {
  if (!open) return null
  const totals = expectedBudgetTotals(d.budgetForm)
  const price = c.montant_ht ?? 0
  const margin = price - totals.total
  const pct = price > 0 ? margin / price : 0
  const draft = d.budgetDraft
  const fromQuote = (cat: ExpectedCostCategory) => cat === 'other' && !!c.source_quote_id && !c.period_cost_labor_ht && !c.period_cost_parts_ht && !c.period_cost_travel_ht
  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) onClose() }}
      title="Marge prévue par période"
      description={`${fmtMoney(price)} de prix prévu, ${fmtMoney(totals.total)} de coûts prévus.`}
      confirmLabel="Enregistrer"
      confirmLoading={d.budgetSaving}
      onConfirm={async () => { if (await d.saveExpectedBudget()) onClose() }}
    >
      <div className={local.sheetBody}>
        <div className={styles.total}>
          <small>Marge prévue</small>
          <b className={margin >= 0 ? local.good : local.bad}>{fmtMoney(margin)}</b>
          <small>{fmtPct(pct, 1)} du prix HT</small>
        </div>

        <div className={local.sheetSection}>
          <h3 className={local.sheetHeading}>Coûts prévus</h3>
          <div className={styles.fields}>
            {COST_CATEGORIES.map(cat => (
              <Field
                key={cat}
                type="text"
                label={fromQuote(cat) ? 'Coût interne du devis' : COST_CATEGORY_META[cat].label}
                hint={fromQuote(cat) ? 'Repris depuis le devis source.' : COST_CATEGORY_META[cat].detail}
                inputMode="decimal"
                value={d.budgetForm[cat]}
                onChange={e => d.setBudgetForm(f => ({ ...f, [cat]: e.target.value }))}
              />
            ))}
          </div>
        </div>

        <div className={local.sheetSection}>
          <h3 className={local.sheetHeading}>Ajouter une ligne de coût</h3>
          <div className={styles.fields}>
            <Field type="select" label="Source" value={draft.source} onChange={e => d.changeBudgetSource(e.target.value as BudgetSource)}>
              {(Object.keys(BUDGET_SOURCE_LABELS) as BudgetSource[]).map(s => <option key={s} value={s}>{BUDGET_SOURCE_LABELS[s]}</option>)}
            </Field>
            {draft.source === 'manual' ? (
              <Field type="text" label="Libellé" placeholder="Libellé de la ligne" value={draft.label} onChange={e => d.setBudgetDraft(f => ({ ...f, label: e.target.value }))} />
            ) : (
              <Field type="select" label="Ligne du catalogue" value={draft.catalogId} onChange={e => d.pickCatalogItem(draft.source, e.target.value)}>
                <option value="">Sélectionner dans le catalogue</option>
                {draft.source === 'material' && materials.map(item => <option key={item.id} value={item.id}>{item.name}{item.reference ? ` · ${item.reference}` : ''}</option>)}
                {draft.source === 'labor' && laborRates.map(item => <option key={item.id} value={item.id}>{item.designation}{item.reference ? ` · ${item.reference}` : ''}</option>)}
                {draft.source === 'prestation' && prestationTypes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Field>
            )}
            <Field type="select" label="Catégorie" value={draft.category} onChange={e => d.setBudgetDraft(f => ({ ...f, category: e.target.value as ExpectedCostCategory }))}>
              {COST_CATEGORIES.map(cat => <option key={cat} value={cat}>{COST_CATEGORY_META[cat].label}</option>)}
            </Field>
            <Field type="text" label="Quantité" inputMode="decimal" value={draft.quantity} onChange={e => d.setBudgetDraft(f => ({ ...f, quantity: e.target.value }))} />
            <Field type="text" label="Unité" value={draft.unit} onChange={e => d.setBudgetDraft(f => ({ ...f, unit: e.target.value }))} />
            <Field type="text" label="Coût unitaire (€)" inputMode="decimal" value={draft.unitCost} onChange={e => d.setBudgetDraft(f => ({ ...f, unitCost: e.target.value }))} />
          </div>
          <Button variant="secondary" size="md" onClick={d.addBudgetDraft}>Ajouter à la catégorie</Button>
        </div>

        {d.budgetError && <p className={screen.error} role="alert">{d.budgetError}</p>}
      </div>
    </Sheet>
  )
}

/** Une période : prévu, facturé, encaissé, coûts, marge, et encaissement en un geste. */
export function PeriodSheet({ row, d, onClose }: { row: PeriodRow | null; d: ContractDetailState; onClose: () => void }) {
  if (!row) return null
  const invoiceId = row.invoiceId
  const isPaid = !!invoiceId && (d.localPaidInvoiceIds.has(invoiceId) || (row.paidRevenueHt >= row.billedRevenueHt && row.billedRevenueHt > 0))
  const hasBilled = row.billedRevenueHt > 0
  const billedPct = row.expectedRevenueHt > 0 ? Math.min(1, row.billedRevenueHt / row.expectedRevenueHt) : 0
  const paidPct = row.expectedRevenueHt > 0 ? Math.min(1, row.paidRevenueHt / row.expectedRevenueHt) : 0
  const label = row.label.charAt(0).toUpperCase() + row.label.slice(1)
  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) onClose() }}
      title={label}
      description="Le réel ne compte que les factures envoyées, partielles ou payées."
      cancelLabel="Fermer"
    >
      <div className={local.sheetBody}>
        {row.expectedRevenueHt > 0 && (
          <div className={local.gauge} role="img" aria-label={`Encaissé ${fmtMoney(row.paidRevenueHt)}, facturé ${fmtMoney(row.billedRevenueHt)} sur ${fmtMoney(row.expectedRevenueHt)} prévus`}>
            <div className={local.gaugePaid} style={{ width: `${paidPct * 100}%` }} />
            <div className={local.gaugeSent} style={{ width: `${Math.max(0, billedPct - paidPct) * 100}%` }} />
          </div>
        )}
        <ListGroup>
          <ListRow title="Base prévue HT" trailing={<span className={styles.amount}>{row.expectedRevenueHt > 0 ? fmtMoney(row.expectedRevenueHt) : '–'}</span>} />
          <ListRow title="Facturé HT" trailing={<span className={styles.amount}>{hasBilled ? fmtMoney(row.billedRevenueHt) : '–'}</span>} />
          <ListRow title="Encaissé HT" trailing={<span className={styles.amount}>{row.paidRevenueHt > 0 ? fmtMoney(row.paidRevenueHt) : '–'}</span>} />
          {row.draftRevenueHt > 0 && <ListRow title="En brouillon" trailing={<span className={styles.amount}>{fmtMoney(row.draftRevenueHt)}</span>} />}
          {row.pendingRevenueHt > 0 && <ListRow title="À facturer" trailing={<span className={styles.amount}>{fmtMoney(row.pendingRevenueHt)}</span>} />}
          <ListRow title="Coûts" description={row.laborCostHt + row.partsCostHt + row.travelCostHt + row.otherCostHt > 0 ? 'Réels, dépenses et main-d’œuvre.' : 'Prévus : aucune dépense enregistrée.'} trailing={<span className={styles.amount}>{row.actualCostHt > 0 ? fmtMoney(row.actualCostHt) : '–'}</span>} />
          <ListRow
            title="Marge"
            trailing={hasBilled
              ? <span className={styles.trailStack}><span className={`${styles.amount} ${row.marginEur >= 0 ? local.good : local.bad}`}>{row.marginEur >= 0 ? '+' : ''}{fmtMoney(row.marginEur)}</span><StatusPill status={marginStatus(row.marginPct)}>{fmtPct(row.marginPct)}</StatusPill></span>
              : <span className={styles.amount}>–</span>}
          />
        </ListGroup>
        {invoiceId && (
          <ListGroup>
            <ListRow title="Ouvrir la facture" href={`/finances/invoice-editor?id=${invoiceId}&returnTo=${encodeURIComponent('/chantiers/entretien')}`} />
            {isPaid
              ? <ListRow title="Facture payée" />
              : <ListRow title={d.markPaidLoadingId === invoiceId ? 'Enregistrement…' : 'Marquer comme payée'} disabled={!!d.markPaidLoadingId} className={styles.accentRow} onClick={() => d.handleMarkPaid(invoiceId)} />}
          </ListGroup>
        )}
        {d.markPaidError && <p className={screen.error} role="alert">{d.markPaidError}</p>}
      </div>
    </Sheet>
  )
}

