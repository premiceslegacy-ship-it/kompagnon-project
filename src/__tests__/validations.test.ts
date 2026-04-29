import { describe, it, expect } from 'vitest'
import { CreateInvoiceSchema, UpdateInvoiceSchema, SaveInvoiceItemsSchema, GenerateDepositSchema } from '@/lib/validations/invoices'
import { CreateClientInlineSchema } from '@/lib/validations/clients'
import { CreateQuoteSchema, UpdateQuoteSchema, UpsertQuoteItemSchema } from '@/lib/validations/quotes'

// ─── Invoice schemas ──────────────────────────────────────────────────────────

describe('CreateInvoiceSchema', () => {
  it('accepts minimal valid input', () => {
    expect(CreateInvoiceSchema.safeParse({ clientId: null }).success).toBe(true)
  })

  it('accepts a valid client UUID', () => {
    expect(CreateInvoiceSchema.safeParse({ clientId: '123e4567-e89b-12d3-a456-426614174000' }).success).toBe(true)
  })

  it('rejects a non-UUID clientId', () => {
    const result = CreateInvoiceSchema.safeParse({ clientId: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })
})

describe('UpdateInvoiceSchema', () => {
  it('accepts partial updates', () => {
    expect(UpdateInvoiceSchema.safeParse({ notes_client: 'Merci' }).success).toBe(true)
  })

  it('rejects payment_terms_days > 365', () => {
    const result = UpdateInvoiceSchema.safeParse({ payment_terms_days: 400 })
    expect(result.success).toBe(false)
  })

  it('accepts payment_terms_days at boundary', () => {
    const result = UpdateInvoiceSchema.safeParse({ payment_terms_days: 365 })
    expect(result.success).toBe(true)
  })

  it('rejects title with 0 characters', () => {
    const result = UpdateInvoiceSchema.safeParse({ title: '' })
    expect(result.success).toBe(false)
  })
})

describe('SaveInvoiceItemsSchema', () => {
  const validMeta = {
    clientId: null,
    issueDate: '2026-04-25',
    dueDate: '2026-05-25',
  }
  const validItem = {
    description: 'Pose carrelage',
    quantity: 2,
    unit: 'm²',
    unit_price: 45,
    vat_rate: 10,
  }

  it('accepts a valid payload', () => {
    const result = SaveInvoiceItemsSchema.safeParse({
      invoiceId: '123e4567-e89b-12d3-a456-426614174000',
      items: [validItem],
      meta: validMeta,
    })
    expect(result.success).toBe(true)
  })

  it('rejects quantity ≤ 0', () => {
    const result = SaveInvoiceItemsSchema.safeParse({
      invoiceId: '123e4567-e89b-12d3-a456-426614174000',
      items: [{ ...validItem, quantity: 0 }],
      meta: validMeta,
    })
    expect(result.success).toBe(false)
  })

  it('rejects negative unit_price', () => {
    const result = SaveInvoiceItemsSchema.safeParse({
      invoiceId: '123e4567-e89b-12d3-a456-426614174000',
      items: [{ ...validItem, unit_price: -1 }],
      meta: validMeta,
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid issueDate format', () => {
    const result = SaveInvoiceItemsSchema.safeParse({
      invoiceId: '123e4567-e89b-12d3-a456-426614174000',
      items: [validItem],
      meta: { ...validMeta, issueDate: '25/04/2026' },
    })
    expect(result.success).toBe(false)
  })
})

describe('GenerateDepositSchema', () => {
  it('accepts valid deposit', () => {
    const result = GenerateDepositSchema.safeParse({
      quoteId: '123e4567-e89b-12d3-a456-426614174000',
      depositRate: 30,
    })
    expect(result.success).toBe(true)
  })

  it('rejects depositRate > 100', () => {
    const result = GenerateDepositSchema.safeParse({
      quoteId: '123e4567-e89b-12d3-a456-426614174000',
      depositRate: 101,
    })
    expect(result.success).toBe(false)
  })

  it('rejects depositRate ≤ 0', () => {
    const result = GenerateDepositSchema.safeParse({
      quoteId: '123e4567-e89b-12d3-a456-426614174000',
      depositRate: 0,
    })
    expect(result.success).toBe(false)
  })
})

// ─── Client schemas ───────────────────────────────────────────────────────────

describe('CreateClientInlineSchema', () => {
  it('accepts a company with company_name', () => {
    const result = CreateClientInlineSchema.safeParse({ type: 'company', company_name: 'ACME SAS' })
    expect(result.success).toBe(true)
  })

  it('accepts an individual with last_name', () => {
    const result = CreateClientInlineSchema.safeParse({ type: 'individual', last_name: 'Dupont' })
    expect(result.success).toBe(true)
  })

  it('rejects a company without any name', () => {
    const result = CreateClientInlineSchema.safeParse({ type: 'company' })
    expect(result.success).toBe(false)
  })

  it('rejects an individual without any name', () => {
    const result = CreateClientInlineSchema.safeParse({ type: 'individual' })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid email', () => {
    const result = CreateClientInlineSchema.safeParse({
      type: 'company',
      company_name: 'ACME',
      email: 'not-an-email',
    })
    expect(result.success).toBe(false)
  })

  it('accepts empty string email (treated as absent)', () => {
    const result = CreateClientInlineSchema.safeParse({
      type: 'company',
      company_name: 'ACME',
      email: '',
    })
    expect(result.success).toBe(true)
  })
})

// ─── Quote schemas ────────────────────────────────────────────────────────────

describe('UpdateQuoteSchema', () => {
  it('accepts a partial update with valid validity_days', () => {
    const result = UpdateQuoteSchema.safeParse({ validity_days: 30 })
    expect(result.success).toBe(true)
  })

  it('rejects validity_days > 365', () => {
    const result = UpdateQuoteSchema.safeParse({ validity_days: 400 })
    expect(result.success).toBe(false)
  })

  it('rejects deposit_rate > 100', () => {
    const result = UpdateQuoteSchema.safeParse({ deposit_rate: 150 })
    expect(result.success).toBe(false)
  })

  it('accepts null deposit_rate', () => {
    const result = UpdateQuoteSchema.safeParse({ deposit_rate: null })
    expect(result.success).toBe(true)
  })
})

describe('UpsertQuoteItemSchema', () => {
  const validItem = {
    quote_id: '123e4567-e89b-12d3-a456-426614174000',
    type: 'material' as const,
    quantity: 10,
    unit_price: 25.5,
    position: 0,
  }

  it('accepts a valid item', () => {
    expect(UpsertQuoteItemSchema.safeParse(validItem).success).toBe(true)
  })

  it('rejects negative quantity', () => {
    const result = UpsertQuoteItemSchema.safeParse({ ...validItem, quantity: -1 })
    expect(result.success).toBe(false)
  })

  it('rejects unit_price < 0', () => {
    const result = UpsertQuoteItemSchema.safeParse({ ...validItem, unit_price: -0.01 })
    expect(result.success).toBe(false)
  })

  it('rejects unknown type', () => {
    const result = UpsertQuoteItemSchema.safeParse({ ...validItem, type: 'unknown' })
    expect(result.success).toBe(false)
  })
})
