type InvoiceReminderTiming = {
  reason: 'sent_unpaid' | 'overdue'
  referenceDate: string
  daysSinceSent: number
  daysLate: number
}

export function invoiceReminderTiming(
  sentAt: string | null | undefined,
  dueDate: string | null | undefined,
  today: string,
): InvoiceReminderTiming | null {
  const sentDate = sentAt?.slice(0, 10) ?? dueDate
  if (!sentDate) return null
  const todayMs = Date.parse(today)
  const daysSinceSent = Math.floor((todayMs - Date.parse(sentDate)) / 86_400_000)
  const overdue = Boolean(dueDate && dueDate < today)
  const referenceDate = overdue && dueDate ? dueDate : sentDate
  return {
    reason: overdue ? 'overdue' : 'sent_unpaid',
    referenceDate,
    daysSinceSent,
    daysLate: referenceDate === sentDate
      ? daysSinceSent
      : Math.floor((todayMs - Date.parse(referenceDate)) / 86_400_000),
  }
}
