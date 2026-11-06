'use client'
// @atelier-migrated
// TVA et paiement : régime de TVA, virement, conditions de paiement, coût horaire.

import { Check } from 'lucide-react'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { LEGAL_VAT_RATES } from '@/lib/utils'
import { formatBicInput, formatIbanInput } from '@/lib/validations/organization'
import OrgSaveDock from './OrgSaveDock'
import { vatRateLabel } from './entrepriseModel'
import type { SettingsState } from './useSettings'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Settings.module.css'

function Tick() {
  return <span className={local.tick}><Check size={18} aria-label="Sélectionné" role="img" /></span>
}

export default function PaiementView({ q }: { q: SettingsState }) {
  const p = q.paymentDetails
  const v = q.vatConfig
  const errors = q.orgFieldErrors
  const setP = (next: Partial<typeof p>) => q.setPaymentDetailsDirty({ ...p, ...next })

  return (
    <div className={local.detail}>
      <div className={local.sections}>
        <ListGroup title="Régime de TVA">
          <ListRow
            title="Assujetti à la TVA"
            description="La TVA est calculée et affichée sur tous les documents."
            trailing={v.is_vat_subject ? <Tick /> : undefined}
            onClick={() => q.setVatConfigDirty({ ...v, is_vat_subject: true })}
          />
          <ListRow
            title="Franchise en base (art. 293 B CGI)"
            description="Aucune TVA facturée, la mention légale s’ajoute aux PDF."
            trailing={!v.is_vat_subject ? <Tick /> : undefined}
            onClick={() => q.setVatConfigDirty({ ...v, is_vat_subject: false })}
          />
        </ListGroup>

        {v.is_vat_subject && (
          <div>
            <div className={styles.fields}>
              <Field type="select" label="Taux par défaut" data-org-field="default_vat_rate" value={String(v.default_vat_rate)} error={errors.default_vat_rate}
                onChange={e => q.setVatConfigDirty({ ...v, default_vat_rate: Number(e.target.value) })}>
                {LEGAL_VAT_RATES.map(rate => <option key={rate} value={String(rate)}>{vatRateLabel(rate)}</option>)}
              </Field>
            </div>
            <p className={styles.hint}>Appliqué aux nouvelles lignes de devis et de facture, modifiable ligne par ligne.</p>
          </div>
        )}

        <div>
          <h2 className={local.sectionHeading}>Virement</h2>
          <div className={`${styles.fields} ${local.mono}`}>
            <Field type="text" label="IBAN" data-org-field="iban" placeholder="FR76 3000 6000 0112 3456 7890 189" value={p.iban} error={errors.iban}
              onChange={e => { setP({ iban: formatIbanInput(e.target.value) }); q.setOrgFieldError('iban') }} />
            <Field type="text" label="BIC" data-org-field="bic" placeholder="BNPAFRPPXXX" value={p.bic} error={errors.bic}
              onChange={e => { setP({ bic: formatBicInput(e.target.value) }); q.setOrgFieldError('bic') }} />
            <Field type="text" label="Banque" placeholder="BNP Paribas" value={p.bank_name} onChange={e => setP({ bank_name: e.target.value })} />
          </div>
          <p className={styles.hint}>L’IBAN est obligatoire pour permettre le virement sur vos factures.</p>
        </div>

        <div>
          <h2 className={local.sectionHeading}>Conditions</h2>
          <div className={styles.fields}>
            <Field type="number" label="Délai de paiement (jours)" data-org-field="payment_terms_days" min={0} max={90} decimals={0} allowEmpty={false}
              value={p.payment_terms_days} error={errors.payment_terms_days}
              onChange={n => { setP({ payment_terms_days: n ?? 0 }); q.setOrgFieldError('payment_terms_days') }} />
            <Field type="number" label="Pénalités de retard (%)" data-org-field="late_penalty_rate" min={0} decimals={2} allowEmpty={false}
              value={p.late_penalty_rate} error={errors.late_penalty_rate}
              onChange={n => { setP({ late_penalty_rate: n ?? 0 }); q.setOrgFieldError('late_penalty_rate') }} />
            <Field type="text" label="Tribunal compétent" data-org-field="court_competent" placeholder="Paris" value={p.court_competent}
              onChange={e => setP({ court_competent: e.target.value })} />
            <Field type="number" label="Coût horaire MO (€/h)" min={0} decimals={2} placeholder="35"
              value={q.defaultLaborCost === '' ? null : q.defaultLaborCost}
              onChange={n => q.setDefaultLaborCostDirty(n ?? '')} />
          </div>
          <p className={styles.hint}>Pénalités : au moins 3 fois le taux d’intérêt légal, souvent 10 %. Tribunal : tapez la ville, Atelier enregistre la mention complète. Coût horaire : taux utilisé dans les rapports et la rentabilité si aucun taux n’est défini sur le membre.</p>
        </div>

        <Field type="textarea" rows={3} label="Indemnité de recouvrement (obligatoire)" value={p.recovery_indemnity_text}
          hint="Art. L441-10 du Code de commerce : indemnité forfaitaire de 40 € due entre professionnels."
          onChange={e => setP({ recovery_indemnity_text: e.target.value })} />
      </div>

      <OrgSaveDock q={q} />
    </div>
  )
}
