import { z } from 'zod'

const currencySchema = z.string().length(3).regex(/^[A-Z]{3}$/).default('EUR')

export const CreateInvoiceSchema = z.object({
  clientId: z.string().uuid().nullable().optional(),
  title: z.string().max(255).optional(),
  currency: currencySchema.optional(),
  quoteId: z.string().uuid().nullable().optional(),
  chantierId: z.string().uuid().nullable().optional(),
})

export const UpdateInvoiceSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  client_id: z.string().uuid().nullable().optional(),
  chantier_id: z.string().uuid().nullable().optional(),
  currency: currencySchema.optional(),
  payment_terms_days: z.number().int().min(0).max(365).optional(),
  notes_client: z.string().max(5000).nullable().optional(),
  payment_conditions: z.string().max(5000).nullable().optional(),
  aid_label: z.string().max(200).nullable().optional(),
  aid_amount: z.number().min(0).nullable().optional(),
})

const invoiceItemSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.number().positive(),
  unit: z.string().max(50),
  unit_price: z.number().min(0),
  vat_rate: z.number().min(0).max(100),
  is_internal: z.boolean().optional(),
  length_m: z.number().nullable().optional(),
  width_m: z.number().nullable().optional(),
  height_m: z.number().nullable().optional(),
  material_id: z.string().uuid().nullable().optional(),
})

export const SaveInvoiceItemsSchema = z.object({
  invoiceId: z.string().uuid(),
  items: z.array(invoiceItemSchema).max(500),
  meta: z.object({
    clientId: z.string().uuid().nullable(),
    issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    title: z.string().max(255).nullable().optional(),
    quoteId: z.string().uuid().nullable().optional(),
    chantierId: z.string().uuid().nullable().optional(),
    aidLabel: z.string().max(200).nullable().optional(),
    aidAmount: z.number().min(0).nullable().optional(),
  }),
})

export const GenerateDepositSchema = z.object({
  quoteId: z.string().uuid(),
  depositRate: z.number().int().min(1).max(100),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  balanceDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

export type CreateInvoiceInput = z.infer<typeof CreateInvoiceSchema>
export type UpdateInvoiceInput = z.infer<typeof UpdateInvoiceSchema>
export type SaveInvoiceItemsInput = z.infer<typeof SaveInvoiceItemsSchema>
export type GenerateDepositInput = z.infer<typeof GenerateDepositSchema>
