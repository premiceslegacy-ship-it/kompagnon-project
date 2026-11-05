'use client'
// @atelier-migrated

import { useActionState, useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { Download, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import type { Client } from '@/lib/data/queries/clients'
import { createClient, importClients, updateClient, type CreateClientState, type ImportClientsState, type UpdateClientState } from '@/lib/data/mutations/clients'
import { CSV_FIELDS, CURRENCY_OPTIONS, SOURCE_OPTIONS, buildImportRows, canImport, importTemplateCsv, readCSV } from './clientsModel'
import styles from '../finances/quote-editor/QuoteEditor.module.css'

const initialState = { error: null, success: false } as CreateClientState & UpdateClientState

/** Champs d'identité : professionnel ou particulier, puis coordonnées. */
function ContactFields({ defaultValues }: { defaultValues?: Partial<Client> }) {
  const [clientType, setClientType] = useState<'company' | 'individual'>((defaultValues?.type as 'company' | 'individual') ?? 'company')
  const isCompany = clientType === 'company'
  return (
    <>
      <SegmentedControl
        fullWidth
        label="Type de contact"
        value={clientType}
        options={[{ value: 'company', label: 'Professionnel' }, { value: 'individual', label: 'Particulier' }]}
        onChange={v => setClientType(v as 'company' | 'individual')}
      />
      <input type="hidden" name="type" value={clientType} />
      <div className={styles.fields}>
        {isCompany ? (
          <>
            <Field type="text" name="company_name" label="Raison sociale" placeholder="Dupont Bâtiment SARL" defaultValue={defaultValues?.company_name ?? ''} />
            <Field type="text" name="contact_name" label="Contact" placeholder="Marie Dupont" defaultValue={defaultValues?.contact_name ?? ''} />
            <Field type="text" name="siret" label="SIRET" placeholder="12345678900012" inputMode="numeric" defaultValue={defaultValues?.siret ?? ''} />
          </>
        ) : (
          <>
            <Field type="text" name="first_name" label="Prénom" placeholder="Jean" defaultValue={defaultValues?.first_name ?? ''} />
            <Field type="text" name="last_name" label="Nom" placeholder="Dupont" defaultValue={defaultValues?.last_name ?? ''} />
          </>
        )}
        <Field type="text" name="email" label="Email" inputMode="email" placeholder={isCompany ? 'contact@entreprise.fr' : 'jean.dupont@gmail.com'} defaultValue={defaultValues?.email ?? ''} />
        <Field type="text" name="phone" label="Téléphone" inputMode="tel" placeholder="06 00 00 00 00" defaultValue={defaultValues?.phone ?? ''} />
      </div>
    </>
  )
}

/** Feuille de formulaire reliée à une server action (création, lead, modification). */
function ContactFormSheet({ title, description, submitLabel, action, onClose, children }: {
  title: string
  description?: string
  submitLabel: string
  action: (prev: CreateClientState & UpdateClientState, data: FormData) => Promise<CreateClientState & UpdateClientState>
  onClose: () => void
  children: ReactNode
}) {
  const [state, formAction, pending] = useActionState(action, initialState)
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => { if (state.success) onClose() }, [state.success, onClose])
  return (
    <Sheet
      open
      onOpenChange={open => { if (!open) onClose() }}
      title={title}
      description={description}
      onConfirm={() => formRef.current?.requestSubmit()}
      confirmLabel={submitLabel}
      confirmLoading={pending}
    >
      <form ref={formRef} action={formAction} className={styles.detail}>
        {state.error && <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>{state.error}</p>}
        {children}
      </form>
    </Sheet>
  )
}

const TERMS = [{ value: '30', label: '30 jours net' }, { value: '45', label: '45 jours fin de mois' }, { value: '60', label: '60 jours net' }]

function CurrencyLocale({ currency, locale }: { currency?: string; locale?: string }) {
  return (
    <>
      <Field type="select" name="currency" label="Devise" defaultValue={currency ?? 'EUR'}>
        {CURRENCY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Field>
      <Field type="select" name="locale" label="Langue" defaultValue={locale ?? 'fr'}>
        <option value="fr">Français</option>
        <option value="en">English</option>
      </Field>
    </>
  )
}

export function NewClientSheet({ onClose }: { onClose: () => void }) {
  return (
    <ContactFormSheet title="Nouveau client" description="Client ayant déjà travaillé avec vous ou dont le devis a été accepté." submitLabel="Créer" action={createClient} onClose={onClose}>
      <ContactFields />
      <div className={styles.fields}>
        <Field type="select" name="status" label="Catégorie" defaultValue="active">
          <option value="active">Client</option>
          <option value="subcontractor">Sous-traitant</option>
        </Field>
        <Field type="text" name="address_line1" label="Adresse" placeholder="12 rue de la Paix, 75001 Paris" />
        <Field type="select" name="payment_terms_days" label="Paiement" defaultValue="30">
          {TERMS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Field>
        <CurrencyLocale />
      </div>
    </ContactFormSheet>
  )
}

export function NewLeadSheet({ onClose }: { onClose: () => void }) {
  const [leadStatus, setLeadStatus] = useState<'lead_cold' | 'lead_hot'>('lead_cold')
  return (
    <ContactFormSheet title="Nouveau lead" description="Contact prospect, pas encore client. Vous pourrez le convertir en client à tout moment." submitLabel="Ajouter" action={createClient} onClose={onClose}>
      <input type="hidden" name="status" value={leadStatus} />
      <SegmentedControl
        fullWidth
        label="Qualification"
        value={leadStatus}
        options={[{ value: 'lead_cold', label: 'Froid, à qualifier' }, { value: 'lead_hot', label: 'Chaud, intéressé' }]}
        onChange={v => setLeadStatus(v as 'lead_cold' | 'lead_hot')}
      />
      <ContactFields />
      <div className={styles.fields}>
        <Field type="select" name="source" label="Source" defaultValue="">
          {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Field>
      </div>
    </ContactFormSheet>
  )
}

export function EditClientSheet({ client, onClose }: { client: Client; onClose: () => void }) {
  const extra = client as { currency?: string; locale?: string }
  return (
    <ContactFormSheet title="Modifier le contact" submitLabel="Enregistrer" action={updateClient} onClose={onClose}>
      <input type="hidden" name="client_id" value={client.id} />
      <ContactFields defaultValues={client} />
      <div className={styles.fields}>
        <Field type="text" name="address_line1" label="Adresse" placeholder="12 rue de la Paix" defaultValue={client.address_line1 ?? ''} />
        <Field type="text" name="postal_code" label="Code postal" placeholder="75001" inputMode="numeric" defaultValue={client.postal_code ?? ''} />
        <Field type="text" name="city" label="Ville" placeholder="Paris" defaultValue={client.city ?? ''} />
        <Field type="select" name="status" label="Statut" defaultValue={client.status ?? 'active'}>
          <option value="lead_cold">Lead froid</option>
          <option value="lead_hot">Lead chaud</option>
          <option value="prospect">Prospect</option>
          <option value="active">Client</option>
          <option value="subcontractor">Sous-traitant</option>
          <option value="inactive">Inactif</option>
        </Field>
        <Field type="select" name="source" label="Source" defaultValue={client.source ?? ''}>
          {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Field>
        <Field type="select" name="payment_terms_days" label="Paiement" defaultValue={String(client.payment_terms_days ?? 30)}>
          {TERMS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Field>
        <CurrencyLocale currency={extra.currency} locale={extra.locale} />
      </div>
      <Field type="textarea" name="internal_notes" label="Notes internes" rows={4}
        placeholder="Ex : Préfère les devis détaillés, décision prise par la responsable achats…"
        hint="Contexte commercial, habitudes, interlocuteurs clés. Non transmis au client."
        defaultValue={client.internal_notes ?? ''} />
    </ContactFormSheet>
  )
}

/** Import CSV en trois étapes : fichier, association des colonnes, résultat. */
export function ImportSheet({ isLeads, onClose }: { isLeads: boolean; onClose: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [headers, setHeaders] = useState<string[]>([])
  const [dataRows, setDataRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<ImportClientsState | null>(null)

  const downloadTemplate = () => {
    const blob = new Blob(['﻿' + importTemplateCsv(isLeads)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = isLeads ? 'template-import-leads-atelier.csv' : 'template-import-clients-atelier.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const parsed = readCSV(ev.target?.result as string)
      if (!parsed) return
      setHeaders(parsed.headers)
      setDataRows(parsed.dataRows)
      setMapping(parsed.mapping)
      setStep(2)
    }
    reader.readAsText(file, 'utf-8')
  }

  const handleImport = () => {
    const fd = new FormData()
    fd.set('clients_json', JSON.stringify(buildImportRows(dataRows, mapping, isLeads)))
    startTransition(async () => {
      const res = await importClients({ error: null, imported: 0, skipped: 0 }, fd)
      setResult(res)
      if (!res.error) { setStep(3); setTimeout(onClose, 2500) }
    })
  }

  return (
    <Sheet
      open
      onOpenChange={open => { if (!open) onClose() }}
      title={isLeads ? 'Importer des leads' : 'Importer des clients'}
      description={isLeads
        ? 'Les contacts importés seront créés en lead froid par défaut, sauf si une colonne Statut est renseignée.'
        : 'Importez votre liste depuis Excel ou tout autre tableur.'}
      cancelLabel={step === 3 ? 'Fermer' : 'Annuler'}
      onConfirm={step === 2 ? handleImport : undefined}
      confirmLabel={`Importer ${dataRows.length}`}
      confirmLoading={isPending}
      confirmDisabled={step === 2 && !canImport(mapping)}
    >
      <div className={styles.detail}>
        {step === 1 && (
          <>
            <ListGroup title="Comment faire ?" description="Format accepté : .csv, séparateur point-virgule ou virgule.">
              <ListRow title="1. Téléchargez le modèle" description="Un fichier d'exemple à ouvrir dans votre tableur." />
              <ListRow title="2. Remplissez vos contacts" description="Une ligne par contact : entreprise ou nom, au minimum." />
              <ListRow title="3. Importez le fichier" description="Enregistrez en .csv puis choisissez-le ci-dessous." />
            </ListGroup>
            <input ref={fileInputRef} type="file" accept=".csv,.txt" hidden onChange={handleFileChange} aria-label="Fichier CSV" />
            <div className={styles.inline}>
              <Button variant="secondary" size="lg" onClick={downloadTemplate}><Download size={18} aria-hidden="true" />&nbsp;Télécharger le modèle</Button>
              <Button size="lg" onClick={() => fileInputRef.current?.click()}><Upload size={18} aria-hidden="true" />&nbsp;Choisir un fichier</Button>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <p className={styles.hint} style={{ marginTop: 0 }}>{dataRows.length} ligne(s) détectée(s). Associez les colonnes de votre fichier.</p>
            <div className={styles.fields}>
              {CSV_FIELDS.map(({ key, label }) => (
                <Field key={key} type="select" label={label} value={mapping[key] ?? ''} onChange={e => setMapping(prev => ({ ...prev, [key]: e.target.value }))}>
                  <option value="">Ignorer cette colonne</option>
                  {headers.map((h, i) => <option key={i} value={String(i)}>{h || `Colonne ${i + 1}`}</option>)}
                </Field>
              ))}
            </div>
            {result?.error && <p className={`${styles.hint} ${styles.warn}`} role="alert">{result.error}</p>}
            <Button variant="text" onClick={() => { setStep(1); setResult(null) }}>Changer de fichier</Button>
          </>
        )}
        {step === 3 && result && (
          <div className={styles.total}>
            <b>{result.imported}</b>
            <small>contact(s) importé(s) avec succès</small>
            {result.skipped > 0 && <small>{result.skipped} ligne(s) ignorée(s) (nom manquant).</small>}
          </div>
        )}
      </div>
    </Sheet>
  )
}
