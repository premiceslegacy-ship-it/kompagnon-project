// @atelier-migrated
// Logique pure : types locaux, conversions et calculs. Aucun état React ici.

import { X } from 'lucide-react'
import type { Client } from '@/lib/data/queries/clients'

import type { RecurringInvoice, RecurringFrequency } from '@/lib/data/recurring-utils'

import { getClientDisplayName } from '@/lib/client'

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })

export function isReadyToPrepare(inv: RecurringInvoice) {
  if (!inv.is_active) return false
  const nextDate = new Date(`${inv.next_send_date}T00:00:00`)
  const triggerDate = new Date(nextDate)
  triggerDate.setDate(triggerDate.getDate() - (inv.requires_confirmation ? inv.confirmation_delay_days ?? 3 : 0))
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today >= triggerDate
}

export function clientDisplayName(c: Client): string {
  return getClientDisplayName(c)
}


export const FREQ_OPTIONS: { value: RecurringFrequency; label: string }[] = [
  { value: 'monthly', label: 'Mensuelle' },
  { value: 'quarterly', label: 'Trimestrielle' },
  { value: 'weekly', label: 'Hebdomadaire' },
  { value: 'custom', label: 'Personnalisée (X jours)' },
]

// ─── Types ────────────────────────────────────────────────────────────────────

export type FormItem = { id: number; desc: string; qty: number; unit: string; pu: number; vat: number; is_internal: boolean }

export function isEquipmentLine(item: Pick<FormItem, 'is_internal' | 'unit'>) {
  return item.is_internal && item.unit === 'usage'
}

export type FromInvoice = {
  title: string
  clientId: string
  items: FormItem[]
} | null

