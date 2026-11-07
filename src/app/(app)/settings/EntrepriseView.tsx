'use client'
// @atelier-migrated
// Identité et coordonnées : logo, SIRET, activité, adresse.

import { useRef, useState } from 'react'
import { Building2 } from 'lucide-react'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { getBusinessActivityById } from '@/lib/catalog-context'
import { formatPostalCodeInput, formatSiretInput, formatVatNumberInput } from '@/lib/validations/organization'
import ActivitySheet, { type ActivityMode } from './ActivitySheet'
import OrgSaveDock from './OrgSaveDock'
import { summarizeLabels } from './entrepriseModel'
import type { SettingsState } from './useSettings'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Settings.module.css'

function LogoRow({ q }: { q: SettingsState }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" className={local.fileInput} tabIndex={-1} aria-hidden="true" onChange={q.handleLogoUpload} />
      <ListGroup>
        <ListRow
          title="Logo"
          description={q.logoUploading ? 'Envoi en cours…' : q.logoPreview ? 'Touchez pour le remplacer' : 'Affiché sur vos documents PDF'}
          leading={q.logoPreview
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={q.logoPreview} alt="Logo de l’entreprise" className={local.logoThumb} />
            : <span className={local.logoEmpty}><Building2 size={22} aria-hidden="true" /></span>}
          disabled={q.logoUploading}
          onClick={() => inputRef.current?.click()}
        />
      </ListGroup>
    </>
  )
}

export default function EntrepriseView({ q }: { q: SettingsState }) {
  const [activityMode, setActivityMode] = useState<ActivityMode | null>(null)
  const c = q.companyDetails
  const errors = q.orgFieldErrors
  const patch = (next: Partial<typeof c>) => q.setCompanyDetailsDirty({ ...c, ...next })
  const secondaryLabels = q.selectedSecondaryActivities.map(id => getBusinessActivityById(id)?.label).filter((l): l is string => !!l)

  return (
    <div className={local.detail}>
      <div className={local.sections}>
        <LogoRow q={q} />

        <div className={styles.fields}>
          <Field type="text" label="Nom" data-org-field="name" value={c.name} error={errors.name}
            onChange={e => { patch({ name: e.target.value }); q.setOrgFieldError('name') }} />
          <Field type="text" label="SIRET" data-org-field="siret" inputMode="numeric" value={c.siret} error={errors.siret}
            onChange={e => { patch({ siret: formatSiretInput(e.target.value) }); q.setOrgFieldError('siret') }} />
          <Field type="text" label="TVA intracommunautaire" data-org-field="vat_number" placeholder="FR12 123456789" value={c.tva} error={errors.vat_number}
            disabled={!q.vatConfig.is_vat_subject}
            hint={q.vatConfig.is_vat_subject ? undefined : 'Disponible si vous êtes assujetti à la TVA.'}
            onChange={e => { patch({ tva: formatVatNumberInput(e.target.value) }); q.setOrgFieldError('vat_number') }} />
        </div>

        <ListGroup title="Profil métier" description="Elle adapte le vocabulaire et les modèles, sans limiter le reste de votre activité.">
          <ListRow title="Activité de référence" description={q.currentBusinessSelection.activity.label} onClick={() => setActivityMode('primary')} />
          <ListRow title="Activités secondaires" description={summarizeLabels(secondaryLabels, 'Aucune')} onClick={() => setActivityMode('secondary')} />
        </ListGroup>

        <div>
          <h2 className={local.sectionHeading}>Coordonnées</h2>
          <div className={styles.fields}>
            <Field type="text" label="Adresse" placeholder="12 rue de la Paix" value={c.address_line1}
              onChange={e => patch({ address_line1: e.target.value })} />
            <Field type="text" label="Code postal" data-org-field="postal_code" inputMode="numeric" placeholder="69007" value={c.postal_code} error={errors.postal_code}
              onChange={e => { patch({ postal_code: formatPostalCodeInput(e.target.value) }); q.setOrgFieldError('postal_code') }} />
            <Field type="text" label="Ville" placeholder="Lyon" value={c.city} onChange={e => patch({ city: e.target.value })} />
            <Field type="text" inputType="email" label="Email de contact" data-org-field="email" value={c.email} error={errors.email}
              onChange={e => { patch({ email: e.target.value }); q.setOrgFieldError('email') }} />
            <Field type="text" inputType="tel" label="Téléphone" value={c.phone} onChange={e => patch({ phone: e.target.value })} />
          </div>
        </div>
      </div>

      <OrgSaveDock q={q} />
      <ActivitySheet q={q} mode={activityMode} onClose={() => setActivityMode(null)} />
    </div>
  )
}
