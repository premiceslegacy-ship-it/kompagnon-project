'use client'

import React, {
  useState, useRef, useEffect, useCallback, createContext, useContext,
} from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  Send, Mic, MicOff, X, Eye, ChevronDown,
  AlertCircle, CheckCircle2, ExternalLink, Zap, ChevronRight, PhoneOff,
  Paperclip, FileText, ImageIcon,
} from 'lucide-react'
import type { NotificationsSummary } from '@/lib/data/queries/notifications'
import { useSarahVoice } from './useSarahVoice'
import type { VoiceLiveState, VoiceLiveError } from './useSarahVoice'

const UPGRADE_URL = process.env.NEXT_PUBLIC_STRIPE_UPGRADE_URL ?? 'https://orsayn.fr/tarifs'

// ─── Context ──────────────────────────────────────────────────────────────────

type SarahCtxValue = { open: () => void; close: () => void; isOpen: boolean }
const SarahCtx = createContext<SarahCtxValue>({ open: () => {}, close: () => {}, isOpen: false })
export function useSarah() { return useContext(SarahCtx) }

// ─── Types ────────────────────────────────────────────────────────────────────

type Role = 'user' | 'sarah'

type ActionProposal = {
  proposalId?: string
  type: string
  label: string
  description: string
  risk: 'low' | 'medium' | 'high'
  confirmed?: boolean
  deepLink?: string | null
  payload?: Record<string, unknown>
}

type Message = {
  id: string
  role: Role
  content: string
  timestamp: Date
  action?: ActionProposal
  errorCode?: SarahErrorCode
}

type SarahErrorCode =
  | 'module_disabled'
  | 'quota_exceeded'
  | 'openrouter_credits'
  | 'rate_limit'
  | 'server_error'
  | 'unauthenticated'
  | 'permission_denied'
  | 'network'

type PageContext = {
  label: string
  context: {
    type: string
    id?: string
    title?: string
    name?: string
    clientName?: string
    reference?: string
    [key: string]: unknown
  } | null
}

type SarahAlerts = Partial<NotificationsSummary> & { total?: number }

// Pièce jointe en attente d'envoi dans le chat (image ou PDF, max ~6 Mo)
type PendingAttachment = { name: string; mimeType: string; dataUrl: string }

const ATTACHMENT_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf'
const ATTACHMENT_MAX_BYTES = 6 * 1024 * 1024

type PersistedSarahAction = {
  id: string
  type: string
  risk: 'low' | 'medium' | 'high'
  title: string
  description: string
  payload: Record<string, unknown>
  deep_link: string | null
  created_at: string
}

// ─── Constantes de layout ─────────────────────────────────────────────────────

const BTN = 52
const PEEK = 14
const SNAP_KEY   = 'sarah_snap'
const HIDDEN_KEY = 'sarah_hidden'
const ALERTS_SEEN_KEY = 'sarah_alerts_seen_signature'

function isClient() { return typeof window !== 'undefined' }

function defaultSnap(): 'left' | 'right' {
  if (!isClient()) return 'right'
  const raw = localStorage.getItem(SNAP_KEY)
  return raw === 'left' ? 'left' : 'right'
}

// ─── Labels avec article ──────────────────────────────────────────────────────

const LABELS_WITH_ARTICLE: Record<string, string> = {
  'Tableau de bord': 'le Tableau de bord',
  'Chantiers': 'les Chantiers',
  'Planning global': 'le Planning global',
  'Entretien & maintenance': "l'Entretien & maintenance",
  'Finances': 'les Finances',
  'Clients': 'les Clients',
  'Atelier IA': "l'Atelier IA",
  'Rapports': 'les Rapports',
  'Paramètres': 'les Paramètres',
  'Editeur de devis': "l'Editeur de devis",
  'Editeur de facture': "l'Editeur de facture",
  'Factures récurrentes': 'les Factures récurrentes',
}

function withArticle(label: string): string {
  return LABELS_WITH_ARTICLE[label] ?? label
}

// ─── Greeting ─────────────────────────────────────────────────────────────────

function firstName(full: string | null) { return full?.split(' ')[0] ?? null }

function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralLabel : singular}`
}

function fmtCurrency(value: number | string | null | undefined): string | null {
  if (value == null) return null
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return null
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n)
}

function buildAlertLines(alerts: SarahAlerts | null | undefined): string[] {
  if (!alerts) return []
  if (alerts.sarahAlertLines?.length) return alerts.sarahAlertLines
  const lines: string[] = []

  if ((alerts.overdueInvoices ?? 0) > 0) lines.push(`${plural(alerts.overdueInvoices ?? 0, 'facture')} en retard de paiement.`)
  if ((alerts.invoiceFollowups ?? 0) > 0) lines.push(`${plural(alerts.invoiceFollowups ?? 0, 'facture')} sans échéance à relancer.`)
  if ((alerts.pendingQuotes ?? 0) > 0) lines.push(`${plural(alerts.pendingQuotes ?? 0, 'devis')} à relancer.`)
  if ((alerts.pendingRecurring ?? 0) > 0) lines.push(`${plural(alerts.pendingRecurring ?? 0, 'facture récurrente')} à confirmer.`)
  if ((alerts.recurringReady ?? 0) > 0) lines.push(`${plural(alerts.recurringReady ?? 0, 'facture récurrente')} prête à préparer.`)
  if ((alerts.chantierPeriodDrafts ?? 0) > 0) lines.push(`${plural(alerts.chantierPeriodDrafts ?? 0, 'facture de chantier')} à valider.`)
  if ((alerts.recentAutoReminders ?? 0) > 0) lines.push(`${plural(alerts.recentAutoReminders ?? 0, 'relance automatique')} envoyée récemment.`)
  if ((alerts.dueTasks ?? 0) > 0) lines.push(`${plural(alerts.dueTasks ?? 0, 'tâche chantier')} à échéance.`)
  if ((alerts.planningToday ?? 0) > 0) lines.push(`${plural(alerts.planningToday ?? 0, 'créneau planning', 'créneaux planning')} prévu aujourd'hui.`)
  if ((alerts.missingPointages ?? 0) > 0) lines.push(`${plural(alerts.missingPointages ?? 0, 'pointage')} à vérifier.`)
  if ((alerts.completedTasks ?? 0) > 0) lines.push(`${plural(alerts.completedTasks ?? 0, 'tâche chantier')} terminée récemment.`)
  if ((alerts.newRequests ?? 0) > 0) lines.push(`${plural(alerts.newRequests ?? 0, 'nouvelle demande', 'nouvelles demandes')} de devis à traiter.`)
  if ((alerts.chantiersAtRisk ?? 0) > 0) lines.push(`${plural(alerts.chantiersAtRisk ?? 0, 'chantier')} en alerte budget.`)
  if ((alerts.maintenanceDue ?? 0) > 0) lines.push(`${plural(alerts.maintenanceDue ?? 0, 'intervention maintenance')} à réaliser.`)
  if ((alerts.maintenanceBillingPending ?? 0) > 0) lines.push(`${plural(alerts.maintenanceBillingPending ?? 0, 'intervention maintenance')} à facturer.`)
  if (alerts.dailyBriefPending) lines.push('Le brief du jour est disponible.')

  return lines
}

function buildAlertSignature(alerts: SarahAlerts | null | undefined, fallbackCount: number): string {
  if (!alerts) return `count:${fallbackCount}`
  return [
    alerts.total ?? fallbackCount,
    alerts.overdueInvoices ?? 0,
    alerts.invoiceFollowups ?? 0,
    alerts.pendingQuotes ?? 0,
    alerts.pendingRecurring ?? 0,
    alerts.recurringReady ?? 0,
    alerts.chantierPeriodDrafts ?? 0,
    alerts.recentAutoReminders ?? 0,
    alerts.dueTasks ?? 0,
    alerts.planningToday ?? 0,
    alerts.missingPointages ?? 0,
    alerts.completedTasks ?? 0,
    alerts.newRequests ?? 0,
    alerts.chantiersAtRisk ?? 0,
    alerts.maintenanceDue ?? 0,
    alerts.maintenanceBillingPending ?? 0,
    alerts.dailyBriefPending ? 1 : 0,
    ...(alerts.sarahAlertLines ?? []),
  ].join(':')
}

function actionFromPersisted(row: PersistedSarahAction): ActionProposal {
  return {
    proposalId: row.id,
    type: row.type,
    label: row.title,
    description: row.description,
    risk: row.risk,
    deepLink: row.deep_link,
    payload: {
      ...(row.payload ?? {}),
      deep_link: row.deep_link,
    },
  }
}

function buildGreeting(ctx: PageContext, userName: string | null, alertCount: number, alerts?: SarahAlerts | null): string {
  const prenom = firstName(userName)
  const salut  = prenom ? `Bonjour ${prenom}.` : 'Bonjour.'

  if (!ctx.context) {
    const alertLines = buildAlertLines(alerts)
    const urgence = alertCount > 0
      ? alertLines.length > 0
        ? ` J'ai un point précis à vous signaler :\n\n${alertLines.map(line => `- ${line}`).join('\n')}`
        : ' Je regarde vos alertes du jour et je vous détaille ça.'
      : ' Posez-moi une question ou demandez-moi d\'effectuer une action.'
    return `${salut} Je suis Sarah, votre assistante.\n\nVous êtes sur ${withArticle(ctx.label)}.${urgence}`
  }

  const { type, title, name, clientName, reference, status, totalTtc, clientType } = ctx.context
  if (type === 'chantier') {
    const who = clientName ? `, client ${clientName}` : ''
    const state = status ? ` (statut ${status})` : ''
    return `${salut} Chantier "${title}"${who}${state}.\n\nJe peux vous dire ce qui a été fait, ce qui est prévu, les tâches, le planning et les factures liées.`
  }
  if (type === 'client') {
    const kind = clientType ? ` (${clientType})` : ''
    return `${salut} Fiche client : ${name ?? 'inconnu'}${kind}.\n\nJe peux lister ses devis, ses factures, ses chantiers et l'historique utile.`
  }
  if (type === 'quote') {
    const amount = fmtCurrency(typeof totalTtc === 'string' || typeof totalTtc === 'number' ? totalTtc : null)
    const state = status ? `, statut ${status}` : ''
    const total = amount ? `, ${amount}` : ''
    return `${salut} Devis ${reference ?? ''}${clientName ? ` pour ${clientName}` : ''}${state}${total}.\n\nJe peux analyser le contenu, les lignes, la marge ou préparer l'envoi.`
  }
  if (type === 'invoice') {
    const amount = fmtCurrency(typeof totalTtc === 'string' || typeof totalTtc === 'number' ? totalTtc : null)
    const state = status ? `, statut ${status}` : ''
    const total = amount ? `, ${amount}` : ''
    return `${salut} Facture ${reference ?? ''}${clientName ? ` pour ${clientName}` : ''}${state}${total}.\n\nJe peux vérifier l'échéance, les paiements reçus et préparer une relance.`
  }
  return `${salut} Je suis Sarah, votre assistante.\n\nVous êtes sur ${withArticle(ctx.label)}. Posez-moi une question ou demandez-moi d'effectuer une action.`
}

// ─── Exécution réelle des actions ─────────────────────────────────────────────

type ActionResult = { message: string; deepLink?: string | null }

async function executeAction(action: ActionProposal): Promise<ActionResult> {
  if (action.proposalId) {
    // La confirmation est idempotente côté serveur : un retry après une coupure
    // réseau ne recrée pas de second devis/facture. On réessaie donc plutôt que
    // de conclure à tort à un échec alors que l'action a pu aboutir.
    let lastNetworkError = false
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`/api/sarah/actions/${action.proposalId}/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
        const data = await res.json().catch(() => ({}))
        const deepLink = (data.deepLink ?? data.deep_link ?? action.deepLink ?? action.payload?.deep_link) as string | undefined
        const message = (data.message as string | undefined)
          ?? (res.ok ? 'Action confirmée.' : 'Impossible de confirmer cette action.')
        return { message, deepLink: res.ok ? deepLink ?? null : null }
      } catch {
        lastNetworkError = true
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 600 * (attempt + 1)))
      }
    }
    if (lastNetworkError) {
      return { message: "La connexion a été interrompue. Si l'action s'est terminée côté serveur, elle apparaîtra dans la liste — ne la relancez pas pour éviter un doublon." }
    }
    return { message: 'Impossible de confirmer cette action pour le moment.' }
  }

  try {
    const res = await fetch('/api/sarah/actions/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: action.type,
        title: action.label,
        description: action.description,
        risk: action.risk,
        payload: action.payload ?? {},
        deepLink: action.deepLink ?? action.payload?.deep_link ?? null,
      }),
    })
    const data = await res.json().catch(() => ({}))
    const deepLink = (data.deepLink ?? data.deep_link ?? action.deepLink ?? action.payload?.deep_link) as string | undefined
    const message = (data.message as string | undefined)
      ?? (res.ok ? 'Action confirmée.' : 'Impossible de confirmer cette action.')
    return { message, deepLink: res.ok ? deepLink ?? null : null }
  } catch {
    // Les anciens endpoints restent en filet de secours pour les installations partielles.
  }

  return { message: await executeLegacyAction(action) }
}

// Filet de secours pour les installations sans table de propositions persistantes.
// La redirection y reste gérée par window.location (cas marginal).
async function executeLegacyAction(action: ActionProposal): Promise<string> {
  const p = action.payload ?? {}

  switch (action.type) {
    case 'task_complete': {
      if (!p.tache_id) return 'Identifiant de tâche manquant.'
      const res = await fetch(`/api/sarah/actions/task-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tache_id: p.tache_id }),
      })
      return res.ok ? 'La tâche a bien été marquée comme terminée.' : 'Impossible de mettre à jour la tâche.'
    }

    case 'invoice_reminder': {
      // On retourne le brouillon de relance pour que l'utilisateur le voie
      const draft = p.draft_text as string | undefined
      return draft
        ? `Voici le brouillon de relance :\n\n${draft}\n\nConfirmez pour l'enregistrer ou modifiez-le avant envoi.`
        : 'Le brouillon de relance n\'a pas pu être généré.'
    }

    case 'brief_chloe': {
      // Stocke le brief dans sessionStorage pour que Chloé le récupère à l'ouverture
      if (isClient()) {
        sessionStorage.setItem('sarah_brief_chloe', JSON.stringify({
          client_name: p.client_name,
          client_id: p.client_id,
          description: p.description,
          items: p.items,
          conditions: p.conditions,
          created_at: new Date().toISOString(),
        }))
      }
      return `Le brief a été transmis à Chloé. Ouvrez l'éditeur de devis — elle aura toutes les informations pour démarrer directement.`
    }

    case 'open_url':
    case 'open_quote_editor': {
      const url = (p.url ?? p.redirect_url) as string | undefined
      if (url && isClient()) {
        setTimeout(() => window.location.href = url, 400)
        return `Je vous redirige${p.label ? ` vers ${p.label}` : ''}...`
      }
      return 'Impossible de rediriger : URL manquante.'
    }

    case 'draft_email': {
      const body = p.body as string | undefined
      return body
        ? `Voici le message préparé :\n\n${body}\n\nCopiez-le ou demandez-moi de l'adapter.`
        : 'Le brouillon n\'a pas pu être généré.'
    }

    case 'planning_create': {
      const res = await fetch('/api/sarah/actions/planning-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chantierId: p.chantierId,
          plannedDate: p.plannedDate,
          startTime: p.startTime ?? null,
          endTime: p.endTime ?? null,
          label: p.label ?? p.memberName ?? p.equipeName ?? 'Équipe',
          teamSize: p.teamSize ?? 1,
          notes: p.notes ?? null,
          memberId: p.memberId ?? null,
          equipeId: p.equipeId ?? null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        return `Impossible de créer le créneau : ${(data as any).error ?? 'erreur inconnue'}.`
      }
      const who = (p.memberName ?? p.equipeName) as string | undefined
      const when = p.startTime ? `le ${p.plannedDate} à ${p.startTime}` : `le ${p.plannedDate}`
      return `Le créneau a été créé pour "${p.chantierTitle}"${who ? `, avec ${who},` : ''} ${when}.`
    }

    case 'planning_update': {
      const res = await fetch('/api/sarah/actions/planning-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slotId: p.slotId,
          ...(p.plannedDate !== undefined && { plannedDate: p.plannedDate }),
          ...(p.startTime !== undefined && { startTime: p.startTime }),
          ...(p.endTime !== undefined && { endTime: p.endTime }),
          ...(p.label !== undefined && { label: p.label }),
          ...(p.teamSize !== undefined && { teamSize: p.teamSize }),
          ...(p.notes !== undefined && { notes: p.notes }),
          ...(p.memberId !== undefined && { memberId: p.memberId }),
          ...(p.equipeId !== undefined && { equipeId: p.equipeId }),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        return `Impossible de modifier le créneau : ${(data as any).error ?? 'erreur inconnue'}.`
      }
      return `Le créneau "${p.slotLabel ?? p.slotId}" a bien été mis à jour.`
    }

    case 'planning_delete': {
      const res = await fetch('/api/sarah/actions/planning-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId: p.slotId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        return `Impossible de supprimer le créneau : ${(data as any).error ?? 'erreur inconnue'}.`
      }
      return `Le créneau du ${p.plannedDate} pour "${p.chantierTitle}" a été supprimé.`
    }

    default:
      return 'Action non disponible : la table des actions Sarah n’est pas installée et aucun exécuteur direct ne correspond.'
  }
}

// ─── Textes des erreurs ───────────────────────────────────────────────────────

function errorContent(code: SarahErrorCode): { title: string; body: string; upgrade: boolean } {
  switch (code) {
    case 'module_disabled':
      return { title: 'Fonctionnalité non incluse', body: "Sarah est disponible à partir de l'abonnement Pro.", upgrade: true }
    case 'quota_exceeded':
      return { title: 'Quota mensuel atteint', body: "Vous avez atteint la limite de messages IA ce mois-ci.", upgrade: true }
    case 'openrouter_credits':
      return { title: 'Crédits OpenRouter à vérifier', body: "Rechargez vos crédits ou vérifiez votre clé OpenRouter.", upgrade: false }
    case 'rate_limit':
      return { title: 'Trop de requêtes', body: 'Attendez quelques secondes avant de réessayer.', upgrade: false }
    case 'unauthenticated':
      return { title: 'Session expirée', body: 'Rechargez la page pour vous reconnecter.', upgrade: false }
    case 'permission_denied':
      return { title: 'Accès non autorisé', body: "Votre rôle n'a pas accès aux assistants IA. Demandez à l'administrateur de vous attribuer la permission dans Paramètres > Rôles.", upgrade: false }
    case 'network':
      return { title: 'Problème réseau', body: 'Vérifiez votre connexion puis réessayez.', upgrade: false }
    default:
      return { title: 'Erreur inattendue', body: 'Si le problème persiste, contactez le support.', upgrade: false }
  }
}

// ─── Composant erreur inline ──────────────────────────────────────────────────

function ErrorBanner({ code }: { code: SarahErrorCode }) {
  const { title, body, upgrade } = errorContent(code)
  return (
    <div className="mx-4 my-2 rounded-2xl p-4 flex flex-col gap-2.5 border"
      style={{
        background: upgrade ? 'linear-gradient(135deg, rgba(255,159,28,0.08), rgba(255,159,28,0.04))' : 'rgba(239,68,68,0.06)',
        borderColor: upgrade ? 'rgba(255,159,28,0.25)' : 'rgba(239,68,68,0.2)',
      }}>
      <div className="flex items-start gap-2">
        {upgrade ? <Zap size={14} className="mt-0.5 flex-shrink-0 text-accent" /> : <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-danger" />}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold mb-0.5" style={{ color: upgrade ? 'rgb(var(--accent-primary))' : 'rgb(var(--danger))' }}>{title}</p>
          <p className="text-xs leading-relaxed opacity-70">{body}</p>
        </div>
      </div>
      {upgrade && (
        <a href={UPGRADE_URL} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 py-2 px-4 rounded-xl text-xs font-bold transition-all hover:brightness-110 active:scale-95 text-black"
          style={{ background: 'rgb(var(--accent-primary))' }}>
          Voir les offres <ExternalLink size={11} />
        </a>
      )}
    </div>
  )
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function SarahAvatar({ size = 40, pulse = false }: { size?: number; pulse?: boolean }) {
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      {pulse && (
        <span className="absolute inset-0 rounded-full animate-ping"
          style={{ background: 'rgb(var(--accent-primary) / 0.35)', animationDuration: '1.4s' }} />
      )}
      <div className="w-full h-full rounded-full overflow-hidden" style={{
        background: '#1a1008',
        boxShadow: 'inset 0 1.5px 0 rgba(255,255,255,0.35), 0 2px 8px rgba(0,0,0,0.35), 0 0 0 2px rgba(255,159,28,0.45)',
      }}>
        <img src="/brand/sarah-avatar.webp" alt="" width={size} height={size}
          className="block object-cover w-full h-full" draggable={false} />
      </div>
    </div>
  )
}

// ─── Carte d'action ───────────────────────────────────────────────────────────

function ActionCard({ action, onConfirm, onReject }: {
  action: ActionProposal; onConfirm: () => void; onReject: () => void
}) {
  const cfg = {
    low:    { border: 'rgba(16,185,129,0.3)',  bg: 'rgba(16,185,129,0.06)',  label: 'Simple',       color: 'rgb(16,185,129)' },
    medium: { border: 'rgba(249,115,22,0.3)',  bg: 'rgba(249,115,22,0.06)',  label: 'Confirmation', color: 'rgb(249,115,22)' },
    high:   { border: 'rgba(239,68,68,0.3)',   bg: 'rgba(239,68,68,0.06)',   label: 'Sensible',     color: 'rgb(239,68,68)' },
  }[action.risk]

  if (action.confirmed !== undefined) {
    return (
      <div className="flex items-center gap-1.5 text-xs mt-2 opacity-50">
        {action.confirmed ? <><CheckCircle2 size={11} /><span>Effectué</span></> : <><X size={11} /><span>Annulé</span></>}
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-xl p-3 flex flex-col gap-3"
      style={{ border: `1px solid ${cfg.border}`, background: cfg.bg }}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold" style={{ color: cfg.color }}>{action.label}</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0"
          style={{ background: cfg.border, color: cfg.color }}>{cfg.label}</span>
      </div>
      <p className="text-xs leading-relaxed opacity-65">{action.description}</p>
      <div className="flex gap-2">
        <button onClick={onConfirm}
          className="flex-1 py-2 rounded-xl text-xs font-bold transition-all active:scale-95"
          style={{
            background: 'linear-gradient(to bottom, #ffb84d, rgb(255,159,28))',
            color: '#050505',
            border: '1px solid rgba(255,255,255,0.15)',
            boxShadow: 'inset 0 1.5px 0 rgba(255,255,255,0.45), 0 3px 0 0 #b45309, 0 3px 0 1px rgba(120,53,15,0.12), 0 6px 12px rgba(180,83,9,0.2)',
          }}>
          Confirmer
        </button>
        <button onClick={onReject}
          className="flex-1 py-2 rounded-xl text-xs font-medium transition-all active:scale-95"
          style={{
            background: 'var(--sarah-util-btn-bg)',
            border: '1px solid var(--sarah-util-btn-border)',
            boxShadow: 'var(--sarah-util-btn-shadow)',
          }}>
          Annuler
        </button>
      </div>
    </div>
  )
}

// ─── Bulle de message ─────────────────────────────────────────────────────────

function Bubble({ msg, onConfirm, onReject }: {
  msg: Message; onConfirm: (id: string) => void; onReject: (id: string) => void
}) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
      {!isUser && <SarahAvatar size={26} />}
      <div className={`max-w-[82%] flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
        <div className="px-3.5 py-2.5 text-sm leading-relaxed"
          style={isUser ? {
            background: 'rgb(var(--accent-primary))',
            color: '#000',
            borderRadius: '18px 4px 18px 18px',
            fontWeight: 500,
            boxShadow: '0 2px 8px rgba(255,159,28,0.25)',
          } : {
            background: 'var(--bubble-sarah-bg)',
            border: '1px solid var(--bubble-sarah-border)',
            color: 'var(--bubble-sarah-color)',
            borderRadius: '4px 18px 18px 18px',
            boxShadow: 'var(--bubble-sarah-shadow)',
          }}>
          <p className="whitespace-pre-wrap">{msg.content}</p>
          {msg.action && (
            <ActionCard action={msg.action} onConfirm={() => onConfirm(msg.id)} onReject={() => onReject(msg.id)} />
          )}
        </div>
        <span className="text-[10px] mt-1 opacity-35 px-0.5">
          {msg.timestamp.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  )
}

// ─── Typing dots ──────────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div className="flex gap-2.5">
      <SarahAvatar size={26} />
      <div className="px-4 py-3 rounded-xl rounded-tl-sm flex items-center gap-1.5"
        style={{ background: 'var(--bubble-sarah-bg)', border: '1px solid var(--bubble-sarah-border)' }}>
        {[0, 1, 2].map(i => (
          <span key={i} className="w-1.5 h-1.5 rounded-full bg-accent block"
            style={{ animation: `sarahDot 1.2s ease-in-out ${i * 0.18}s infinite` }} />
        ))}
      </div>
    </div>
  )
}

// ─── Mode vocal ───────────────────────────────────────────────────────────────

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function voiceErrorLabel(err: VoiceLiveError): { title: string; body: string; upgrade: boolean } {
  switch (err) {
    case 'quota_exceeded':
      return { title: 'Quota vocal atteint', body: 'Vous avez utilisé toutes vos minutes ce mois-ci.', upgrade: true }
    case 'mic_denied':
      return { title: 'Microphone refusé', body: 'Autorisez l\'accès au microphone dans les réglages de votre navigateur.', upgrade: false }
    case 'permission_denied':
      return { title: 'Accès non autorisé', body: 'Votre rôle n\'a pas accès à Sarah vocale.', upgrade: false }
    case 'module_disabled':
      return { title: 'Fonctionnalité non incluse', body: 'Sarah vocale est disponible à partir de l\'abonnement Pro.', upgrade: true }
    case 'configuration':
      return { title: 'Configuration ElevenLabs', body: 'Vérifiez que l\'agent autorise le prompt en remplacement et que la voix est configurée directement dans ElevenLabs.', upgrade: false }
    case 'network':
      return { title: 'Problème de connexion', body: 'Vérifiez votre réseau puis réessayez.', upgrade: false }
    default:
      return { title: 'Erreur inattendue', body: 'Si le problème persiste, contactez le support.', upgrade: false }
  }
}

function VoiceScreen({ onBack, pageCtx, pathname, userName }: {
  onBack: () => void
  pageCtx: PageContext
  pathname: string
  userName: string | null
}) {
  const { voiceState, error, isMuted, elapsedSeconds, remainingMinutes, startSession, stopSession, toggleMute } = useSarahVoice({
    pageLabel: pageCtx.label,
    pathname,
    userName,
  })
  const autoStartedRef = useRef(false)

  const isActive = voiceState !== 'idle' && voiceState !== 'error'
  const isConnecting = voiceState === 'connecting' || voiceState === 'disconnecting'
  const isSpeaking = voiceState === 'speaking'

  const errInfo = error ? voiceErrorLabel(error) : null

  useEffect(() => {
    if (autoStartedRef.current) return
    autoStartedRef.current = true
    startSession()
  }, [startSession])

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 px-8 py-6">
      <div className="relative">
        <SarahAvatar size={88} pulse={isActive && !isConnecting} />
        {isActive && !isConnecting && <>
          <div className="absolute inset-0 rounded-full animate-ping opacity-10"
            style={{ background: 'rgb(var(--accent-primary))', animationDuration: '1.5s' }} />
          <div className="absolute inset-0 rounded-full animate-ping opacity-10"
            style={{ background: 'rgb(var(--accent-primary))', animationDuration: '2s', animationDelay: '0.4s' }} />
        </>}
      </div>

      {/* Ondes audio */}
      <div className="flex items-center gap-[3px]" style={{ height: 32 }}>
        {[0,1,2,3,4,5,6,7].map(i => (
          <div key={i} className="w-[3px] rounded-full transition-all"
            style={{
              background: isSpeaking ? 'rgb(var(--accent-primary))' : isActive ? 'currentColor' : 'currentColor',
              opacity: isActive && !isMuted ? 1 : 0.15,
              animation: isActive && !isMuted ? `sarahBar 0.65s ease-in-out ${i * 0.08}s infinite alternate` : 'none',
              height: isActive ? undefined : 3,
            }} />
        ))}
      </div>

      {/* Statut + timer */}
      <div className="text-center">
        <p className="text-sm font-medium">
          {voiceState === 'connecting'    ? 'Connexion en cours...'
          : voiceState === 'listening'    ? (isMuted ? 'Micro coupé' : 'Je vous écoute')
          : voiceState === 'speaking'     ? 'Je réponds'
          : voiceState === 'muted'        ? 'Micro coupé'
          : voiceState === 'disconnecting'? 'Déconnexion...'
          : voiceState === 'error'        ? 'Connexion interrompue'
          :                                 'Appuyez pour parler'}
        </p>
        {isActive && (
          <p className="text-xs opacity-40 mt-1 tabular-nums">
            {formatTimer(elapsedSeconds)}
            {remainingMinutes !== null && ` — ${remainingMinutes} min restantes`}
          </p>
        )}
        {!isActive && !error && (
          <p className="text-xs opacity-40 mt-1">Mode conversation en direct</p>
        )}
      </div>

      {/* Bannière erreur */}
      {errInfo && (
        <div className="w-full rounded-2xl p-3 flex flex-col gap-2 border"
          style={{
            background: errInfo.upgrade ? 'rgba(255,159,28,0.06)' : 'rgba(239,68,68,0.06)',
            borderColor: errInfo.upgrade ? 'rgba(255,159,28,0.25)' : 'rgba(239,68,68,0.2)',
          }}>
          <div className="flex items-start gap-2">
            {errInfo.upgrade
              ? <Zap size={13} className="mt-0.5 flex-shrink-0 text-accent" />
              : <AlertCircle size={13} className="mt-0.5 flex-shrink-0 text-danger" />}
            <div>
              <p className="text-xs font-semibold mb-0.5" style={{ color: errInfo.upgrade ? 'rgb(var(--accent-primary))' : 'rgb(var(--danger))' }}>{errInfo.title}</p>
              <p className="text-xs opacity-70 leading-relaxed">{errInfo.body}</p>
            </div>
          </div>
          {errInfo.upgrade && (
            <a href={UPGRADE_URL} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-xl text-xs font-bold text-black"
              style={{ background: 'rgb(var(--accent-primary))' }}>
              Voir les offres <ExternalLink size={10} />
            </a>
          )}
        </div>
      )}

      {/* Boutons */}
      <div className="flex items-center gap-4">
        {/* Couper micro — visible seulement si session active */}
        {isActive && (
          <button onClick={toggleMute} disabled={isConnecting}
            className="w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-90"
            style={{
              background: isMuted ? 'rgba(239,68,68,0.12)' : 'var(--sarah-util-btn-bg)',
              border: isMuted ? '1px solid rgba(239,68,68,0.3)' : '1px solid var(--sarah-util-btn-border)',
              boxShadow: 'var(--sarah-util-btn-shadow)',
            }}
            title={isMuted ? 'Réactiver le micro' : 'Couper le micro'}>
            {isMuted ? <MicOff size={18} className="text-danger" /> : <Mic size={18} />}
          </button>
        )}

        {/* Bouton principal démarrer / raccrocher */}
        <button
          onClick={isActive ? stopSession : startSession}
          disabled={isConnecting}
          className="w-[72px] h-[72px] rounded-full flex items-center justify-center transition-all active:scale-90 hover:scale-105 disabled:opacity-60 disabled:cursor-wait"
          style={isActive ? {
            background: 'linear-gradient(to bottom, #f87171, #ef4444)',
            border: '1px solid rgba(255,255,255,0.15)',
            boxShadow: 'inset 0 1.5px 0 rgba(255,255,255,0.3), 0 4px 0 0 #991b1b, 0 4px 0 1px rgba(127,29,29,0.14), 0 0 0 12px rgba(239,68,68,0.1), 0 8px 24px rgba(0,0,0,0.25)',
          } : {
            background: 'linear-gradient(to bottom, #ffb84d, rgb(255,159,28))',
            border: '1px solid rgba(255,255,255,0.15)',
            boxShadow: 'inset 0 1.5px 0 rgba(255,255,255,0.45), 0 4px 0 0 #b45309, 0 4px 0 1px rgba(120,53,15,0.12), 0 0 0 10px rgba(255,159,28,0.1), 0 8px 24px rgba(0,0,0,0.2)',
          }}>
          {isActive
            ? <PhoneOff size={26} color="#fff" style={{ filter: 'drop-shadow(0px 1px 0px rgba(127,29,29,0.55))' }} />
            : <Mic size={26} color="#000" style={{ filter: 'drop-shadow(0px 1px 0px rgba(255,255,255,0.24))' }} />
          }
        </button>
      </div>

      <button onClick={onBack} className="text-xs opacity-35 hover:opacity-60 transition-opacity underline underline-offset-2">
        Passer en mode texte
      </button>
    </div>
  )
}

// ─── Logique partagée d'un drawer (hook) ──────────────────────────────────────

function useDrawerLogic({
  pageCtx, pathname, userName, alertCount, alerts, autoBriefOnOpen, highlightedActionId,
}: {
  pageCtx: PageContext
  pathname: string
  userName: string | null
  alertCount: number
  alerts?: SarahAlerts | null
  autoBriefOnOpen: boolean
  highlightedActionId?: string | null
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input,    setInput]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [voiceMode, setVoiceMode] = useState(false)
  const [errorCode, setErrorCode] = useState<SarahErrorCode | null>(null)
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null)
  const historyRef = useRef<{ role: 'user' | 'sarah'; content: string }[]>([])
  const conversationIdRef = useRef(crypto.randomUUID())
  const briefSentRef = useRef(false)
  const welcomeSignatureRef = useRef('')
  const pendingActionsLoadedRef = useRef(false)
  const router = useRouter()

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)
  const autoBriefRef = useRef(autoBriefOnOpen)
  const alertCountRef = useRef(alertCount)
  const alertSignature = buildAlertSignature(alerts, alertCount)
  useEffect(() => { autoBriefRef.current = autoBriefOnOpen }, [autoBriefOnOpen])
  useEffect(() => { alertCountRef.current = alertCount }, [alertCount])

  const push = useCallback((msg: Omit<Message, 'id' | 'timestamp'>) => {
    setMessages(prev => [...prev, { ...msg, id: crypto.randomUUID(), timestamp: new Date() }])
  }, [])

  const sendRaw = useCallback(async (text: string, pendingAttachment?: PendingAttachment | null) => {
    if (!text || loading) return
    setInput('')
    setErrorCode(null)
    setAttachment(null)
    const displayText = pendingAttachment ? `${text}\n\nPièce jointe : ${pendingAttachment.name}` : text
    push({ role: 'user', content: displayText })
    const previousHistory = historyRef.current.slice(-10)
    historyRef.current = [...historyRef.current, { role: 'user', content: displayText }]
    setLoading(true)
    try {
      const res = await fetch('/api/ai/sarah-secretary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          page: pageCtx.label,
          pathname,
          pageContext: pageCtx.context,
          history: previousHistory,
          conversationId: conversationIdRef.current,
          ...(pendingAttachment ? { attachment: pendingAttachment } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setErrorCode((data.code ?? 'server_error') as SarahErrorCode); return }
      push({ role: 'sarah', content: data.reply, action: data.action ?? undefined })
      historyRef.current = [...historyRef.current, { role: 'sarah', content: data.reply }]
    } catch {
      setErrorCode('network')
    } finally {
      setLoading(false)
    }
  }, [loading, pathname, pageCtx, push])

  const send = useCallback((override?: string) => {
    const text = (override ?? input).trim()
    if (text) {
      sendRaw(text, attachment)
    } else if (attachment) {
      sendRaw('Voici un document, pouvez-vous l\'analyser ?', attachment)
    }
  }, [input, attachment, sendRaw])

  const onKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }, [send])

  const confirmAction = useCallback(async (id: string) => {
    const msg = messages.find(m => m.id === id)
    if (!msg?.action) return
    setMessages(p => p.map(m => m.id === id && m.action ? { ...m, action: { ...m.action, confirmed: true } } : m))
    const { message, deepLink } = await executeAction(msg.action)
    push({ role: 'sarah', content: message })
    // Navigation client Next (soft navigation) : plus fiable qu'un rechargement
    // complet, et fonctionne même si un chunk JS n'est pas préchargé.
    if (deepLink && deepLink.startsWith('/')) {
      setTimeout(() => router.push(deepLink), 350)
    }
  }, [messages, push, router])

  const rejectAction = useCallback((id: string) => {
    const msg = messages.find(m => m.id === id)
    if (msg?.action?.proposalId) {
      fetch(`/api/sarah/actions/${msg.action.proposalId}/dismiss`, { method: 'POST' }).catch(() => {})
    }
    setMessages(p => p.map(m => m.id === id && m.action ? { ...m, action: { ...m.action, confirmed: false } } : m))
    push({ role: 'sarah', content: 'Compris, action annulée.' })
  }, [messages, push])

  const loadPendingActions = useCallback((preferredActionId?: string | null) => {
    fetch('/api/sarah/actions')
      .then(r => r.json())
      .then(({ actions }: { actions?: PersistedSarahAction[] }) => {
        if (!actions?.length) return
        const targetId = preferredActionId ?? highlightedActionId
        const sorted = [...actions].sort((a, b) => {
          if (a.id === targetId) return -1
          if (b.id === targetId) return 1
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        })
        const selected = sorted.slice(0, targetId ? 6 : 4)
        setMessages(prev => {
          const seen = new Set(prev.map(m => m.action?.proposalId).filter(Boolean))
          const additions = selected
            .filter(action => !seen.has(action.id))
            .map(action => ({
              id: `proposal-${action.id}`,
              role: 'sarah' as const,
              content: action.id === targetId
                ? "Voici l'action que je vous proposais."
                : 'J’ai une action en attente qui peut vous aider.',
              timestamp: new Date(),
              action: actionFromPersisted(action),
            }))
          return additions.length ? [...prev, ...additions] : prev
        })
      })
      .catch(() => {})
  }, [highlightedActionId])

  // Greeting + brief auto si alertes
  useEffect(() => {
    const welcomeContent = buildGreeting(pageCtx, userName, alertCount, alerts)
    const signature = `${pageCtx.label}::${userName ?? ''}::${alertSignature}`
    const hasUserMessage = historyRef.current.some(entry => entry.role === 'user')
    if (hasUserMessage || welcomeSignatureRef.current === signature) return

    const welcome: Message = {
      id: 'welcome',
      role: 'sarah',
      content: welcomeContent,
      timestamp: new Date(),
    }

    welcomeSignatureRef.current = signature
    setErrorCode(null)

    setMessages(prev => {
      if (prev.length === 0) return [welcome]
      return [{ ...prev[0], ...welcome }, ...prev.slice(1)]
    })

    if (historyRef.current.length === 0) {
      historyRef.current = [{ role: 'sarah', content: welcome.content }]
    } else {
      historyRef.current = [
        { role: 'sarah', content: welcome.content },
        ...historyRef.current.slice(1),
      ]
    }

    if (autoBriefRef.current && alertCountRef.current > 0 && !briefSentRef.current) {
      const timer = setTimeout(() => {
        if (!briefSentRef.current && !historyRef.current.some(entry => entry.role === 'user')) {
          briefSentRef.current = true
          sendRaw('brief du jour')
        }
      }, 700)
      return () => clearTimeout(timer)
    }
  }, [alertCount, alertSignature, alerts, pageCtx, sendRaw, userName])

  useEffect(() => {
    if (pendingActionsLoadedRef.current) return
    pendingActionsLoadedRef.current = true
    loadPendingActions(highlightedActionId)
  }, [highlightedActionId, loadPendingActions])

  useEffect(() => {
    function onActionsUpdated(event: Event) {
      const actionId = event instanceof CustomEvent ? event.detail?.actionId as string | undefined : undefined
      loadPendingActions(actionId)
    }
    window.addEventListener('sarah-actions-updated', onActionsUpdated)
    return () => window.removeEventListener('sarah-actions-updated', onActionsUpdated)
  }, [loadPendingActions])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])
  useEffect(() => { if (!voiceMode) setTimeout(() => inputRef.current?.focus(), 120) }, [voiceMode])

  return {
    messages, input, setInput, loading, voiceMode, setVoiceMode,
    errorCode, bottomRef, inputRef,
    send, onKey, confirmAction, rejectAction,
    attachment, setAttachment,
  }
}

// ─── Contenu du panel ─────────────────────────────────────────────────────────

function PanelContent({ pageCtx, pathname, userName, loading, errorCode, messages, voiceMode,
  input, setInput, onKey, send, setVoiceMode, onClose, inputRef, bottomRef,
  confirmAction, rejectAction, attachment, setAttachment }: {
  pageCtx: PageContext
  pathname: string
  userName: string | null
  loading: boolean
  errorCode: SarahErrorCode | null
  messages: Message[]
  voiceMode: boolean
  input: string
  setInput: (v: string) => void
  onKey: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  send: (override?: string) => void
  setVoiceMode: (v: boolean) => void
  onClose: () => void
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  bottomRef: React.RefObject<HTMLDivElement | null>
  confirmAction: (id: string) => void
  rejectAction: (id: string) => void
  attachment: PendingAttachment | null
  setAttachment: (a: PendingAttachment | null) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)

  const onPickFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setAttachmentError(null)
    if (!ATTACHMENT_ACCEPT.split(',').includes(file.type)) {
      setAttachmentError('Format non pris en charge. Envoyez une image (JPG, PNG, WebP) ou un PDF.')
      return
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      setAttachmentError('Fichier trop volumineux : 6 Mo maximum.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : null
      if (dataUrl) setAttachment({ name: file.name, mimeType: file.type, dataUrl })
    }
    reader.onerror = () => setAttachmentError('Impossible de lire ce fichier.')
    reader.readAsDataURL(file)
  }, [setAttachment])

  // Auto-resize de la zone de saisie : la hauteur suit le contenu (jusqu'au
  // plafond CSS), pour qu'aucune ligne ne soit masquée en haut quand on tape.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [input, inputRef])

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
        style={{
          borderBottom: '1px solid var(--sarah-divider)',
          background: 'linear-gradient(to bottom, var(--sarah-header-top), var(--sarah-header-bot))',
        }}>
        <SarahAvatar size={38} pulse={loading} />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm leading-tight" style={{ color: 'var(--sarah-header-title, rgb(var(--accent-primary)))' }}>Sarah</p>
          <p className="text-[11px] leading-tight opacity-40 truncate">
            {loading ? 'En train de répondre...' : pageCtx.label}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setVoiceMode(!voiceMode)} className="p-2 rounded-xl transition-all"
            style={voiceMode
              ? { background: 'rgb(var(--accent-primary) / 0.12)', color: 'rgb(var(--accent-primary))' }
              : { opacity: 0.45 }}
            title="Mode vocal">
            <Mic size={15} style={{ filter: 'var(--sarah-icon-filter)' }} />
          </button>
          <button onClick={onClose} className="p-2 rounded-xl opacity-45 hover:opacity-80 transition-opacity">
            <ChevronDown size={16} style={{ filter: 'var(--sarah-icon-filter)' }} />
          </button>
        </div>
      </div>

      {voiceMode ? (
        <VoiceScreen onBack={() => setVoiceMode(false)} pageCtx={pageCtx} pathname={pathname} userName={userName} />
      ) : (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto py-4 space-y-4 min-h-0" style={{ paddingLeft: 16, paddingRight: 16 }}>
            {messages.map(m => (
              <Bubble key={m.id} msg={m} onConfirm={confirmAction} onReject={rejectAction} />
            ))}
            {loading && <TypingDots />}
            {errorCode && <ErrorBanner code={errorCode} />}
            <div ref={bottomRef} />
          </div>

          {/* Suggestions rapides */}
          <div className="flex gap-1.5 px-3 pb-1 overflow-x-auto flex-shrink-0 scrollbar-none">
            {['Brief du jour', 'Mes factures impayées', 'Planning aujourd\'hui', 'Créer un devis'].map(s => (
              <button key={s} onClick={() => send(s)}
                className="flex-shrink-0 text-[11px] px-2.5 py-1 rounded-full border transition-all hover:bg-accent/10 hover:border-accent/30 active:scale-95 whitespace-nowrap"
                style={{ borderColor: 'var(--sarah-divider)', color: 'inherit', opacity: 0.6 }}>
                {s}
              </button>
            ))}
          </div>

          {/* Zone saisie */}
          <div className="flex-shrink-0 px-3 pb-3 pt-1.5" style={{ borderTop: '1px solid var(--sarah-divider)' }}>
            {attachmentError && (
              <p className="text-[11px] px-1 pb-1.5" style={{ color: 'rgb(var(--danger))' }}>{attachmentError}</p>
            )}
            {attachment && (
              <div className="flex items-center gap-2 mb-1.5 px-2.5 py-1.5 rounded-xl"
                style={{
                  background: 'rgba(255,159,28,0.08)',
                  border: '1px solid rgba(255,159,28,0.25)',
                }}>
                {attachment.mimeType === 'application/pdf'
                  ? <FileText size={13} className="flex-shrink-0 text-accent" />
                  : attachment.dataUrl.startsWith('data:image')
                    ? <img src={attachment.dataUrl} alt="" className="w-6 h-6 rounded-md object-cover flex-shrink-0" />
                    : <ImageIcon size={13} className="flex-shrink-0 text-accent" />}
                <span className="flex-1 text-[11px] truncate opacity-75">{attachment.name}</span>
                <button onClick={() => setAttachment(null)}
                  className="p-1 rounded-lg opacity-45 hover:opacity-80 transition-opacity flex-shrink-0"
                  title="Retirer la pièce jointe">
                  <X size={11} style={{ filter: 'var(--sarah-icon-filter)' }} />
                </button>
              </div>
            )}
            <div className="flex items-center gap-2 rounded-2xl px-3.5 py-2.5"
              style={{
                background: 'var(--sarah-input-bg)',
                border: '1px solid var(--sarah-input-border)',
                boxShadow: 'var(--sarah-input-shadow)',
              }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={onKey}
                placeholder="Posez votre question ou donnez une instruction..."
                rows={1}
                disabled={loading}
                className="flex-1 bg-transparent resize-none outline-none text-sm leading-relaxed placeholder:opacity-40 self-center overflow-y-auto"
                style={{ minHeight: 24, maxHeight: 160, caretColor: 'rgb(var(--accent-primary))', color: 'inherit' }}
              />
              <div className="flex items-center gap-1 flex-shrink-0">
                <input ref={fileInputRef} type="file" accept={ATTACHMENT_ACCEPT} className="hidden" onChange={onPickFile} />
                <button onClick={() => fileInputRef.current?.click()} disabled={loading}
                  className="p-1.5 rounded-lg opacity-35 hover:opacity-70 transition-opacity"
                  title="Joindre une image ou un PDF">
                  <Paperclip size={14} style={{ filter: 'var(--sarah-icon-filter)' }} />
                </button>
                <button onClick={() => setVoiceMode(true)} className="p-1.5 rounded-lg opacity-35 hover:opacity-70 transition-opacity" title="Vocal">
                  <Mic size={14} style={{ filter: 'var(--sarah-icon-filter)' }} />
                </button>
                <button onClick={() => send()} disabled={(!input.trim() && !attachment) || loading}
                  className="p-1.5 rounded-lg transition-all disabled:opacity-20 text-accent hover:bg-accent/10 active:scale-90">
                  <Send size={14} style={{ filter: 'drop-shadow(0px 1px 0px rgba(255,255,255,0.24))' }} />
                </button>
              </div>
            </div>
            <p className="text-[10px] text-center mt-1.5 opacity-25 hidden sm:block select-none">
              Entrée pour envoyer · Maj+Entrée pour saut de ligne
            </p>
          </div>
        </>
      )}
    </>
  )
}

// ─── Drawer mobile ────────────────────────────────────────────────────────────

function SarahDrawerMobile({ onClose, pathname, pageCtx, userName, alertCount, alerts, autoBriefOnOpen, highlightedActionId }: {
  onClose: () => void; pathname: string; pageCtx: PageContext
  userName: string | null; alertCount: number; alerts?: SarahAlerts | null; autoBriefOnOpen: boolean; highlightedActionId?: string | null
}) {
  const logic = useDrawerLogic({ pageCtx, pathname, userName, alertCount, alerts, autoBriefOnOpen, highlightedActionId })
  const panelStyle: React.CSSProperties = {
    background: 'var(--sarah-panel-bg)',
    backdropFilter: 'blur(var(--sarah-panel-blur, 0px)) saturate(1.4)',
    WebkitBackdropFilter: 'blur(var(--sarah-panel-blur, 0px)) saturate(1.4)',
    border: '1px solid var(--sarah-panel-border)',
    boxShadow: 'var(--sarah-panel-shadow)',
    color: 'rgb(var(--text-primary))',
  }
  return (
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} style={{ background: 'rgba(0,0,0,0.4)' }} />
      <div className="fixed inset-x-0 bottom-0 z-[9999] flex flex-col overflow-hidden"
        style={{ ...panelStyle, height: '88dvh', borderRadius: '22px 22px 0 0', borderBottom: 'none' }}>
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-9 h-1 rounded-full" style={{ background: 'rgba(128,128,128,0.3)' }} />
        </div>
        <PanelContent pageCtx={pageCtx} pathname={pathname} userName={userName} onClose={onClose} {...logic} />
      </div>
    </>
  )
}

// ─── Drawer desktop ───────────────────────────────────────────────────────────

function SarahDrawerDesktop({ onClose, pathname, pageCtx, userName, snap, alertCount, alerts, autoBriefOnOpen, highlightedActionId, buttonPos }: {
  onClose: () => void; pathname: string; pageCtx: PageContext
  userName: string | null; snap: 'left' | 'right'; alertCount: number; alerts?: SarahAlerts | null; autoBriefOnOpen: boolean;
  highlightedActionId?: string | null;
  buttonPos: { x: number; y: number } | null
}) {
  const logic = useDrawerLogic({ pageCtx, pathname, userName, alertCount, alerts, autoBriefOnOpen, highlightedActionId })
  const isVoice = logic.voiceMode
  const PANEL_W = isVoice ? 460 : 400
  const PANEL_H = isVoice ? Math.min(700, window.innerHeight - 80) : Math.min(620, window.innerHeight - 80)
  
  const isRightHalf = buttonPos
    ? (buttonPos.x + BTN / 2 > window.innerWidth / 2)
    : (snap === 'right')

  const panelStyle: React.CSSProperties = {
    background: 'var(--sarah-panel-bg)',
    backdropFilter: 'blur(var(--sarah-panel-blur, 0px)) saturate(1.4)',
    WebkitBackdropFilter: 'blur(var(--sarah-panel-blur, 0px)) saturate(1.4)',
    border: '1px solid var(--sarah-panel-border)',
    boxShadow: 'var(--sarah-panel-shadow)',
    color: 'rgb(var(--text-primary))',
    transition: 'width 0.35s cubic-bezier(0.34,1.56,0.64,1), height 0.35s cubic-bezier(0.34,1.56,0.64,1), right 0.35s ease, left 0.35s ease',
    width: PANEL_W,
    height: PANEL_H,
    bottom: 20,
    ...(isRightHalf
      ? { right: buttonPos ? (window.innerWidth - buttonPos.x + 12) : (BTN + 12) }
      : { left: buttonPos ? (buttonPos.x + BTN + 12) : (BTN + 12) }
    ),
    borderRadius: 22,
  }
  return (
    <div className="fixed z-[9999] flex flex-col overflow-hidden"
      style={panelStyle}>
      <PanelContent pageCtx={pageCtx} pathname={pathname} userName={userName} onClose={onClose} {...logic} />
    </div>
  )
}

// ─── Widget principal ─────────────────────────────────────────────────────────

export function SarahWidget({ userName, alertCount = 0, alerts = null }: {
  userName: string | null
  alertCount?: number
  alerts?: SarahAlerts | null
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const highlightedActionId = searchParams.get('sarahActionId')
  const [isOpen,         setIsOpen]         = useState(false)
  const [isHidden,       setIsHidden]       = useState(false)
  const [snap,           setSnap]           = useState<'left' | 'right'>('right')
  const [peekOut,        setPeekOut]        = useState(true)
  const [pageCtx,        setPageCtx]        = useState<PageContext>({ label: 'Atelier', context: null })
  const [isMobile,       setIsMobile]       = useState(false)
  const [isDragging,     setIsDragging]     = useState(false)
  // true si l'ouverture vient du badge (déclenche le brief auto)
  const [autoBrief,      setAutoBrief]      = useState(false)
  // signature du paquet d'alertes déjà consulté dans cette session
  const [viewedAlertSignature, setViewedAlertSignature] = useState<string | null>(null)

  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const dragging  = useRef(false)
  const hasMoved  = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const currentPos = useRef<{ x: number; y: number } | null>(null)
  const btnRef    = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSnap(defaultSnap())
    setIsHidden(localStorage.getItem(HIDDEN_KEY) === 'true')
    setViewedAlertSignature(localStorage.getItem(ALERTS_SEEN_KEY))
    setIsMobile(window.innerWidth < 640)
    const onResize = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Charge la position depuis localStorage
  useEffect(() => {
    const saved = localStorage.getItem('sarah_pos')
    if (saved) {
      try {
        const { x, y } = JSON.parse(saved)
        const safeX = Math.max(8, Math.min(x, window.innerWidth - BTN - 8))
        const safeY = Math.max(8, Math.min(y, window.innerHeight - BTN - 8))
        setPos({ x: safeX, y: safeY })
        currentPos.current = { x: safeX, y: safeY }
      } catch (e) {}
    }
  }, [])

  // Réajuste les coordonnées en cas de redimensionnement de la fenêtre
  useEffect(() => {
    const handleResize = () => {
      setPos(current => {
        if (!current) return null
        const safeX = Math.max(8, Math.min(current.x, window.innerWidth - BTN - 8))
        const safeY = Math.max(8, Math.min(current.y, window.innerHeight - BTN - 8))
        currentPos.current = { x: safeX, y: safeY }
        return { x: safeX, y: safeY }
      })
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    let dead = false
    // On transmet aussi la query string de la page (ex: ?id=... sur l'éditeur
    // de devis/facture) : usePathname() seul ne la contient jamais, et ces
    // éditeurs identifient leur document par un paramètre de requête, pas un
    // segment de chemin.
    const query = searchParams.toString()
    const fullPath = query ? `${pathname}?${query}` : pathname
    fetch(`/api/sarah/page-context?pathname=${encodeURIComponent(fullPath)}`)
      .then(r => r.json())
      .then((c: PageContext) => { if (!dead) setPageCtx(c) })
      .catch(() => {})
    return () => { dead = true }
  }, [pathname, searchParams])

  useEffect(() => {
    if (!highlightedActionId) return
    setIsHidden(false)
    localStorage.setItem(HIDDEN_KEY, 'false')
    setAutoBrief(false)
    setIsOpen(true)
    setPeekOut(true)
  }, [highlightedActionId])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      dragging.current = true
      setIsDragging(true)
      hasMoved.current = false
      e.preventDefault()
    }
  }, [])

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!dragging.current) return
      hasMoved.current = true
      const x = e.clientX - dragOffset.current.x
      const y = e.clientY - dragOffset.current.y
      
      const safeX = Math.max(8, Math.min(x, window.innerWidth - BTN - 8))
      const safeY = Math.max(8, Math.min(y, window.innerHeight - BTN - 8))
      
      currentPos.current = { x: safeX, y: safeY }
      setPos({ x: safeX, y: safeY })
      
      const newSnap: 'left' | 'right' = safeX + BTN / 2 < window.innerWidth / 2 ? 'left' : 'right'
      setSnap(newSnap)
    }
    
    function onUp() {
      if (!dragging.current) return
      dragging.current = false
      setIsDragging(false)
      if (hasMoved.current && currentPos.current) {
        localStorage.setItem('sarah_pos', JSON.stringify(currentPos.current))
        const newSnap: 'left' | 'right' = currentPos.current.x + BTN / 2 < window.innerWidth / 2 ? 'left' : 'right'
        localStorage.setItem(SNAP_KEY, newSnap)
      }
    }
    
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  const alertSignature = buildAlertSignature(alerts, alertCount)
  const markAlertsViewed = useCallback(() => {
    if (alertCount > 0) {
      setViewedAlertSignature(alertSignature)
      localStorage.setItem(ALERTS_SEEN_KEY, alertSignature)
    }
  }, [alertCount, alertSignature])

  const openNormal = useCallback(() => {
    setAutoBrief(false)
    markAlertsViewed()
    setIsOpen(true)
    setPeekOut(true)
  }, [markAlertsViewed])
  const openWithBrief = useCallback(() => {
    setAutoBrief(true)
    markAlertsViewed()
    setIsOpen(true)
    setPeekOut(true)
  }, [markAlertsViewed])

  const ctxValue: SarahCtxValue = { open: openNormal, close: () => setIsOpen(false), isOpen }

  if (isHidden) {
    return (
      <SarahCtx.Provider value={ctxValue}>
        <button
          onClick={() => { setIsHidden(false); localStorage.setItem(HIDDEN_KEY, 'false') }}
          className="fixed bottom-4 right-4 z-[9997] flex items-center gap-1.5 px-3 py-1.5 rounded-pill text-xs transition-all opacity-30 hover:opacity-80"
          style={{ background: 'var(--sarah-panel-bg)', border: '1px solid var(--sarah-panel-border)' }}>
          <Eye size={11} /> Sarah
        </button>
      </SarahCtx.Provider>
    )
  }

  const btnOffset = peekOut ? 0 : -(BTN - PEEK)
  const btnStyle: React.CSSProperties = isMobile ? {
    position: 'fixed', bottom: 20, right: 16, zIndex: 9998, width: BTN, height: BTN,
  } : {
    position: 'fixed',
    zIndex: 9998,
    width: BTN,
    height: BTN,
    transition: isDragging
      ? 'none'
      : 'right 0.32s cubic-bezier(0.34,1.56,0.64,1), left 0.32s cubic-bezier(0.34,1.56,0.64,1), top 0.32s cubic-bezier(0.34,1.56,0.64,1), bottom 0.32s cubic-bezier(0.34,1.56,0.64,1)',
    touchAction: 'none',
    ...(pos
      ? { left: pos.x, top: pos.y }
      : {
          bottom: 20,
          ...(snap === 'right' ? { right: btnOffset } : { left: btnOffset }),
        }
    ),
  }

  const showBadge = alertCount > 0 && !isOpen && viewedAlertSignature !== alertSignature

  return (
    <SarahCtx.Provider value={ctxValue}>
      {isOpen && isMobile && (
        <SarahDrawerMobile onClose={() => setIsOpen(false)} pathname={pathname}
          pageCtx={pageCtx} userName={userName} alertCount={alertCount} alerts={alerts} autoBriefOnOpen={autoBrief}
          highlightedActionId={highlightedActionId} />
      )}
      {isOpen && !isMobile && (
        <SarahDrawerDesktop onClose={() => setIsOpen(false)} pathname={pathname}
          pageCtx={pageCtx} userName={userName} snap={snap} alertCount={alertCount} alerts={alerts} autoBriefOnOpen={autoBrief}
          highlightedActionId={highlightedActionId} buttonPos={pos} />
      )}

      {/* Bouton flottant */}
      <div ref={btnRef} style={btnStyle} onPointerDown={isMobile ? undefined : onPointerDown}>

        {/* Oreillette quand caché */}
        {!isMobile && !peekOut && (
          <button
            className="absolute top-1/2 -translate-y-1/2 flex items-center justify-center rounded-full transition-all hover:scale-110 active:scale-95"
            style={{
              width: 22, height: 22,
              background: 'linear-gradient(to bottom, #ffb84d, rgb(255,159,28))',
              border: '1px solid rgba(255,255,255,0.15)',
              boxShadow: 'inset 0 1.5px 0 rgba(255,255,255,0.45), 0 2px 0 0 #b45309, 0 2px 0 1px rgba(120,53,15,0.12), 0 4px 8px rgba(0,0,0,0.2)',
              ...(snap === 'right' ? { left: -28 } : { right: -28 }),
            }}
            onClick={() => setPeekOut(true)} title="Afficher Sarah">
            <ChevronRight size={12} color="#000"
              style={{ transform: snap === 'right' ? 'none' : 'rotate(180deg)', filter: 'drop-shadow(0px 1px 0px rgba(255,255,255,0.24))' }} />
          </button>
        )}

        {/* Bouton masquer */}
        {!isMobile && (
          <button data-sarah-hide
            onClick={() => { setIsHidden(true); setIsOpen(false); localStorage.setItem(HIDDEN_KEY, 'true') }}
            className="sarah-hide-btn absolute -top-1 z-10 w-4 h-4 rounded-full flex items-center justify-center"
            style={{
              background: 'var(--sarah-util-btn-bg)',
              border: '1px solid var(--sarah-util-btn-border)',
              boxShadow: 'var(--sarah-util-btn-shadow)',
              ...(snap === 'right' ? { left: -1 } : { right: -1 }),
            }} title="Masquer">
            <X size={8} style={{ opacity: 0.55, filter: 'var(--sarah-icon-filter)' }} />
          </button>
        )}

        {/* Bouton rentrer sur le bord */}
        {!isMobile && peekOut && (
          <button
            className="sarah-hide-edge absolute z-10 w-4 h-4 rounded-full flex items-center justify-center"
            style={{
              background: 'var(--sarah-util-btn-bg)',
              border: '1px solid var(--sarah-util-btn-border)',
              boxShadow: 'var(--sarah-util-btn-shadow)',
              bottom: -1, ...(snap === 'right' ? { left: -1 } : { right: -1 }),
            }}
            onClick={(e) => {
              e.stopPropagation()
              setPeekOut(false)
              setIsOpen(false)
              setPos(null)
              localStorage.removeItem('sarah_pos')
            }}
            title="Réduire sur le bord">
            <ChevronRight size={8} style={{ opacity: 0.55, transform: snap === 'right' ? 'none' : 'rotate(180deg)', filter: 'var(--sarah-icon-filter)' }} />
          </button>
        )}

        {/* Bouton principal */}
        <button
          onClick={() => {
            if (isMobile) {
              setIsOpen(v => {
                if (!v) {
                  setAutoBrief(false)
                  markAlertsViewed()
                }
                return !v
              })
              return
            }
            if (hasMoved.current) return
            if (!peekOut) { setPeekOut(true); return }
            setIsOpen(v => {
              if (!v) {
                setAutoBrief(false)
                markAlertsViewed()
              }
              return !v
            })
          }}
          aria-label={isOpen ? 'Fermer Sarah' : 'Ouvrir Sarah'}
          className="w-full h-full rounded-full flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
          style={{
            cursor: isMobile ? 'pointer' : 'grab',
            boxShadow: isOpen
              ? 'inset 0 1.5px 0 rgba(255,255,255,0.25), 0 0 0 3px rgb(255,159,28), 0 4px 0 0 rgba(0,0,0,0.3), 0 8px 24px rgba(0,0,0,0.35)'
              : 'inset 0 1.5px 0 rgba(255,255,255,0.25), 0 4px 0 0 rgba(0,0,0,0.3), 0 4px 0 1px rgba(0,0,0,0.1), 0 8px 20px rgba(0,0,0,0.25), 0 0 0 2px rgba(255,159,28,0.45)',
          }}>
          <SarahAvatar size={BTN} />
        </button>

        {/* Badge d'alerte — ouvre Sarah sur les alertes détaillées */}
        {showBadge && (
          <button
            onClick={(e) => { e.stopPropagation(); openWithBrief() }}
            className="absolute -top-1 -right-1 z-20 min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10px] font-bold text-white transition-transform hover:scale-110 active:scale-95"
            style={{ background: 'rgb(var(--danger))', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }}>
            {alertCount > 9 ? '9+' : alertCount}
          </button>
        )}
      </div>

    </SarahCtx.Provider>
  )
}
