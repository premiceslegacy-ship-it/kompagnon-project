'use client'

import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Archive, CheckCircle, ChevronLeft, ChevronRight, CopyPlus, Download, Edit3, FileText, LayoutTemplate, Plus, RefreshCw, Save, Search, Send, ShieldAlert, Trash2, X } from 'lucide-react'
import { ActionButton as SubmitActionButton } from '@/components/ui/ActionButton'
import type { Chantier } from '@/lib/data/queries/chantiers'
import type { Client } from '@/lib/data/queries/clients'
import type { ContractListItem, ContractTemplateOption } from '@/lib/data/queries/contracts'
import type { Quote } from '@/lib/data/queries/quotes'
import {
  CLAUSE_LABELS,
  CONTRACT_DISCLAIMER,
  CONTRACT_TYPE_LABELS,
  getRoleLabel,
  type ContractClauseKey,
  type ContractClauses,
  type ContractCustomSection,
  type ContractRole,
  type ContractStatus,
  type ContractType,
} from '@/lib/contracts/templates'
import { createContract, createContractTemplate, createContractTemplateFromContract, deleteContract, deleteContractTemplate, fetchClientDocsForAttachment, generateContractPdfSnapshot, sendContract, updateContract } from '@/lib/data/mutations/contracts'
import AttachmentPickerModal, { type AttachmentGroup } from '@/components/AttachmentPickerModal'

type Props = {
  initialContracts: ContractListItem[]
  clients: Client[]
  chantiers: Chantier[]
  templates: ContractTemplateOption[]
  quotes: Quote[]
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
}

type ContractFormState = {
  title: string
  contractType: ContractType
  role: ContractRole
  clientId: string
  chantierId: string
  quoteId: string
  counterpartyName: string
  counterpartyEmail: string
  counterpartyPhone: string
  counterpartyAddress: string
  templateKey: string
  clauses: ContractClauses
  customSections: ContractCustomSection[]
  durationText: string
}

const STATUS_CONFIG: Record<ContractStatus, { label: string; color: string }> = {
  draft: { label: 'Brouillon', color: 'bg-zinc-500/15 text-zinc-500' },
  sent: { label: 'Envoyé', color: 'bg-blue-500/15 text-blue-600' },
  signed: { label: 'Signé', color: 'bg-green-500/15 text-green-600' },
  archived: { label: 'Archivé', color: 'bg-secondary/20 text-secondary' },
}

const CLAUSE_ORDER = Object.keys(CLAUSE_LABELS) as ContractClauseKey[]

function fmtDate(value: string | null | undefined): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat('fr-FR').format(new Date(value))
}

function clientName(client: Client): string {
  return client.company_name || client.contact_name || [client.first_name, client.last_name].filter(Boolean).join(' ') || client.email || 'Client sans nom'
}

function firstTemplateFor(type: ContractType, templates: ContractTemplateOption[]) {
  return templates.find(template => template.type === type) ?? templates[0]
}

function buildInitialForm(templates: ContractTemplateOption[], contract?: ContractListItem | null): ContractFormState {
  if (contract) {
    return {
      title: contract.title,
      contractType: contract.contract_type,
      role: contract.role,
      clientId: contract.client_id ?? '',
      chantierId: contract.chantier_id ?? '',
      quoteId: contract.quote_id ?? '',
      counterpartyName: contract.counterparty_name,
      counterpartyEmail: contract.counterparty_email ?? '',
      counterpartyPhone: contract.counterparty_phone ?? '',
      counterpartyAddress: contract.counterparty_address ?? '',
      templateKey: contract.template_key,
      clauses: contract.clauses,
      customSections: contract.custom_sections ?? [],
      durationText: contract.duration_text ?? '',
    }
  }

  const template = firstTemplateFor('sous_traitance', templates)
  return {
    title: '',
    contractType: 'sous_traitance',
    role: 'donneur_ordre',
    clientId: '',
    chantierId: '',
    quoteId: '',
    counterpartyName: '',
    counterpartyEmail: '',
    counterpartyPhone: '',
    counterpartyAddress: '',
    templateKey: template?.key ?? '',
    clauses: template?.clauses ?? {} as ContractClauses,
    customSections: template?.customSections ?? [],
    durationText: '',
  }
}

function StatusBadge({ status }: { status: ContractStatus }) {
  const cfg = STATUS_CONFIG[status]
  const tone = status === 'signed' ? 'success' : status === 'sent' ? 'info' : 'muted'
  return (
    <span className={`status-pill status-pill-${tone} px-2 py-0.5 text-xs font-semibold`}>
      {cfg.label}
    </span>
  )
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-semibold text-secondary uppercase tracking-wider mb-1">{label}</p>
      <p className="text-2xl font-extrabold text-primary">{value}</p>
    </div>
  )
}

function ActionButton({ children, icon, tone = 'neutral', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: React.ReactNode
  tone?: 'neutral' | 'danger'
}) {
  const toneClass = tone === 'danger'
    ? 'border-red-500/25 text-red-500 hover:bg-red-500/10 hover:border-red-500/45'
    : 'border-[var(--elevation-border)] text-primary hover:bg-base hover:border-accent/45'

  return (
    <button
      {...props}
      className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${toneClass} ${props.className ?? ''}`}
    >
      {icon}
      <span>{children}</span>
    </button>
  )
}

function LinkActionButton({ children, icon, href }: { children: React.ReactNode; icon: React.ReactNode; href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[var(--elevation-border)] px-3 text-xs font-bold text-primary transition-colors hover:bg-base hover:border-accent/45"
    >
      {icon}
      <span>{children}</span>
    </Link>
  )
}

function ContractFormModal({ mode, contract, clients, chantiers, templates, quotes, onClose, onSaved }: {
  mode: 'create' | 'edit'
  contract?: ContractListItem | null
  clients: Client[]
  chantiers: Chantier[]
  templates: ContractTemplateOption[]
  quotes: Quote[]
  onClose: () => void
  onSaved: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<ContractFormState>(() => buildInitialForm(templates, contract))
  const availableTemplates = templates.filter(template => template.type === form.contractType)
  // Devis filtrés par client sélectionné, ou tous si pas de client
  const availableQuotes = form.clientId
    ? quotes.filter(q => q.client?.id === form.clientId && q.number)
    : quotes.filter(q => q.number)

  const set = (field: keyof ContractFormState, value: string) => setForm(current => ({ ...current, [field]: value }))

  const handleTypeChange = (nextType: ContractType) => {
    const template = firstTemplateFor(nextType, templates)
    setForm(current => ({
      ...current,
      contractType: nextType,
      templateKey: template?.key ?? '',
      clauses: template?.clauses ?? current.clauses,
      customSections: template?.customSections ?? [],
    }))
  }

  const handleTemplateChange = (templateKey: string) => {
    const template = templates.find(item => item.key === templateKey)
    if (!template) return
    setForm(current => ({
      ...current,
      templateKey,
      clauses: template.clauses,
      customSections: template.customSections ?? [],
    }))
  }

  const handleClientChange = (clientId: string) => {
    const client = clients.find(item => item.id === clientId)
    setForm(current => {
      const quoteStillValid = current.quoteId
        ? quotes.some(q => q.id === current.quoteId && q.client?.id === clientId)
        : true
      return {
        ...current,
        clientId,
        quoteId: quoteStillValid ? current.quoteId : '',
        counterpartyName: client ? clientName(client) : '',
        counterpartyEmail: client?.email ?? '',
        counterpartyPhone: client?.phone ?? '',
        counterpartyAddress: client ? [client.address_line1, client.postal_code, client.city].filter(Boolean).join(', ') : '',
      }
    })
  }

  const handleChantierChange = (chantierId: string) => {
    const chantier = chantiers.find(item => item.id === chantierId)
    const linkedClientId = chantier?.client?.id ?? ''
    const client = linkedClientId ? clients.find(item => item.id === linkedClientId) : null

    setForm(current => ({
      ...current,
      chantierId,
      clientId: linkedClientId || current.clientId,
      counterpartyName: client ? clientName(client) : current.counterpartyName,
      counterpartyEmail: client?.email ?? current.counterpartyEmail,
      counterpartyPhone: client?.phone ?? current.counterpartyPhone,
      counterpartyAddress: client ? [client.address_line1, client.postal_code, client.city].filter(Boolean).join(', ') : current.counterpartyAddress,
    }))
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)

    const payload = {
      title: form.title,
      contractType: form.contractType,
      role: form.role,
      clientId: form.clientId || null,
      chantierId: form.chantierId || null,
      quoteId: form.quoteId || null,
      counterpartyName: form.counterpartyName,
      counterpartyEmail: form.counterpartyEmail || null,
      counterpartyPhone: form.counterpartyPhone || null,
      counterpartyAddress: form.counterpartyAddress || null,
      templateKey: form.templateKey,
      clauses: form.clauses,
      customSections: form.customSections,
      durationText: form.durationText.trim() || null,
    }

    const result = mode === 'edit' && contract
      ? await updateContract(contract.id, payload)
      : await createContract(payload)

    setLoading(false)
    if (result.error) return setError(result.error)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-[9995] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <form onSubmit={handleSubmit} className="card w-full max-w-5xl max-h-[92vh] overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="text-xl font-extrabold text-primary">{mode === 'edit' ? 'Modifier le contrat' : 'Nouveau contrat'}</h2>
            <p className="text-sm text-secondary mt-1">Les modifications nécessitent de régénérer le PDF.</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded hover:bg-base text-secondary hover:text-primary">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-primary mb-1">Type</label>
            <select className="input w-full" value={form.contractType} onChange={event => handleTypeChange(event.target.value as ContractType)}>
              <option value="sous_traitance">Sous-traitance</option>
              <option value="maintenance">Maintenance</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-primary mb-1">Rôle</label>
            <select className="input w-full" value={form.role} onChange={event => set('role', event.target.value)}>
              <option value="donneur_ordre">{getRoleLabel('donneur_ordre', form.contractType)}</option>
              <option value="sous_traitant">{getRoleLabel('sous_traitant', form.contractType)}</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-primary mb-1">Template de contrat</label>
            <select className="input w-full" value={form.templateKey} onChange={event => handleTemplateChange(event.target.value)}>
              {availableTemplates.map(template => (
                <option key={template.key} value={template.key}>{template.title}{template.isCustom ? ' · personnalisé' : ''}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-secondary">Choisissez ici le modèle de base ou un template personnalisé.</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-primary mb-1">Titre</label>
            <input className="input w-full" value={form.title} onChange={event => set('title', event.target.value)} required />
          </div>
          <div>
            <label className="block text-sm font-semibold text-primary mb-1">Client lié</label>
            <select className="input w-full" value={form.clientId} onChange={event => handleClientChange(event.target.value)}>
              <option value="">Aucun client lié</option>
              {clients.map(client => <option key={client.id} value={client.id}>{clientName(client)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-primary mb-1">Chantier lié</label>
            <select className="input w-full" value={form.chantierId} onChange={event => handleChantierChange(event.target.value)}>
              <option value="">Aucun chantier lié</option>
              {chantiers.map(chantier => <option key={chantier.id} value={chantier.id}>{chantier.title}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-primary mb-1">
              Devis lié <span className="text-secondary font-normal">(facultatif - validation en ligne par le client)</span>
            </label>
            <select className="input w-full" value={form.quoteId} onChange={event => set('quoteId', event.target.value)}>
              <option value="">Aucun devis lié</option>
              {availableQuotes.map(q => (
                <option key={q.id} value={q.id}>
                  {q.number} - {q.title ?? 'Sans titre'}{q.total_ttc != null ? ` · ${new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(q.total_ttc)}` : ''}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-secondary">Si renseigné, le client pourra valider ce devis en même temps qu'il signe le contrat.</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-primary mb-1">Partie contractante</label>
            <input className="input w-full" value={form.counterpartyName} onChange={event => set('counterpartyName', event.target.value)} required />
          </div>
          <div>
            <label className="block text-sm font-semibold text-primary mb-1">E-mail</label>
            <input className="input w-full" type="email" value={form.counterpartyEmail} onChange={event => set('counterpartyEmail', event.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-semibold text-primary mb-1">Téléphone</label>
            <input className="input w-full" value={form.counterpartyPhone} onChange={event => set('counterpartyPhone', event.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-semibold text-primary mb-1">Adresse</label>
            <input className="input w-full" value={form.counterpartyAddress} onChange={event => set('counterpartyAddress', event.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-semibold text-primary mb-1">Durée du contrat <span className="text-secondary font-normal">(facultatif)</span></label>
            <input
              className="input w-full"
              value={form.durationText}
              onChange={event => set('durationText', event.target.value)}
              placeholder="Ex : 12 mois renouvelable, jusqu'au 31/12/2026, durée du chantier…"
            />
            <p className="mt-1 text-xs text-secondary">Si renseignée, cette durée sera ajoutée en tête de la clause Durée du contrat.</p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {CLAUSE_ORDER.map(key => (
            <div key={key}>
              <label className="block text-sm font-semibold text-primary mb-1">{CLAUSE_LABELS[key]}</label>
              <textarea
                className="input w-full min-h-28 text-sm"
                value={form.clauses[key] ?? ''}
                onChange={event => setForm(current => ({ ...current, clauses: { ...current.clauses, [key]: event.target.value } }))}
              />
            </div>
          ))}
        </div>

        <div className="mt-6">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="text-sm font-extrabold text-primary uppercase tracking-wider">Sections supplémentaires</h3>
            <button
              type="button"
              className="btn-secondary text-sm inline-flex items-center gap-2 py-2 px-3"
              onClick={() => setForm(current => ({
                ...current,
                customSections: [
                  ...current.customSections,
                  { id: `section-${Date.now()}`, title: '', content: '' },
                ],
              }))}
            >
              <Plus className="w-4 h-4" />
              Ajouter une section
            </button>
          </div>
          {form.customSections.length === 0 ? (
            <p className="text-sm text-secondary">Aucune section supplémentaire.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {form.customSections.map((section, index) => (
                <div key={section.id} className="rounded-lg border border-[var(--elevation-border)] p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 flex-1">
                      <input
                        className="input w-full"
                        value={section.title}
                        placeholder={`Titre de la section ${index + 1}`}
                        onChange={event => setForm(current => ({
                          ...current,
                          customSections: current.customSections.map(item => item.id === section.id ? { ...item, title: event.target.value } : item),
                        }))}
                      />
                      <textarea
                        className="input w-full md:col-span-2 min-h-24 text-sm"
                        value={section.content}
                        placeholder="Contenu de la section"
                        onChange={event => setForm(current => ({
                          ...current,
                          customSections: current.customSections.map(item => item.id === section.id ? { ...item, content: event.target.value } : item),
                        }))}
                      />
                    </div>
                    <button
                      type="button"
                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-red-500/25 text-red-500 hover:bg-red-500/10"
                      onClick={() => setForm(current => ({
                        ...current,
                        customSections: current.customSections.filter(item => item.id !== section.id),
                      }))}
                      title="Supprimer la section"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-5 flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-primary">
          <ShieldAlert className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
          <p>{CONTRACT_DISCLAIMER}</p>
        </div>

        {error && <p className="mt-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500 font-semibold">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
          <SubmitActionButton type="submit" loading={loading} disabled={!form.templateKey} className="btn-primary inline-flex items-center gap-2">
            {mode === 'edit' ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {mode === 'edit' ? 'Enregistrer' : 'Créer le brouillon'}
          </SubmitActionButton>
        </div>
      </form>
    </div>
  )
}

function TemplateModal({ templates, canDelete, onClose, onSaved }: {
  templates: ContractTemplateOption[]
  canDelete: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const customTemplates = templates.filter(t => t.isCustom)
  const base = firstTemplateFor('sous_traitance', templates)
  const [tab, setTab] = useState<'create' | 'manage'>('create')
  const [contractType, setContractType] = useState<ContractType>('sous_traitance')
  const [title, setTitle] = useState('')
  const [baseKey, setBaseKey] = useState(base?.key ?? '')
  const [clauses, setClauses] = useState<ContractClauses>(base?.clauses ?? {} as ContractClauses)
  const [customSections, setCustomSections] = useState<ContractCustomSection[]>(base?.customSections ?? [])
  const [loading, setLoading] = useState(false)
  const [deletingKey, setDeletingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const availableTemplates = templates.filter(template => template.type === contractType)

  const handleTypeChange = (nextType: ContractType) => {
    const template = firstTemplateFor(nextType, templates)
    setContractType(nextType)
    setBaseKey(template?.key ?? '')
    setClauses(template?.clauses ?? {} as ContractClauses)
    setCustomSections(template?.customSections ?? [])
  }

  const handleBaseChange = (templateKey: string) => {
    const template = templates.find(item => item.key === templateKey)
    if (!template) return
    setBaseKey(templateKey)
    setClauses(template.clauses)
    setCustomSections(template.customSections ?? [])
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    const result = await createContractTemplate({ title, contractType, clauses, customSections })
    setLoading(false)
    if (result.error) return setError(result.error)
    onSaved()
  }

  const handleDeleteTemplate = async (templateKey: string) => {
    const templateId = templateKey.replace('custom:', '')
    if (!confirm('Supprimer ce template ? Cette action est irréversible.')) return
    setDeletingKey(templateKey)
    setError(null)
    const result = await deleteContractTemplate(templateId)
    setDeletingKey(null)
    if (result.error) return setError(result.error)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-[9995] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="card w-full max-w-4xl max-h-[92vh] overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="text-xl font-extrabold text-primary">Templates de contrat</h2>
            <p className="text-sm text-secondary mt-1">Créez et gérez vos modèles réutilisables.</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded hover:bg-base text-secondary hover:text-primary">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex gap-1 mb-6 border-b border-[var(--elevation-border)]">
          <button
            type="button"
            onClick={() => setTab('create')}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${tab === 'create' ? 'border-accent text-accent' : 'border-transparent text-secondary hover:text-primary'}`}
          >
            Nouveau template
          </button>
          <button
            type="button"
            onClick={() => setTab('manage')}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${tab === 'manage' ? 'border-accent text-accent' : 'border-transparent text-secondary hover:text-primary'}`}
          >
            Mes templates
            {customTemplates.length > 0 && (
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent/15 text-accent text-xs font-bold">
                {customTemplates.length}
              </span>
            )}
          </button>
        </div>

        {tab === 'manage' ? (
          <div>
            {customTemplates.length === 0 ? (
              <div className="py-10 text-center">
                <LayoutTemplate className="w-8 h-8 text-secondary mx-auto mb-3" />
                <p className="text-sm text-secondary">Aucun template personnalisé pour le moment.</p>
                <button type="button" onClick={() => setTab('create')} className="mt-3 text-sm font-semibold text-accent hover:underline">
                  Créer un template
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {customTemplates.map(template => (
                  <div key={template.key} className="flex items-center justify-between gap-4 rounded-lg border border-[var(--elevation-border)] px-4 py-3">
                    <div>
                      <p className="font-semibold text-primary text-sm">{template.title}</p>
                      <p className="text-xs text-secondary mt-0.5">{CONTRACT_TYPE_LABELS[template.type]}</p>
                    </div>
                    {canDelete && (
                      <button
                        type="button"
                        disabled={deletingKey === template.key}
                        onClick={() => handleDeleteTemplate(template.key)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/25 text-red-500 hover:bg-red-500/10 disabled:opacity-50"
                        title="Supprimer ce template"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {error && <p className="mt-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500 font-semibold">{error}</p>}
            <div className="mt-6 flex justify-end">
              <button type="button" onClick={onClose} className="btn-secondary">Fermer</button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-primary mb-1">Type</label>
                <select className="input w-full" value={contractType} onChange={event => handleTypeChange(event.target.value as ContractType)}>
                  <option value="sous_traitance">Sous-traitance</option>
                  <option value="maintenance">Maintenance</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-primary mb-1">Base</label>
                <select className="input w-full" value={baseKey} onChange={event => handleBaseChange(event.target.value)}>
                  {availableTemplates.map(template => <option key={template.key} value={template.key}>{template.title}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-primary mb-1">Nom du template</label>
                <input className="input w-full" value={title} onChange={event => setTitle(event.target.value)} required placeholder="Ex. Maintenance copropriété" />
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              {CLAUSE_ORDER.map(key => (
                <div key={key}>
                  <label className="block text-sm font-semibold text-primary mb-1">{CLAUSE_LABELS[key]}</label>
                  <textarea
                    className="input w-full min-h-28 text-sm"
                    value={clauses[key] ?? ''}
                    onChange={event => setClauses(current => ({ ...current, [key]: event.target.value }))}
                  />
                </div>
              ))}
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="text-sm font-extrabold text-primary uppercase tracking-wider">Sections supplémentaires</h3>
                <button
                  type="button"
                  className="btn-secondary text-sm inline-flex items-center gap-2 py-2 px-3"
                  onClick={() => setCustomSections(current => [...current, { id: `section-${Date.now()}`, title: '', content: '' }])}
                >
                  <Plus className="w-4 h-4" />
                  Ajouter une section
                </button>
              </div>
              {customSections.length === 0 ? (
                <p className="text-sm text-secondary">Aucune section supplémentaire.</p>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {customSections.map((section, index) => (
                    <div key={section.id} className="rounded-lg border border-[var(--elevation-border)] p-4">
                      <div className="flex items-start gap-3">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 flex-1">
                          <input
                            className="input w-full"
                            value={section.title}
                            placeholder={`Titre de la section ${index + 1}`}
                            onChange={event => setCustomSections(current => current.map(item => item.id === section.id ? { ...item, title: event.target.value } : item))}
                          />
                          <textarea
                            className="input w-full md:col-span-2 min-h-24 text-sm"
                            value={section.content}
                            placeholder="Contenu de la section"
                            onChange={event => setCustomSections(current => current.map(item => item.id === section.id ? { ...item, content: event.target.value } : item))}
                          />
                        </div>
                        <button
                          type="button"
                          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-red-500/25 text-red-500 hover:bg-red-500/10"
                          onClick={() => setCustomSections(current => current.filter(item => item.id !== section.id))}
                          title="Supprimer la section"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {error && <p className="mt-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500 font-semibold">{error}</p>}

            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
              <SubmitActionButton type="submit" loading={loading} className="btn-primary inline-flex items-center gap-2">
                <Save className="w-4 h-4" />
                Créer le template
              </SubmitActionButton>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

export default function ContractsClient({ initialContracts, clients, chantiers, templates, quotes, canCreate, canEdit, canDelete }: Props) {
  const router = useRouter()
  const [contracts, setContracts] = useState(initialContracts)
  const [query, setQuery] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showTemplate, setShowTemplate] = useState(false)
  const [editingContract, setEditingContract] = useState<ContractListItem | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [sendModalContract, setSendModalContract] = useState<ContractListItem | null>(null)
  const [sendModalGroups, setSendModalGroups] = useState<AttachmentGroup[]>([])
  const [sendModalLoading, setSendModalLoading] = useState(false)
  const [sendModalSubmitting, setSendModalSubmitting] = useState(false)
  const [sendModalError, setSendModalError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 10

  const openSendModal = async (contract: ContractListItem) => {
    setSendModalContract(contract)
    setSendModalGroups([])
    setSendModalError(null)
    if (!contract.client_id) {
      setSendModalGroups([
        { key: 'quotes', label: 'Devis liés', items: [] },
        { key: 'invoices', label: 'Factures liées', items: [] },
      ])
      return
    }
    setSendModalLoading(true)
    try {
      const docs = await fetchClientDocsForAttachment(contract.client_id)
      setSendModalGroups([
        { key: 'quotes', label: 'Devis du client', items: docs.quotes },
        { key: 'invoices', label: 'Factures du client', items: docs.invoices },
      ])
    } catch (err) {
      setSendModalError(err instanceof Error ? err.message : 'Erreur de chargement des documents.')
    } finally {
      setSendModalLoading(false)
    }
  }

  const confirmSend = async (selected: Record<string, string[]>) => {
    if (!sendModalContract) return
    setSendModalSubmitting(true)
    setSendModalError(null)
    const result = await sendContract(sendModalContract.id, {
      attachQuoteIds: selected.quotes ?? [],
      attachInvoiceIds: selected.invoices ?? [],
    })
    setSendModalSubmitting(false)
    if (result.error) {
      setSendModalError(result.error)
      return
    }
    setSendModalContract(null)
    refresh()
  }

  useEffect(() => {
    setContracts(initialContracts)
    setIsRefreshing(false)
  }, [initialContracts])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return contracts
    return contracts.filter(contract =>
      contract.title.toLowerCase().includes(q)
      || contract.counterparty_name.toLowerCase().includes(q)
      || contract.template_title.toLowerCase().includes(q)
      || (contract.pdf_reference ?? '').toLowerCase().includes(q),
    )
  }, [contracts, query])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageStart = (currentPage - 1) * PAGE_SIZE
  const paginatedContracts = filtered.slice(pageStart, pageStart + PAGE_SIZE)

  const stats = useMemo(() => ({
    total: contracts.length,
    draft: contracts.filter(contract => contract.status === 'draft').length,
    signed: contracts.filter(contract => contract.status === 'signed').length,
    generated: contracts.filter(contract => contract.pdf_generated_at).length,
  }), [contracts])

  const refresh = () => {
    setIsRefreshing(true)
    router.refresh()
  }

  const runAction = async (contractId: string, action: () => Promise<{ error: string | null }>) => {
    setBusyId(contractId)
    setError(null)
    const result = await action()
    setBusyId(null)
    if (result.error) return setError(result.error)
    refresh()
  }

  const generateAndOpenPdf = async (contractId: string) => {
    setBusyId(contractId)
    setError(null)
    const pdfWindow = window.open('', '_blank')
    if (pdfWindow) {
      pdfWindow.document.write('<p style="font-family: system-ui; padding: 24px;">Génération du PDF...</p>')
    }
    const result = await generateContractPdfSnapshot(contractId)
    setBusyId(null)
    if (result.error) {
      if (pdfWindow) pdfWindow.close()
      return setError(result.error)
    }
    if (pdfWindow) {
      pdfWindow.location.href = `/api/pdf/contract/${contractId}`
    } else {
      window.open(`/api/pdf/contract/${contractId}`, '_blank')
    }
    refresh()
  }

  const convertToTemplate = async (contract: ContractListItem) => {
    setBusyId(contract.id)
    setError(null)
    const result = await createContractTemplateFromContract(contract.id)
    setBusyId(null)
    if (result.error) return setError(result.error)
    refresh()
  }

  const updateLocalStatus = (contractId: string, status: ContractStatus) => {
    setContracts(current => current.map(contract => contract.id === contractId ? { ...contract, status } : contract))
  }

  return (
    <main className="page-container space-y-6 md:space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold text-accent uppercase tracking-wider mb-1">Contrats</p>
          <h1 className="text-3xl font-extrabold text-primary">Contrats métier</h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={refresh}
            disabled={isRefreshing}
            title="Actualiser"
            className="btn-secondary inline-flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Actualiser
          </button>
          {canCreate && (
            <button onClick={() => setShowTemplate(true)} className="btn-secondary inline-flex items-center gap-2">
              <Save className="w-4 h-4" />
              Nouveau template
            </button>
          )}
          {canCreate && (
            <button onClick={() => setShowCreate(true)} className="btn-primary inline-flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Nouveau contrat
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Brouillons" value={stats.draft} />
        <StatCard label="Signés" value={stats.signed} />
        <StatCard label="PDF générés" value={stats.generated} />
      </div>

      <div className="card p-4 mb-5">
        <div className="flex items-center gap-3">
          <Search className="w-4 h-4 text-secondary" />
          <input
            className="bg-transparent outline-none flex-1 text-primary placeholder:text-secondary"
            placeholder="Rechercher un contrat"
            value={query}
            onChange={event => { setQuery(event.target.value); setPage(1) }}
          />
        </div>
      </div>

      {error && <p className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-500">{error}</p>}

      <div className="card overflow-hidden">
        {isRefreshing ? (
          <div className="p-6 space-y-3 animate-pulse">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex gap-4 items-center">
                <div className="flex-1 h-10 rounded-xl bg-gray-200 dark:bg-white/5" />
                <div className="w-32 h-10 rounded-xl bg-gray-200 dark:bg-white/5" />
                <div className="w-24 h-10 rounded-xl bg-gray-200 dark:bg-white/5" />
                <div className="w-20 h-10 rounded-xl bg-gray-200 dark:bg-white/5" />
              </div>
            ))}
          </div>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--elevation-border)]">
              <tr className="text-left text-xs uppercase tracking-wider text-secondary">
                <th className="px-4 py-3 font-semibold">Contrat</th>
                <th className="px-4 py-3 font-semibold">Partie</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 font-semibold">Statut</th>
                <th className="px-4 py-3 font-semibold">PDF</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-secondary">Aucun contrat.</td>
                </tr>
              ) : paginatedContracts.map(contract => (
                <tr key={contract.id} className="border-b border-[var(--elevation-border)] last:border-b-0 hover:bg-base/60">
                  <td className="px-4 py-4 min-w-64">
                    <p className="font-bold text-primary">{contract.title}</p>
                    <p className="text-xs text-secondary mt-0.5">{contract.template_title}</p>
                    {contract.chantier && <p className="text-xs text-secondary mt-0.5">Chantier : {contract.chantier.title}</p>}
                  </td>
                  <td className="px-4 py-4 min-w-44">
                    <p className="font-semibold text-primary">{contract.counterparty_name}</p>
                    <p className="text-xs text-secondary">{getRoleLabel(contract.role, contract.contract_type)}</p>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">{CONTRACT_TYPE_LABELS[contract.contract_type]}</td>
                  <td className="px-4 py-4 whitespace-nowrap"><StatusBadge status={contract.status} /></td>
                  <td className="px-4 py-4 min-w-40">
                    {contract.pdf_reference ? (
                      <div>
                        <p className="font-semibold text-primary">{contract.pdf_reference}</p>
                        <p className="text-xs text-secondary">{fmtDate(contract.pdf_generated_at)}</p>
                      </div>
                    ) : <span className="text-secondary">Non généré</span>}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {canEdit && contract.status !== 'archived' && (
                        <ActionButton
                          title="Modifier"
                          disabled={busyId === contract.id}
                          onClick={() => setEditingContract(contract)}
                          icon={<Edit3 className="w-3.5 h-3.5" />}
                        >
                          Modifier
                        </ActionButton>
                      )}
                      {canCreate && (
                        <ActionButton
                          title="Créer un template depuis ce contrat"
                          disabled={busyId === contract.id}
                          onClick={() => convertToTemplate(contract)}
                          icon={<CopyPlus className="w-3.5 h-3.5" />}
                        >
                          Template
                        </ActionButton>
                      )}
                      {canEdit && contract.status === 'draft' && (
                        <ActionButton
                          title="Envoyer le contrat par e-mail"
                          disabled={busyId === contract.id}
                          onClick={() => openSendModal(contract)}
                          icon={<Send className="w-3.5 h-3.5" />}
                        >
                          Envoyer
                        </ActionButton>
                      )}
                      {canEdit && contract.status !== 'signed' && contract.status !== 'archived' && (
                        <ActionButton
                          title="Marquer comme signé"
                          disabled={busyId === contract.id}
                          onClick={() => {
                            updateLocalStatus(contract.id, 'signed')
                            runAction(contract.id, () => updateContract(contract.id, { status: 'signed' }))
                          }}
                          icon={<CheckCircle className="w-3.5 h-3.5" />}
                        >
                          Signer
                        </ActionButton>
                      )}
                      {canEdit && (
                        <ActionButton
                          title="Générer et ouvrir le PDF"
                          disabled={busyId === contract.id}
                          onClick={() => generateAndOpenPdf(contract.id)}
                          icon={<FileText className="w-3.5 h-3.5" />}
                        >
                          PDF
                        </ActionButton>
                      )}
                      {contract.pdf_reference && (
                        <LinkActionButton href={`/api/pdf/contract/${contract.id}?download=1`} icon={<Download className="w-3.5 h-3.5" />}>
                          Télécharger
                        </LinkActionButton>
                      )}
                      {canEdit && contract.status !== 'archived' && (
                        <ActionButton
                          title="Archiver"
                          disabled={busyId === contract.id}
                          onClick={() => {
                            updateLocalStatus(contract.id, 'archived')
                            runAction(contract.id, () => updateContract(contract.id, { status: 'archived' }))
                          }}
                          icon={<Archive className="w-3.5 h-3.5" />}
                        >
                          Archiver
                        </ActionButton>
                      )}
                      {canDelete && (
                        <ActionButton
                          title="Supprimer"
                          disabled={busyId === contract.id}
                          onClick={() => {
                            if (!confirm('Supprimer ce contrat ?')) return
                            setContracts(current => current.filter(item => item.id !== contract.id))
                            runAction(contract.id, () => deleteContract(contract.id))
                          }}
                          tone="danger"
                          icon={<X className="w-3.5 h-3.5" />}
                        >
                          Suppr.
                        </ActionButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--elevation-border)]">
              <span className="text-xs text-secondary">
                {pageStart + 1}-{Math.min(pageStart + PAGE_SIZE, filtered.length)} sur {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1.5 rounded-lg hover:bg-accent/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Page précédente"
                >
                  <ChevronLeft className="w-4 h-4 text-secondary" />
                </button>
                <span className="px-2 text-xs font-semibold text-secondary">Page {currentPage} / {totalPages}</span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-1.5 rounded-lg hover:bg-accent/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Page suivante"
                >
                  <ChevronRight className="w-4 h-4 text-secondary" />
                </button>
              </div>
            </div>
          )}
        </div>
        )}
      </div>

      <div className="mt-5 flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-primary">
        <ShieldAlert className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
        <p>{CONTRACT_DISCLAIMER}</p>
      </div>

      {showCreate && (
        <ContractFormModal
          mode="create"
          clients={clients}
          chantiers={chantiers}
          templates={templates}
          quotes={quotes}
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false)
            refresh()
          }}
        />
      )}

      {editingContract && (
        <ContractFormModal
          mode="edit"
          contract={editingContract}
          clients={clients}
          chantiers={chantiers}
          templates={templates}
          quotes={quotes}
          onClose={() => setEditingContract(null)}
          onSaved={() => {
            setEditingContract(null)
            refresh()
          }}
        />
      )}

      {showTemplate && (
        <TemplateModal
          templates={templates}
          canDelete={canDelete}
          onClose={() => setShowTemplate(false)}
          onSaved={() => {
            setShowTemplate(false)
            refresh()
          }}
        />
      )}

      {sendModalContract && (
        <AttachmentPickerModal
          title="Envoyer le contrat"
          description="Sélectionnez les devis et factures du même client à joindre en pièces jointes."
          recipientEmail={sendModalContract.counterparty_email ?? null}
          groups={sendModalGroups}
          loading={sendModalLoading}
          submitting={sendModalSubmitting}
          error={sendModalError}
          onCancel={() => setSendModalContract(null)}
          onConfirm={confirmSend}
        />
      )}
    </main>
  )
}
