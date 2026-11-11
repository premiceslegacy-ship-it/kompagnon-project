import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const mocks = vi.hoisted(() => ({ getIssuedInvoiceCreditTotals: vi.fn() }))
vi.mock('@/lib/data/queries/invoices', () => ({ getIssuedInvoiceCreditTotals: mocks.getIssuedInvoiceCreditTotals }))

import { getDashboardStats } from '@/lib/data/queries/dashboard'

type InvoiceRow = {
  id: string
  issue_date?: string
  invoice_type: string
  total_ttc: number
  total_paid: number
  status: string
  number?: string | null
  title?: string | null
  due_date?: string | null
  sent_at?: string | null
  client_id?: string | null
}

type QueryResult = { data: unknown; error: null }

function dashboardClient(monthInvoices: InvoiceRow[], overdueInvoices: InvoiceRow[]): SupabaseClient {
  const makeQuery = (table: string) => {
    const filters = new Map<string, unknown>()
    const rows = () => {
      if (table !== 'invoices') return []
      const start = filters.get('gte:issue_date')
      const end = filters.get('lt:issue_date')
      if (typeof start === 'string' && typeof end === 'string') {
        return monthInvoices.filter(invoice => invoice.issue_date != null && invoice.issue_date >= start && invoice.issue_date < end)
      }
      if (filters.get('eq:invoice_type') === 'acompte') return []
      return overdueInvoices
    }
    const query = {
      select(_columns?: string) { return this },
      eq(column: string, value: unknown) { filters.set(`eq:${column}`, value); return this },
      gte(column: string, value: unknown) { filters.set(`gte:${column}`, value); return this },
      lt(column: string, value: unknown) { filters.set(`lt:${column}`, value); return this },
      in(_column: string, _values: readonly unknown[]) { return this },
      or(_filters: string) { return this },
      order(_column: string, _options?: unknown) { return this },
      limit(_count: number) { return this },
      not(_column: string, _operator: string, _value: unknown) { return this },
      lte(_column: string, _value: unknown) { return this },
      is(_column: string, _value: unknown) { return this },
      gt(_column: string, _value: unknown) { return this },
      single() { return Promise.resolve({ data: null, error: null } satisfies QueryResult) },
      then(resolve?: (result: QueryResult) => unknown) {
        return Promise.resolve({ data: rows(), error: null } satisfies QueryResult).then(resolve)
      },
    }
    return query
  }

  return { from: makeQuery } as unknown as SupabaseClient
}

beforeEach(() => {
  mocks.getIssuedInvoiceCreditTotals.mockReset().mockResolvedValue(new Map([
    ['fully-credited', 322.55],
    ['partially-credited', 300],
  ]))
})

describe('chiffres de facturation du tableau de bord', () => {
  it('signe les avoirs à leur date d’émission et limite les relances au reste dû réel', async () => {
    const client = dashboardClient([
      { id: 'nov-issued', issue_date: '2026-11-01', invoice_type: 'standard', total_ttc: 120, total_paid: 120, status: 'paid' },
      { id: 'nov-credit', issue_date: '2026-11-30', invoice_type: 'avoir', total_ttc: 40, total_paid: 40, status: 'paid' },
      { id: 'oct-last-day', issue_date: '2026-10-31', invoice_type: 'standard', total_ttc: 240, total_paid: 0, status: 'sent' },
    ], [
      { id: 'fully-credited', invoice_type: 'standard', total_ttc: 422.55, total_paid: 100, status: 'overdue', due_date: '2000-01-01' },
      { id: 'partially-credited', invoice_type: 'standard', total_ttc: 422.55, total_paid: 100, status: 'overdue', due_date: '2000-01-01' },
      { id: 'credit-note', invoice_type: 'avoir', total_ttc: 322.55, total_paid: 0, status: 'overdue', due_date: '2000-01-01' },
    ])

    const stats = await getDashboardStats('2026-11', {
      client,
      orgId: 'dashboard-test-org',
    })

    expect(stats.caMois).toBe(80)
    expect(stats.encaisseMois).toBe(120)
    expect(stats.facturesEnRetard).toBe(1)
    expect(stats.urgentItems.filter(item => item.type === 'overdue_invoice').map(({ id, amount }) => ({ id, amount })))
      .toEqual([{ id: 'partially-credited', amount: 22.55 }])
  })

  it('propage un échec de vérification des avoirs au lieu de retourner des chiffres financiers à zéro', async () => {
    mocks.getIssuedInvoiceCreditTotals.mockRejectedValueOnce(
      new Error('Impossible de vérifier les avoirs émis pour ces factures.'),
    )
    const client = dashboardClient([], [
      { id: 'unverified-invoice', invoice_type: 'standard', total_ttc: 120, total_paid: 0, status: 'overdue', due_date: '2000-01-01' },
    ])

    await expect(getDashboardStats('2026-11', {
      client,
      orgId: 'dashboard-test-org',
    })).rejects.toThrow()
  })
})
