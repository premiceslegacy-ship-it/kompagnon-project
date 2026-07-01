import { z } from 'zod'

const currencySchema = z.string().length(3).regex(/^[A-Z]{3}$/).default('EUR')
const nullableUuidSchema = z.preprocess(
  value => value === '' ? null : value,
  z.string().uuid().nullable().optional(),
)

export const CreateQuoteSchema = z.object({
  clientId: nullableUuidSchema,
  title: z.string().max(255).optional(),
  currency: currencySchema.optional(),
  briefNotes: z.string().max(5000).nullable().optional(),
})

export const UpdateQuoteSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  client_id: nullableUuidSchema,
  currency: currencySchema.optional(),
  validity_days: z.number().int().min(1).max(365).optional(),
  notes_client: z.string().max(5000).nullable().optional(),
  payment_conditions: z.string().max(5000).nullable().optional(),
  discount_rate: z.number().min(0).max(100).nullable().optional(),
  deposit_rate: z.number().min(0).max(100).nullable().optional(),
  client_request_visible_on_pdf: z.boolean().optional(),
  aid_label: z.string().max(200).nullable().optional(),
  aid_amount: z.number().min(0).nullable().optional(),
  parent_quote_id: nullableUuidSchema,
  show_section_subtotals: z.boolean().optional(),
  variant_label: z.string().max(200).nullable().optional(),
  technical_checklist: z.array(z.object({
    id: z.string(),
    label: z.string(),
    category: z.string(),
    checked: z.boolean(),
  })).nullable().optional(),
})

export const UpsertQuoteItemSchema = z.object({
  id: z.string().uuid().optional(),
  quote_id: z.string().uuid(),
  section_id: z.string().uuid().nullable().optional(),
  type: z.enum(['material', 'labor', 'custom']),
  material_id: z.string().uuid().nullable().optional(),
  labor_rate_id: z.string().uuid().nullable().optional(),
  designation: z.string().max(500).nullable().optional(),
  details: z.string().max(5000).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  quantity: z.number().positive(),
  unit: z.string().max(50).nullable().optional(),
  unit_price: z.number().min(0),
  unit_cost_ht: z.number().min(0).nullable().optional(),
  ai_confidence: z.number().min(0).max(1).nullable().optional(),
  ai_source: z.enum(['catalog', 'recent_quote', 'memory', 'client_input', 'ai_estimate', 'document']).nullable().optional(),
  ai_warnings: z.array(z.string().max(300)).optional(),
  vat_rate: z.number().min(0).max(100).optional(),
  position: z.number().int().min(0),
  length_m: z.number().nullable().optional(),
  width_m: z.number().nullable().optional(),
  height_m: z.number().nullable().optional(),
  dim_quantity: z.number().min(0.001).optional(),
  is_internal: z.boolean().optional(),
  metal_grid_id: z.string().uuid().nullable().optional(),
  price_pending: z.boolean().optional(),
  labor_category: z.enum(['atelier', 'pose', 'finition', 'autre']).nullable().optional(),
})

export type CreateQuoteInput = z.infer<typeof CreateQuoteSchema>
export type UpdateQuoteInput = z.infer<typeof UpdateQuoteSchema>
export type UpsertQuoteItemInput = z.infer<typeof UpsertQuoteItemSchema>
