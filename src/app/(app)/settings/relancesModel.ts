// @atelier-migrated
// Relances et emails : jours de relance, heure d'envoi, délai de première relance (outils purs).

export const MAX_REMINDERS = 4
export const FIRST_INVOICE_REMINDER_MIN = 3

export const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}h00 UTC`

/** Équivalent en heure de Paris : +1 l'hiver, +2 l'été. */
export function parisHint(hour: number): string {
  const at = (offset: number) => String((hour + offset) % 24).padStart(2, '0')
  return `Soit ${at(1)}h à Paris l’hiver, ${at(2)}h l’été.`
}

/** Valeur saisie pour une relance : au moins 1, et au moins 3 pour la première relance de facture. */
export function normalizeReminderDay(raw: number | null | undefined, index: number, isInvoice: boolean): number {
  const value = !raw || !Number.isFinite(raw) ? 1 : Math.round(raw)
  return isInvoice && index === 0 ? Math.max(FIRST_INVOICE_REMINDER_MIN, value) : value
}

export function setReminderDay(days: number[], index: number, raw: number | null, isInvoice: boolean): number[] {
  const value = normalizeReminderDay(raw, index, isInvoice)
  return days.map((d, i) => (i === index ? value : d))
}

/** Ajoute une relance 7 jours après la dernière (limite de MAX_REMINDERS). */
export function addReminderDay(days: number[]): number[] {
  if (days.length >= MAX_REMINDERS) return days
  return [...days, (days[days.length - 1] ?? 0) + 7]
}

/** Retire une relance, en gardant toujours au moins une. */
export function removeReminderDay(days: number[], index: number): number[] {
  return days.length > 1 ? days.filter((_, i) => i !== index) : days
}

export const reminderDayLabel = (day: number) => `J+${day}`

export function clampFirstDelay(value: number | null | undefined): number {
  return Math.max(3, value && Number.isFinite(value) ? Math.round(value) : 3)
}

/** « Alice · alice@x.fr », ou ce qui est renseigné, pour la ligne de l'expéditeur. */
export function senderSummary(name: string, address: string): string {
  return [name.trim(), address.trim()].filter(Boolean).join(' · ') || 'Non configuré'
}
