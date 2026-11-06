'use client'
// @atelier-migrated
// Mentions légales et assurances : pied de page des PDF, garantie décennale, signature des contrats.

import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SignaturePad } from '@/components/ui/SignaturePad'
import { Switch } from '@/components/ui/Switch'
import { formatSirenInput } from '@/lib/validations/organization'
import OrgSaveDock from './OrgSaveDock'
import { decennaleStatus } from './entrepriseModel'
import type { SettingsState } from './useSettings'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Settings.module.css'

export default function LegalView({ q }: { q: SettingsState }) {
  const l = q.legalDetails
  const d = q.decennale
  const s = q.signatureDetails
  const status = d.enabled ? decennaleStatus(d.date_fin) : null
  const setL = (next: Partial<typeof l>) => q.setLegalDetailsDirty({ ...l, ...next })
  const setS = (next: Partial<typeof s>) => q.setSignatureDetailsDirty({ ...s, ...next })

  return (
    <div className={local.detail}>
      <div className={styles.stack}>
        <div>
          <p className={local.sectionHeading}>Pied de page des PDF</p>
          <div className={styles.fields}>
            <Field type="text" label="Forme juridique" placeholder="SAS, SARL, EI…" value={l.forme_juridique} onChange={e => setL({ forme_juridique: e.target.value })} />
            <Field type="text" label="Capital social" placeholder="10 000 €" value={l.capital_social} onChange={e => setL({ capital_social: e.target.value })} />
            <Field type="text" label="N° RCS" inputMode="numeric" placeholder="123 456 789" value={l.rcs} onChange={e => setL({ rcs: formatSirenInput(e.target.value) })} />
            <Field type="text" label="Tribunal de commerce" placeholder="Paris" value={l.rcs_ville} onChange={e => setL({ rcs_ville: e.target.value })} />
            <Field type="text" label="Assurance pro" placeholder="AXA Pro n° 123456" value={l.insurance_info} onChange={e => setL({ insurance_info: e.target.value })} />
            <Field type="text" label="Certifications" placeholder="RGE Qualibat 7711…" value={l.certifications} onChange={e => setL({ certifications: e.target.value })} />
          </div>
          <p className={styles.hint}>Ces informations apparaissent en bas de vos devis et factures.</p>
        </div>

        <div>
          <ListGroup title="Garantie décennale" description="Obligatoire pour les travaux de construction (art. L241-1 du Code des assurances). Affichée dans un bloc dédié sur vos devis et factures.">
            <ListRow
              title="Garantie décennale"
              description={d.enabled ? 'Activée' : 'Désactivée'}
              trailing={<Switch label="Garantie décennale" checked={d.enabled} onChange={enabled => q.setDecennaleDirty(prev => ({ ...prev, enabled }))} />}
            />
          </ListGroup>
          {d.enabled && (
            <>
              <div className={styles.fields} style={{ marginTop: 16 }}>
                <Field type="text" label="Assureur" placeholder="AXA Pro, Allianz, SMABTP…" value={d.assureur} onChange={e => q.setDecennaleDirty(prev => ({ ...prev, assureur: e.target.value }))} />
                <Field type="text" label="Numéro de police" placeholder="12 345 678 90" value={d.police} onChange={e => q.setDecennaleDirty(prev => ({ ...prev, police: e.target.value }))} />
                <Field type="text" label="Couverture" placeholder="France métropolitaine" value={d.couverture} onChange={e => q.setDecennaleDirty(prev => ({ ...prev, couverture: e.target.value }))} />
                <Field type="text" inputType="date" label="Début" value={d.date_debut} onChange={e => q.setDecennaleDirty(prev => ({ ...prev, date_debut: e.target.value }))} />
                <Field type="text" inputType="date" label="Échéance" value={d.date_fin} onChange={e => q.setDecennaleDirty(prev => ({ ...prev, date_fin: e.target.value }))} />
              </div>
              {status && <p className={local.note} data-tone={status.tone}>{status.text}</p>}
            </>
          )}
        </div>

        <div>
          <p className={local.sectionHeading}>Signature des contrats</p>
          <div className={styles.fields}>
            <Field type="text" label="Signataire" placeholder="Jean Dupont" value={s.signatory_name} onChange={e => setS({ signatory_name: e.target.value })} />
            <Field type="text" label="Fonction" placeholder="Gérant, Président…" value={s.signatory_role} onChange={e => setS({ signatory_role: e.target.value })} />
          </div>
          <div className={local.signature} style={{ marginTop: 16 }}>
            <SignaturePad value={s.signature_image} onChange={dataUrl => setS({ signature_image: dataUrl })} hint="Cette signature est apposée automatiquement sur vos contrats." />
          </div>
        </div>
      </div>

      <OrgSaveDock q={q} />
    </div>
  )
}
