'use client'

import React, { useState, useTransition, useRef, useCallback } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { type Client } from '@/lib/data/queries/clients'
import {
  createClient, updateClient, deleteClient, importClients,
  convertToClient, convertToProspect,
  type CreateClientState, type UpdateClientState, type ImportClientsState,
} from '@/lib/data/mutations/clients'
import { formatCurrency, ActionMenu } from '@/components/shared'
import { getClientDisplayName } from '@/lib/client'
import { todayParis } from '@/lib/utils'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Search, Upload, Download, Users, Euro, Filter,
  FileText, Eye, Edit2, X, Loader2, CheckCircle2, AlertCircle, Building2, Trash2,
  Target, ArrowRight, UserCheck,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  initialClients: Client[]
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
  canImport: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function clientDisplayName(client: Client): string {
  return getClientDisplayName(client)
}

export function statusBadge(status: string | null) {
  switch (status) {
    case 'active':
      return { label: 'Client', cls: 'bg-accent-green/10 text-accent-green' }
    case 'prospect':
      return { label: 'Prospect', cls: 'bg-blue-500/10 text-blue-500' }
    case 'lead_hot':
      return { label: 'Lead Chaud', cls: 'bg-accent/10 text-accent' }
    case 'lead_cold':
      return { label: 'Lead Froid', cls: 'bg-secondary/10 text-secondary' }
    case 'inactive':
      return { label: 'Inactif', cls: 'bg-red-500/10 text-red-400' }
    default:
      return { label: status ?? '/', cls: 'bg-secondary/10 text-secondary' }
  }
}

const LEAD_STATUSES = ['lead_hot', 'lead_cold', 'prospect']

const SOURCE_OPTIONS = [
  { value: '', label: 'Non renseignée' },
  { value: 'bouche_a_oreille', label: 'Bouche à oreille' },
  { value: 'recommandation', label: 'Recommandation client' },
  { value: 'site_web', label: 'Site web' },
  { value: 'reseaux_sociaux', label: 'Réseaux sociaux' },
  { value: 'formulaire_public', label: 'Formulaire public' },
  { value: 'appel_entrant', label: 'Appel entrant' },
  { value: 'salon_evenement', label: 'Salon / Événement' },
  { value: 'autre', label: 'Autre' },
]

function sourceLabel(source: string | null): string {
  if (!source) return '/'
  return SOURCE_OPTIONS.find(o => o.value === source)?.label ?? source
}

function parseCSV(text: string): string[][] {
  const lines = text.trim().split(/\r?\n/)
  const separator = (lines[0]?.match(/;/g) ?? []).length > (lines[0]?.match(/,/g) ?? []).length ? ';' : ','
  return lines.map(line => {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQuotes = !inQuotes }
      else if (line[i] === separator && !inQuotes) { result.push(current.trim()); current = '' }
      else { current += line[i] }
    }
    result.push(current.trim())
    return result
  })
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const inputCls = 'w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all'

// ─── SubmitButton ─────────────────────────────────────────────────────────────

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-6 py-3 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20 flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
    >
      {pending ? <><Loader2 className="w-4 h-4 animate-spin" />Enregistrement...</> : label}
    </button>
  )
}

// ─── FilterSelect ─────────────────────────────────────────────────────────────

const FilterSelect = ({
  value, onChange, options, className = ''
}: {
  value: string
  onChange: (val: string) => void
  options: { value: string; label: string }[]
  className?: string
}) => {
  const selectedLabel = options.find(o => o.value === value)?.label || value
  return (
    <div className="relative inline-block group">
      <div className={`px-6 py-2.5 rounded-full bg-base border border-[var(--elevation-border)] text-primary text-sm transition-all group-hover:border-accent/30 flex items-center justify-center min-w-[140px] h-[42px] ${className}`}>
        <span className="font-semibold text-center truncate">{selectedLabel}</span>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer appearance-none"
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  )
}

// ─── Shared form fields ───────────────────────────────────────────────────────

function ContactFields({ defaultValues }: { defaultValues?: Partial<Client> }) {
  const [clientType, setClientType] = useState<'company' | 'individual'>(
    (defaultValues?.type as 'company' | 'individual') ?? 'company'
  )
  const isCompany = clientType === 'company'

  return (
    <div className="space-y-4">
      {/* Toggle professionnel / particulier */}
      <div className="flex rounded-xl overflow-hidden border border-[var(--elevation-border)]">
        {(['company', 'individual'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setClientType(t)}
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${clientType === t ? 'bg-accent text-black' : 'text-secondary hover:text-primary'}`}
          >
            {t === 'company' ? 'Professionnel' : 'Particulier'}
          </button>
        ))}
      </div>
      <input type="hidden" name="type" value={clientType} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {isCompany && (
          <div className="md:col-span-2 space-y-2">
            <label className="text-sm font-semibold text-secondary">Raison sociale *</label>
            <input name="company_name" type="text" defaultValue={defaultValues?.company_name ?? ''} placeholder="Dupont Bâtiment SARL" className={inputCls} />
          </div>
        )}
        {isCompany && (
          <div className="md:col-span-2 space-y-2">
            <label className="text-sm font-semibold text-secondary">Nom du contact référent</label>
            <input name="contact_name" type="text" defaultValue={defaultValues?.contact_name ?? ''} placeholder="Marie Dupont" className={inputCls} />
          </div>
        )}
        <div className="space-y-2">
          <label className="text-sm font-semibold text-secondary">{isCompany ? 'Prénom contact' : 'Prénom *'}</label>
          <input name="first_name" type="text" defaultValue={defaultValues?.first_name ?? ''} placeholder="Jean" className={inputCls} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-semibold text-secondary">{isCompany ? 'Nom contact' : 'Nom *'}</label>
          <input name="last_name" type="text" defaultValue={defaultValues?.last_name ?? ''} placeholder="Dupont" className={inputCls} />
        </div>
        {isCompany && (
          <div className="space-y-2">
            <label className="text-sm font-semibold text-secondary">SIRET</label>
            <input name="siret" type="text" defaultValue={defaultValues?.siret ?? ''} placeholder="12345678900012" className={`${inputCls} tabular-nums`} />
          </div>
        )}
        <div className="space-y-2">
          <label className="text-sm font-semibold text-secondary">Email</label>
          <input name="email" type="email" defaultValue={defaultValues?.email ?? ''} placeholder={isCompany ? 'contact@entreprise.fr' : 'jean.dupont@gmail.com'} className={inputCls} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-semibold text-secondary">Téléphone</label>
          <input name="phone" type="tel" defaultValue={defaultValues?.phone ?? ''} placeholder="06 00 00 00 00" className={`${inputCls} tabular-nums`} />
        </div>
      </div>
    </div>
  )
}

// ─── NewClientModal ───────────────────────────────────────────────────────────

const initialCreateState: CreateClientState = { error: null, success: false }

function NewClientModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [state, formAction] = useFormState(createClient, initialCreateState)

  React.useEffect(() => {
    if (state.success) onClose()
  }, [state.success, onClose])

  if (!isOpen) return null

  return (
    <div className="modal-overlay">
      <div className="modal-panel animate-in fade-in duration-300">
        <button onClick={onClose} className="absolute top-6 right-6 text-secondary hover:text-primary transition-colors"><X className="w-6 h-6" /></button>
        <h2 className="text-2xl font-bold text-primary mb-2">Nouveau Client</h2>
        <p className="text-secondary text-sm mb-6">Client ayant déjà travaillé avec vous ou dont le devis a été accepté.</p>

        {state.error && (
          <div className="mb-5 flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-red-500/10 border border-red-500/25">
            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-400 leading-snug">{state.error}</p>
          </div>
        )}

        <form action={formAction} className="space-y-6">
          <input type="hidden" name="status" value="active" />
          <ContactFields />
          <div className="space-y-2">
            <label className="text-sm font-semibold text-secondary">Adresse de facturation</label>
            <input name="address_line1" type="text" placeholder="12 rue de la Paix, 75001 Paris" className={inputCls} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Conditions de paiement</label>
              <select name="payment_terms_days" className={`${inputCls} appearance-none`}>
                <option value="30">30 jours net</option>
                <option value="45">45 jours fin de mois</option>
                <option value="60">60 jours net</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Devise</label>
              <select name="currency" className={`${inputCls} appearance-none`}>
                <option value="EUR">EUR : Euro (€)</option>
                <option value="USD">USD : Dollar US ($)</option>
                <option value="GBP">GBP : Livre sterling (£)</option>
                <option value="CHF">CHF : Franc suisse</option>
                <option value="CAD">CAD : Dollar canadien</option>
                <option value="MAD">MAD : Dirham marocain</option>
                <option value="DZD">DZD : Dinar algérien</option>
                <option value="TND">TND : Dinar tunisien</option>
                <option value="XOF">XOF : Franc CFA</option>
                <option value="AED">AED : Dirham émirati</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Langue des documents</label>
              <select name="locale" className={`${inputCls} appearance-none`}>
                <option value="fr">🇫🇷 Français</option>
                <option value="en">🇬🇧 English</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-4 pt-4">
            <button type="button" onClick={onClose} className="px-6 py-3 rounded-full text-secondary hover:text-primary font-semibold transition-colors">Annuler</button>
            <SubmitButton label="Créer le client" />
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── NewLeadModal ─────────────────────────────────────────────────────────────

function NewLeadModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [state, formAction] = useFormState(createClient, initialCreateState)
  const [leadStatus, setLeadStatus] = useState<'lead_cold' | 'lead_hot'>('lead_cold')

  React.useEffect(() => {
    if (state.success) onClose()
  }, [state.success, onClose])

  if (!isOpen) return null

  return (
    <div className="modal-overlay">
      <div className="modal-panel animate-in fade-in duration-300">
        <button onClick={onClose} className="absolute top-6 right-6 text-secondary hover:text-primary transition-colors"><X className="w-6 h-6" /></button>
        <div className="flex items-center gap-3 mb-2">
          <Target className="w-6 h-6 text-accent" />
          <h2 className="text-2xl font-bold text-primary">Ajouter un Lead</h2>
        </div>
        <p className="text-secondary text-sm mb-6">Contact prospect, pas encore client. Vous pourrez le convertir en client à tout moment.</p>

        {state.error && (
          <div className="mb-5 flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-red-500/10 border border-red-500/25">
            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-400 leading-snug">{state.error}</p>
          </div>
        )}

        <form action={formAction} className="space-y-6">
          <input type="hidden" name="status" value={leadStatus} />

          {/* Température du lead */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-secondary">Qualification</label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setLeadStatus('lead_cold')}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all border ${leadStatus === 'lead_cold' ? 'bg-secondary/10 text-secondary border-secondary/30' : 'border-[var(--elevation-border)] text-secondary hover:border-secondary/30'}`}
              >
                Froid, à qualifier
              </button>
              <button
                type="button"
                onClick={() => setLeadStatus('lead_hot')}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all border ${leadStatus === 'lead_hot' ? 'bg-accent/10 text-accent border-accent/30' : 'border-[var(--elevation-border)] text-secondary hover:border-accent/30'}`}
              >
                Chaud, intéressé
              </button>
            </div>
          </div>

          <ContactFields />

          {/* Source */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-secondary">Source du lead</label>
            <select name="source" className={`${inputCls} appearance-none`}>
              {SOURCE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-4 pt-4">
            <button type="button" onClick={onClose} className="px-6 py-3 rounded-full text-secondary hover:text-primary font-semibold transition-colors">Annuler</button>
            <SubmitButton label="Ajouter le lead" />
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── EditClientModal ──────────────────────────────────────────────────────────

const initialUpdateState: UpdateClientState = { error: null, success: false }

function EditClientModal({ client, onClose }: { client: Client; onClose: () => void }) {
  const [state, formAction] = useFormState(updateClient, initialUpdateState)

  React.useEffect(() => {
    if (state.success) onClose()
  }, [state.success, onClose])

  return (
    <div className="modal-overlay">
      <div className="modal-panel animate-in fade-in duration-300">
        <button onClick={onClose} className="absolute top-6 right-6 text-secondary hover:text-primary transition-colors"><X className="w-6 h-6" /></button>
        <h2 className="text-2xl font-bold text-primary mb-6">Modifier le contact</h2>

        {state.error && (
          <div className="mb-5 flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-red-500/10 border border-red-500/25">
            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-400 leading-snug">{state.error}</p>
          </div>
        )}

        <form action={formAction} className="space-y-6">
          <input type="hidden" name="client_id" value={client.id} />

          <ContactFields defaultValues={client} />

          <div className="space-y-2">
            <label className="text-sm font-semibold text-secondary">Adresse de facturation</label>
            <input name="address_line1" type="text" defaultValue={client.address_line1 ?? ''} placeholder="12 rue de la Paix, 75001 Paris" className={inputCls} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Statut</label>
              <select name="status" defaultValue={client.status ?? 'active'} className={`${inputCls} appearance-none`}>
                <option value="lead_cold">Lead Froid</option>
                <option value="lead_hot">Lead Chaud</option>
                <option value="prospect">Prospect</option>
                <option value="active">Client</option>
                <option value="inactive">Inactif</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Source</label>
              <select name="source" defaultValue={client.source ?? ''} className={`${inputCls} appearance-none`}>
                {SOURCE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Conditions de paiement</label>
              <select name="payment_terms_days" defaultValue={String(client.payment_terms_days ?? 30)} className={`${inputCls} appearance-none`}>
                <option value="30">30 jours net</option>
                <option value="45">45 jours fin de mois</option>
                <option value="60">60 jours net</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Devise</label>
              <select name="currency" defaultValue={(client as { currency?: string }).currency ?? 'EUR'} className={`${inputCls} appearance-none`}>
                <option value="EUR">EUR : Euro (€)</option>
                <option value="USD">USD : Dollar US ($)</option>
                <option value="GBP">GBP : Livre sterling (£)</option>
                <option value="CHF">CHF : Franc suisse</option>
                <option value="CAD">CAD : Dollar canadien</option>
                <option value="MAD">MAD : Dirham marocain</option>
                <option value="DZD">DZD : Dinar algérien</option>
                <option value="TND">TND : Dinar tunisien</option>
                <option value="XOF">XOF : Franc CFA</option>
                <option value="AED">AED : Dirham émirati</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Langue des documents</label>
              <select name="locale" defaultValue={(client as { locale?: string }).locale ?? 'fr'} className={`${inputCls} appearance-none`}>
                <option value="fr">🇫🇷 Français</option>
                <option value="en">🇬🇧 English</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-4 pt-4">
            <button type="button" onClick={onClose} className="px-6 py-3 rounded-full text-secondary hover:text-primary font-semibold transition-colors">Annuler</button>
            <SubmitButton label="Enregistrer" />
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── ImportCSVModal ───────────────────────────────────────────────────────────

const CSV_FIELDS = [
  { key: 'company_name',        label: 'Entreprise' },
  { key: 'contact_name',        label: 'Contact référent' },
  { key: 'first_name',          label: 'Prénom' },
  { key: 'last_name',           label: 'Nom' },
  { key: 'email',               label: 'Email' },
  { key: 'phone',               label: 'Téléphone' },
  { key: 'address_line1',       label: 'Adresse' },
  { key: 'postal_code',         label: 'Code postal' },
  { key: 'city',                label: 'Ville' },
  { key: 'siret',               label: 'SIRET' },
  { key: 'siren',               label: 'SIREN' },
  { key: 'vat_number',          label: 'TVA Intracommunautaire' },
  { key: 'payment_terms_days',  label: 'Délai paiement (jours)' },
  { key: 'source',              label: 'Source' },
  { key: 'status',              label: 'Statut (lead_cold, lead_hot, prospect, active)' },
  { key: 'notes',               label: 'Notes internes' },
]

function downloadTemplate(isLeads: boolean) {
  const headers = 'Entreprise;Contact référent;Prénom;Nom;Email;Téléphone;Adresse;Code Postal;Ville;SIRET;SIREN;TVA Intracommunautaire;Délai Paiement (jours);Source;Statut;Notes'
  const ex1 = isLeads
    ? 'Société Martin Nettoyage;Jean Martin;;contact@martin-nettoyage.fr;0612345678;12 rue de la Paix;75001;Paris;;;;30;bouche_a_oreille;lead_hot;Très intéressé, à rappeler semaine prochaine'
    : 'Société Martin Nettoyage;Jean Martin;;contact@martin-nettoyage.fr;0612345678;12 rue de la Paix;75001;Paris;12345678901234;123456789;FR12123456789;30;;active;Client mensuel'
  const ex2 = isLeads
    ? ';;Jean;Dupont;jean.dupont@email.fr;0698765432;5 avenue des Fleurs;;Lyon;;;30;site_web;lead_cold;'
    : ';;Jean;Dupont;jean.dupont@email.fr;0698765432;5 avenue des Fleurs;;Lyon;;;;30;;active;Particulier'
  const csv = [headers, ex1, ex2].join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = isLeads ? 'template-import-leads-atelier.csv' : 'template-import-clients-atelier.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function ImportCSVModal({ isOpen, onClose, isLeads = false }: { isOpen: boolean; onClose: () => void; isLeads?: boolean }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [headers, setHeaders] = useState<string[]>([])
  const [dataRows, setDataRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<ImportClientsState | null>(null)

  const resetModal = useCallback(() => {
    setStep(1); setHeaders([]); setDataRows([]); setMapping({}); setResult(null)
  }, [])

  const handleClose = () => { resetModal(); onClose() }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const rows = parseCSV(text)
      if (rows.length < 2) return
      const hdrs = rows[0]
      const data = rows.slice(1).filter(r => r.some(c => c))
      setHeaders(hdrs)
      setDataRows(data)
      const autoMap: Record<string, string> = {}
      CSV_FIELDS.forEach(({ key }) => {
        const idx = hdrs.findIndex(h =>
          h.toLowerCase().replace(/[^a-z]/g, '').includes(key.replace(/_/g, ''))
          || h.toLowerCase().includes(key.split('_')[0])
        )
        if (idx !== -1) autoMap[key] = String(idx)
      })
      setMapping(autoMap)
      setStep(2)
    }
    reader.readAsText(file, 'utf-8')
  }

  const handleImport = () => {
    const mapped = dataRows.map(row => {
      const obj: Record<string, string> = {}
      CSV_FIELDS.forEach(({ key }) => {
        const colIdx = mapping[key] !== undefined ? parseInt(mapping[key]) : -1
        obj[key] = colIdx >= 0 ? (row[colIdx] ?? '') : ''
      })
      // Forcer lead_cold si import leads et pas de statut explicite
      if (isLeads && !obj.status) obj.status = 'lead_cold'
      return obj
    })
    const fd = new FormData()
    fd.set('clients_json', JSON.stringify(mapped))
    startTransition(async () => {
      const res = await importClients({ error: null, imported: 0, skipped: 0 }, fd)
      setResult(res)
      if (!res.error) { setStep(3); setTimeout(() => handleClose(), 2500) }
    })
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay">
      <div className="modal-panel animate-in fade-in duration-300 sm:max-w-3xl">
        <button onClick={handleClose} className="absolute top-6 right-6 text-secondary hover:text-primary transition-colors"><X className="w-6 h-6" /></button>
        <h2 className="text-2xl font-bold text-primary mb-1">{isLeads ? 'Importer des leads' : 'Importer des clients'}</h2>
        <p className="text-sm text-secondary mb-6">
          {isLeads
            ? 'Les contacts importés seront créés en statut Lead Froid par défaut (sauf colonne Statut renseignée).'
            : 'Importez votre liste depuis Excel ou tout autre tableur.'}
        </p>

        {step === 1 && (
          <>
            <div className="mb-6 rounded-2xl bg-base/50 border border-[var(--elevation-border)] p-5 space-y-4">
              <p className="text-sm font-bold text-primary">Comment faire ? (3 étapes simples)</p>
              <div className="space-y-3">
                {[
                  { n: 1, title: 'Téléchargez le modèle', desc: 'Cliquez sur le bouton ci-dessous.' },
                  { n: 2, title: 'Remplissez vos contacts', desc: `Ouvrez dans Excel ou Google Sheets. Remplissez une ligne par contact. Entreprise OU Nom est obligatoire.` },
                  { n: 3, title: 'Importez ici', desc: 'Enregistrez en .csv puis déposez dans la zone ci-dessous.' },
                ].map(({ n, title, desc }) => (
                  <div key={n} className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent text-black text-xs font-bold flex items-center justify-center">{n}</span>
                    <div>
                      <p className="text-sm font-semibold text-primary">{title}</p>
                      <p className="text-xs text-secondary mt-0.5">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => downloadTemplate(isLeads)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-accent text-black text-sm font-bold hover:scale-105 transition-all shadow-md shadow-accent/20"
              >
                <Download className="w-4 h-4" />
                Télécharger le modèle
              </button>
            </div>
            <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileChange} />
            <div
              className="w-full h-40 border-2 border-dashed border-[var(--elevation-border)] rounded-2xl flex flex-col items-center justify-center gap-3 text-secondary hover:border-accent/50 hover:bg-accent/5 transition-all cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-7 h-7 text-primary" />
              <div className="text-center">
                <p className="text-base font-bold text-primary">Glissez votre fichier ici</p>
                <p className="text-sm">ou cliquez pour choisir</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-secondary text-center">Format accepté : .csv (séparateur ; ou ,)</p>
          </>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <p className="text-sm text-secondary">{dataRows.length} ligne(s) détectée(s). Associez les colonnes de votre fichier.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-72 overflow-y-auto pr-1">
              {CSV_FIELDS.map(({ key, label }) => (
                <div key={key} className="space-y-1">
                  <label className="text-xs font-semibold text-secondary">{label}</label>
                  <select
                    value={mapping[key] ?? ''}
                    onChange={(e) => setMapping(prev => ({ ...prev, [key]: e.target.value }))}
                    className={`${inputCls} appearance-none text-sm`}
                  >
                    <option value="">Ignorer cette colonne</option>
                    {headers.map((h, i) => <option key={i} value={String(i)}>{h || `Colonne ${i + 1}`}</option>)}
                  </select>
                </div>
              ))}
            </div>
            {result?.error && (
              <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-red-500/10 border border-red-500/25">
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-xs text-red-400">{result.error}</p>
              </div>
            )}
            <div className="flex justify-end gap-4 pt-2">
              <button onClick={() => { setStep(1); setResult(null) }} className="px-6 py-3 rounded-full text-secondary hover:text-primary font-semibold transition-colors">Retour</button>
              <button
                onClick={handleImport}
                disabled={isPending || (!mapping['company_name'] && !mapping['last_name'] && !mapping['first_name'])}
                className="px-6 py-3 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20 flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                {isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Import...</> : `Importer ${dataRows.length} contacts`}
              </button>
            </div>
          </div>
        )}

        {step === 3 && result && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <CheckCircle2 className="w-16 h-16 text-accent-green" />
            <p className="text-xl font-bold text-primary">{result.imported} contact(s) importé(s) avec succès</p>
            {result.skipped > 0 && <p className="text-sm text-secondary">{result.skipped} ligne(s) ignorée(s) (nom manquant).</p>}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <tr>
      <td colSpan={7} className="px-6 py-20 text-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-20 h-20 flex items-center justify-center">
            {filtered ? <Filter className="w-10 h-10 text-secondary opacity-20" /> : <Building2 className="w-10 h-10 text-secondary opacity-20" />}
          </div>
          <div>
            <p className="text-xl font-bold text-primary">
              {filtered ? 'Aucun contact trouvé' : 'Aucun contact pour le moment'}
            </p>
            <p className="text-secondary mt-1">
              {filtered ? 'Essayez de modifier vos critères de recherche.' : 'Commencez par ajouter un client ou un lead.'}
            </p>
          </div>
        </div>
      </td>
    </tr>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ClientsClient({ initialClients, canCreate, canEdit, canDelete, canImport }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [sortBy, setSortBy] = useState('created_at')
  const [isNewClientModalOpen, setIsNewClientModalOpen] = useState(false)
  const [isNewLeadModalOpen, setIsNewLeadModalOpen] = useState(false)
  const [isImportCSVModalOpen, setIsImportCSVModalOpen] = useState(false)
  const [importIsLeads, setImportIsLeads] = useState(false)
  const [isImportDropdownOpen, setIsImportDropdownOpen] = useState(false)
  const importDropdownRef = useRef<HTMLDivElement>(null)
  const [editingClient, setEditingClient] = useState<Client | null>(null)
  const [isPending, startTransition] = useTransition()

  const statusOptions = [
    { value: 'All',       label: 'Tous' },
    { value: 'active',    label: 'Clients' },
    { value: 'prospect',  label: 'Prospects' },
    { value: 'lead_hot',  label: 'Leads Chauds' },
    { value: 'lead_cold', label: 'Leads Froids' },
    { value: 'inactive',  label: 'Inactifs' },
  ]

  const sortOptions = [
    { value: 'created_at',   label: 'Plus récents' },
    { value: 'name',         label: 'Trier par Nom' },
    { value: 'revenue_desc', label: 'Trier par CA' },
  ]

  const filteredClients = initialClients
    .filter(client => {
      const name = clientDisplayName(client).toLowerCase()
      const matchesSearch =
        name.includes(searchTerm.toLowerCase()) ||
        (client.email ?? '').toLowerCase().includes(searchTerm.toLowerCase())
      const matchesStatus = statusFilter === 'All' || client.status === statusFilter
      return matchesSearch && matchesStatus
    })
    .sort((a, b) => {
      if (sortBy === 'revenue_desc') return (b.total_revenue ?? 0) - (a.total_revenue ?? 0)
      if (sortBy === 'name') return clientDisplayName(a).localeCompare(clientDisplayName(b))
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

  const totalClients   = initialClients.filter(c => c.status === 'active').length
  const totalPipeline  = initialClients.filter(c => LEAD_STATUSES.includes(c.status ?? '')).length
  const totalRevenue   = initialClients.filter(c => c.status === 'active').reduce((acc, c) => acc + (c.total_revenue ?? 0), 0)

  const handleExportCSV = () => {
    const headers = ['ID', 'Entreprise', 'Prénom', 'Nom', 'Email', 'Téléphone', 'Statut', 'Source', 'CA Total']
    const csvContent = [
      headers.join(','),
      ...filteredClients.map(c => [
        c.id,
        `"${c.company_name ?? ''}"`,
        c.first_name ?? '',
        c.last_name ?? '',
        c.email ?? '',
        c.phone ?? '',
        c.status ?? '',
        c.source ?? '',
        c.total_revenue ?? 0,
      ].join(',')),
    ].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `contacts_export_${todayParis()}.csv`
    link.click()
  }

  const handleDelete = (clientId: string, clientName: string) => {
    if (!confirm(`Archiver "${clientName}" ? Il ne sera plus visible dans la liste.`)) return
    startTransition(async () => {
      const { error } = await deleteClient(clientId)
      if (error) alert(error)
    })
  }

  const handleConvertToClient = (clientId: string, clientName: string) => {
    if (!confirm(`Convertir "${clientName}" en client actif ?`)) return
    startTransition(async () => {
      const { error } = await convertToClient(clientId)
      if (error) alert(error)
    })
  }

  const handleCreateQuote = async (client: Client) => {
    // Auto-transition lead → prospect au moment de créer un devis
    if (client.status === 'lead_hot' || client.status === 'lead_cold') {
      await convertToProspect(client.id)
    }
    const params = new URLSearchParams({ client: client.id, returnTo: pathname })
    router.push(`/finances/quote-editor?${params}`)
  }

  const openImport = (forLeads: boolean) => {
    setImportIsLeads(forLeads)
    setIsImportCSVModalOpen(true)
  }

  const isFiltered = searchTerm !== '' || statusFilter !== 'All'

  return (
    <main className="page-container space-y-6 md:space-y-8">
      <NewClientModal isOpen={isNewClientModalOpen} onClose={() => setIsNewClientModalOpen(false)} />
      <NewLeadModal isOpen={isNewLeadModalOpen} onClose={() => setIsNewLeadModalOpen(false)} />
      <ImportCSVModal isOpen={isImportCSVModalOpen} onClose={() => setIsImportCSVModalOpen(false)} isLeads={importIsLeads} />
      {editingClient && <EditClientModal client={editingClient} onClose={() => setEditingClient(null)} />}

      {/* En-tête */}
      <div className="flex flex-col gap-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-4xl font-bold text-primary">Clients & Leads</h1>
            <p className="text-secondary text-lg">Gérez votre base de contacts, de la prospection à la fidélisation.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            {/* Import dropdown */}
            {canImport && (
              <div className="relative flex-1 md:flex-none" ref={importDropdownRef}>
                <button
                  onClick={() => setIsImportDropdownOpen(v => !v)}
                  className="w-full px-4 py-2.5 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-primary font-semibold flex items-center justify-center gap-2 hover:bg-base transition-all text-sm whitespace-nowrap"
                >
                  <Upload className="w-4 h-4" />Importer
                </button>
                {isImportDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setIsImportDropdownOpen(false)} />
                    <div className="absolute left-0 sm:left-auto sm:right-0 top-full mt-1.5 w-52 rounded-2xl bg-surface dark:bg-[#1a1a1a] border border-[var(--elevation-border)] shadow-xl overflow-hidden z-20 animate-in fade-in slide-in-from-top-2 duration-150">
                      <button onClick={() => { openImport(false); setIsImportDropdownOpen(false) }} className="w-full text-left px-4 py-3 text-sm font-semibold text-primary hover:bg-accent/5 transition-colors">
                        Importer des clients
                      </button>
                      <button onClick={() => { openImport(true); setIsImportDropdownOpen(false) }} className="w-full text-left px-4 py-3 text-sm font-semibold text-primary hover:bg-accent/5 transition-colors border-t border-[var(--elevation-border)]">
                        Importer des leads
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            <button onClick={handleExportCSV} className="flex-1 md:flex-none px-4 py-2.5 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-primary font-semibold flex items-center justify-center gap-2 hover:bg-base transition-all text-sm whitespace-nowrap">
              <Download className="w-4 h-4" />Exporter
            </button>
            {canCreate && (
              <button onClick={() => setIsNewLeadModalOpen(true)} className="flex-1 md:flex-none px-4 py-2.5 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-primary font-semibold flex items-center justify-center gap-2 hover:bg-base transition-all text-sm whitespace-nowrap">
                <Target className="w-4 h-4" />Nouveau Lead
              </button>
            )}
            {canCreate && (
              <button onClick={() => setIsNewClientModalOpen(true)} className="flex-1 md:flex-none px-6 py-2.5 rounded-full bg-accent text-black font-bold flex items-center justify-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20 text-sm whitespace-nowrap">
                <UserCheck className="w-4 h-4" />Nouveau Client
              </button>
            )}
          </div>
        </div>

        {/* Filtres */}
        <div className="flex flex-col xl:flex-row items-start xl:items-center gap-4 w-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] p-4 rounded-2xl shadow-sm">
          <div className="relative flex-1 w-full min-w-[250px] max-w-sm">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-secondary" />
            <input
              type="text"
              placeholder="Rechercher..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-2.5 rounded-full bg-base border border-[var(--elevation-border)] focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all text-primary text-sm"
            />
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 w-full xl:w-auto xl:ml-auto">
            <FilterSelect value={statusFilter} onChange={setStatusFilter} options={statusOptions} />
            <FilterSelect value={sortBy} onChange={setSortBy} options={sortOptions} />
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="rounded-3xl card p-6 flex items-center gap-4">
          <div className="w-12 h-12 flex items-center justify-center rounded-2xl bg-accent-green/10">
            <Users className="w-6 h-6 text-accent-green" />
          </div>
          <div>
            <p className="text-sm font-semibold text-secondary uppercase tracking-wider">Clients Actifs</p>
            <p className="text-2xl font-bold text-primary tabular-nums">{totalClients}</p>
          </div>
        </div>
        <div className="rounded-3xl card p-6 flex items-center gap-4">
          <div className="w-12 h-12 flex items-center justify-center rounded-2xl bg-accent/10">
            <Target className="w-6 h-6 text-accent" />
          </div>
          <div>
            <p className="text-sm font-semibold text-secondary uppercase tracking-wider">Pipeline</p>
            <p className="text-2xl font-bold text-primary tabular-nums">{totalPipeline}</p>
            <p className="text-xs text-secondary">leads + prospects</p>
          </div>
        </div>
        <div className="rounded-3xl card p-6 flex items-center gap-4">
          <div className="w-12 h-12 flex items-center justify-center rounded-2xl bg-blue-500/10">
            <Euro className="w-6 h-6 text-blue-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-secondary uppercase tracking-wider">CA Clients</p>
            <p className="text-2xl font-bold text-primary tabular-nums">{formatCurrency(totalRevenue)}</p>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-3xl card overflow-visible">
        <div className="overflow-x-auto md:overflow-visible">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--elevation-border)] bg-base/30">
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider whitespace-nowrap">Contact</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider whitespace-nowrap">Email / Tél.</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider whitespace-nowrap">Statut</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider whitespace-nowrap">Source</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider text-right whitespace-nowrap">CA Total</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider whitespace-nowrap">Paiement</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className={`divide-y divide-[var(--elevation-border)] ${isPending ? 'opacity-60 pointer-events-none' : ''}`}>
              {filteredClients.length > 0 ? filteredClients.map((client) => {
                const badge = statusBadge(client.status)
                const name = clientDisplayName(client)
                const isLead = LEAD_STATUSES.includes(client.status ?? '')
                return (
                  <tr key={client.id} className="hover:bg-accent/5 transition-colors group">
                    <td className="px-6 py-4">
                      <Link href={`/clients/${client.id}`}>
                        <p className="font-bold text-primary hover:text-accent transition-colors">{name}</p>
                        {client.company_name && client.contact_name && (
                          <p className="text-xs text-secondary mt-0.5">
                            Réf. : <span className="font-medium text-primary">{client.contact_name}</span>
                          </p>
                        )}
                        {client.siret && <p className="text-xs text-secondary tabular-nums">SIRET : {client.siret}</p>}
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      {client.email && <p className="text-sm text-primary">{client.email}</p>}
                      {client.phone && <p className="text-xs text-secondary tabular-nums">{client.phone}</p>}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-xs text-secondary">{sourceLabel(client.source)}</p>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <p className="text-sm font-bold text-primary tabular-nums">
                        {isLead ? '/' : formatCurrency(client.total_revenue ?? 0)}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-secondary">{client.payment_terms_days ?? 30} j</p>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <ActionMenu actions={[
                        { label: 'Voir la fiche', icon: <Eye className="w-4 h-4" />, onClick: () => router.push(`/clients/${client.id}`) },
                        { label: 'Créer un devis', icon: <FileText className="w-4 h-4" />, onClick: () => handleCreateQuote(client) },
                        ...(isLead && canEdit ? [{
                          label: 'Convertir en client',
                          icon: <ArrowRight className="w-4 h-4" />,
                          onClick: () => handleConvertToClient(client.id, name),
                        }] : []),
                        ...(canEdit ? [{ label: 'Éditer', icon: <Edit2 className="w-4 h-4" />, onClick: () => setEditingClient(client) }] : []),
                        ...(canDelete ? [{ label: 'Supprimer', icon: <Trash2 className="w-4 h-4" />, onClick: () => handleDelete(client.id, name), danger: true }] : []),
                      ]} />
                    </td>
                  </tr>
                )
              }) : (
                <EmptyState filtered={isFiltered} />
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}
