import { describe, expect, it } from 'vitest'
import { invoiceReminderTiming } from '@/lib/invoice-reminder-timing'

describe('invoice reminder reference date', () => {
  it('describes a preventive reminder using the sending date, not a future due date', () => {
    expect(invoiceReminderTiming('2026-10-24T14:30:00Z', '2026-11-24', '2026-10-27')).toEqual({
      reason: 'sent_unpaid', referenceDate: '2026-10-24', daysSinceSent: 3, daysLate: 3,
    })
  })

  it('counts overdue days from the due date without moving the sending-based eligibility threshold', () => {
    expect(invoiceReminderTiming('2026-10-07T08:00:00Z', '2026-10-25', '2026-10-27')).toEqual({
      reason: 'overdue', referenceDate: '2026-10-25', daysSinceSent: 20, daysLate: 2,
    })
  })

  it('does not describe an invoice due today as overdue', () => {
    expect(invoiceReminderTiming('2026-10-24T23:59:59Z', '2026-10-27', '2026-10-27')).toEqual({
      reason: 'sent_unpaid', referenceDate: '2026-10-24', daysSinceSent: 3, daysLate: 3,
    })
  })

  it('retains the sending reference when no payment due date exists', () => {
    expect(invoiceReminderTiming('2026-10-24T00:00:00Z', null, '2026-10-27')).toEqual({
      reason: 'sent_unpaid', referenceDate: '2026-10-24', daysSinceSent: 3, daysLate: 3,
    })
  })

  it('retains the existing due-date eligibility fallback for an undated legacy delivery', () => {
    expect(invoiceReminderTiming(null, '2026-10-24', '2026-10-27')).toEqual({
      reason: 'overdue', referenceDate: '2026-10-24', daysSinceSent: 3, daysLate: 3,
    })
  })

  it('does not invent a reference when both stored dates are absent', () => {
    expect(invoiceReminderTiming(null, null, '2026-10-27')).toBeNull()
  })
})
