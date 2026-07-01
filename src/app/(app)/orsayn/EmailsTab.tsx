'use client'

import { useRef, useState, useTransition } from 'react'
import { sendOperatorEmail, validateQuotaAlert } from './actions'

type CommercialEvent = {
  id: string
  source_instance: string
  event_type: string
  tier_context: string | null
  sent_at: string
  sent_by: string
  actor_email: string | null
  email_template: string | null
  subject_preview: string | null
  body_text: string | null
  recipient_email: string | null
  delivery_status: string
  auto_send_after: string | null
  notes: string | null
  metadata: Record<string, unknown> | null
}

type ClientOption = {
  sourceInstance: string
  label: string
  tier: string
  recipientEmail: string | null
}

type Props = {
  pendingAlerts: CommercialEvent[]
  sentEmails: CommercialEvent[]
  clients: ClientOption[]
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function statusBadge(status: string) {
  if (status === 'sent') return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-500/10 text-green-700">Envoyé</span>
  if (status === 'pending_review') return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-500/10 text-amber-700">En attente</span>
  if (status === 'ignored') return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-500/10 text-slate-500">Ignoré</span>
  if (status === 'failed') return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-500/10 text-red-600">Echec</span>
  return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-500/10 text-slate-500">{status}</span>
}

// ── Alerte quota en attente de validation ──────────────────────────────────────
function AlertRow({ alert, clients }: { alert: CommercialEvent; clients: ClientOption[] }) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const client = clients.find((c) => c.sourceInstance === alert.source_instance)
  const autoSendLabel = alert.auto_send_after
    ? `Envoi auto ${formatDate(alert.auto_send_after)}`
    : 'Pas d\'envoi auto'

  function handle(action: 'send' | 'ignore') {
    setError(null)
    const fd = new FormData(formRef.current!)
    fd.set('alertId', alert.id)
    fd.set('action', action)
    startTransition(async () => {
      try {
        await validateQuotaAlert(fd)
        setOpen(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur')
      }
    })
  }

  return (
    <div className="card px-5 py-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {statusBadge(alert.delivery_status)}
            <span className="text-xs text-secondary font-body">{autoSendLabel}</span>
          </div>
          <p className="mt-1 text-sm font-medium text-primary font-body truncate">{alert.subject_preview}</p>
          <p className="text-xs text-secondary font-body">{client?.label ?? alert.source_instance} — {alert.tier_context}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 text-xs text-accent font-body hover:underline"
        >
          {open ? 'Fermer' : 'Voir / agir'}
        </button>
      </div>

      {open && (
        <form ref={formRef} className="space-y-3 border-t border-border pt-3">
          <div>
            <label className="block text-xs font-bold text-secondary font-display uppercase tracking-wider mb-1">Sujet</label>
            <input
              name="subject"
              defaultValue={alert.subject_preview ?? ''}
              className="w-full input-glass px-3 py-2 text-sm text-primary font-body outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-secondary font-display uppercase tracking-wider mb-1">Corps du message</label>
            <textarea
              name="bodyText"
              rows={6}
              defaultValue={alert.body_text ?? ''}
              className="w-full input-glass px-3 py-2 text-sm text-primary font-body outline-none resize-y"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-secondary font-display uppercase tracking-wider mb-1">Email destinataire</label>
            <input
              name="recipientEmail"
              type="email"
              defaultValue={client?.recipientEmail ?? ''}
              placeholder="client@exemple.fr"
              className="w-full input-glass px-3 py-2 text-sm text-primary font-body outline-none"
            />
          </div>
          {error && <p className="text-xs text-red-600 font-body">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => handle('send')}
              className="btn-primary px-4 py-2 text-xs"
            >
              {isPending ? 'Envoi...' : 'Envoyer maintenant'}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => handle('ignore')}
              className="btn-ghost px-4 py-2 text-xs"
            >
              Ignorer
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

// ── Formulaire de composition libre ───────────────────────────────────────────
function ComposeForm({ clients }: { clients: ClientOption[] }) {
  const [isPending, startTransition] = useTransition()
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedClients, setSelectedClients] = useState<string[]>([])
  const formRef = useRef<HTMLFormElement>(null)

  function toggleClient(sourceInstance: string) {
    setSelectedClients((prev) =>
      prev.includes(sourceInstance)
        ? prev.filter((s) => s !== sourceInstance)
        : [...prev, sourceInstance]
    )
  }

  function selectAll() {
    setSelectedClients(clients.map((c) => c.sourceInstance))
  }

  function clearAll() {
    setSelectedClients([])
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    const fd = new FormData(formRef.current!)

    // Récupérer les emails des clients sélectionnés
    const emails = selectedClients
      .map((si) => clients.find((c) => c.sourceInstance === si)?.recipientEmail)
      .filter((e): e is string => !!e)

    // Ajouter l'email libre si saisi
    const freeEmail = String(fd.get('freeEmail') ?? '').trim()
    if (freeEmail) emails.push(freeEmail)

    fd.set('recipientEmails', emails.join('\n'))
    fd.set('sourceInstance', selectedClients.length === 1 ? selectedClients[0] : 'cockpit-broadcast')

    startTransition(async () => {
      try {
        await sendOperatorEmail(fd)
        setSuccess(true)
        formRef.current?.reset()
        setSelectedClients([])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur')
      }
    })
  }

  return (
    <form ref={formRef} onSubmit={submit} className="card px-6 py-5 space-y-4">
      <h3 className="text-sm font-bold text-primary font-display uppercase tracking-wider">Composer un email</h3>

      {/* Sélection clients */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-bold text-secondary font-display uppercase tracking-wider">Destinataires</label>
          <div className="flex gap-2">
            <button type="button" onClick={selectAll} className="text-xs text-accent font-body hover:underline">Tous</button>
            <button type="button" onClick={clearAll} className="text-xs text-secondary font-body hover:underline">Aucun</button>
          </div>
        </div>
        <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
          {clients.map((client) => (
            <label key={client.sourceInstance} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedClients.includes(client.sourceInstance)}
                onChange={() => toggleClient(client.sourceInstance)}
                className="rounded"
              />
              <span className="text-sm text-primary font-body">{client.label}</span>
              {client.recipientEmail
                ? <span className="text-xs text-secondary font-body">({client.recipientEmail})</span>
                : <span className="text-xs text-red-500 font-body">pas d'email</span>
              }
            </label>
          ))}
        </div>
      </div>

      {/* Email libre en plus */}
      <div>
        <label className="block text-xs font-bold text-secondary font-display uppercase tracking-wider mb-1">Email(s) libre(s)</label>
        <input
          name="freeEmail"
          type="text"
          placeholder="autre@exemple.fr, prospect@exemple.fr"
          className="w-full input-glass px-3 py-2 text-sm text-primary font-body outline-none"
        />
        <p className="mt-1 text-xs text-secondary font-body">Séparés par virgule — s'ajoute aux clients cochés</p>
      </div>

      <div>
        <label className="block text-xs font-bold text-secondary font-display uppercase tracking-wider mb-1">Sujet</label>
        <input
          name="subject"
          required
          className="w-full input-glass px-3 py-2 text-sm text-primary font-body outline-none"
        />
      </div>

      <div>
        <label className="block text-xs font-bold text-secondary font-display uppercase tracking-wider mb-1">Corps du message</label>
        <textarea
          name="bodyText"
          rows={8}
          required
          placeholder={"Bonjour,\n\n..."}
          className="w-full input-glass px-3 py-2 text-sm text-primary font-body outline-none resize-y"
        />
        <p className="mt-1 text-xs text-secondary font-body">Chaque destinataire recoit son propre email individuel.</p>
      </div>

      <div>
        <label className="block text-xs font-bold text-secondary font-display uppercase tracking-wider mb-1">Notes internes (non envoyees)</label>
        <input
          name="notes"
          placeholder="Contexte, campagne..."
          className="w-full input-glass px-3 py-2 text-sm text-primary font-body outline-none"
        />
      </div>

      {error && <p className="text-xs text-red-600 font-body">{error}</p>}
      {success && <p className="text-xs text-green-600 font-body">Email(s) envoye(s).</p>}

      <button
        type="submit"
        disabled={isPending}
        className="btn-primary px-5 py-2 text-sm"
      >
        {isPending ? 'Envoi en cours...' : 'Envoyer'}
      </button>
    </form>
  )
}

// ── Vue principale ─────────────────────────────────────────────────────────────
export default function EmailsTab({ pendingAlerts, sentEmails, clients }: Props) {
  const [activeTab, setActiveTab] = useState<'alerts' | 'sent' | 'compose'>('alerts')

  const tabCls = (tab: typeof activeTab) =>
    `px-4 py-2 text-xs font-bold font-display uppercase tracking-wider rounded-lg transition-colors ${
      activeTab === tab
        ? 'bg-accent text-white'
        : 'text-secondary hover:text-primary'
    }`

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-bold text-primary">Emails</h2>
        {pendingAlerts.length > 0 && (
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-white text-xs font-bold">
            {pendingAlerts.length}
          </span>
        )}
      </div>

      <div className="flex gap-2">
        <button type="button" className={tabCls('alerts')} onClick={() => setActiveTab('alerts')}>
          En attente {pendingAlerts.length > 0 && `(${pendingAlerts.length})`}
        </button>
        <button type="button" className={tabCls('sent')} onClick={() => setActiveTab('sent')}>
          Historique
        </button>
        <button type="button" className={tabCls('compose')} onClick={() => setActiveTab('compose')}>
          Composer
        </button>
      </div>

      {activeTab === 'alerts' && (
        <div className="space-y-3">
          {pendingAlerts.length === 0 && (
            <p className="text-sm text-secondary font-body">Aucune alerte en attente de validation.</p>
          )}
          {pendingAlerts.map((alert) => (
            <AlertRow key={alert.id} alert={alert} clients={clients} />
          ))}
        </div>
      )}

      {activeTab === 'sent' && (
        <div className="space-y-3">
          {sentEmails.length === 0 && (
            <p className="text-sm text-secondary font-body">Aucun email envoye pour le moment.</p>
          )}
          {sentEmails.map((email) => (
            <div key={email.id} className="card px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {statusBadge(email.delivery_status)}
                    <span className="text-xs text-secondary font-body">{formatDate(email.sent_at)}</span>
                    {email.recipient_email && (
                      <span className="text-xs text-secondary font-body">→ {email.recipient_email}</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm font-medium text-primary font-body">{email.subject_preview}</p>
                  <p className="text-xs text-secondary font-body">{email.source_instance} — {email.actor_email}</p>
                </div>
              </div>
              {email.body_text && (
                <details className="mt-2">
                  <summary className="text-xs text-accent font-body cursor-pointer hover:underline">Voir le corps</summary>
                  <pre className="mt-2 text-xs text-secondary font-body whitespace-pre-wrap bg-surface rounded p-3">{email.body_text}</pre>
                </details>
              )}
            </div>
          ))}
        </div>
      )}

      {activeTab === 'compose' && (
        <ComposeForm clients={clients} />
      )}
    </section>
  )
}
