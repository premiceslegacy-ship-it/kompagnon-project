import { z } from 'zod'

const clientTypeSchema = z.enum(['company', 'individual'])
const clientStatusSchema = z.enum(['active', 'prospect', 'lead_hot', 'lead_cold', 'inactive'])

export const CreateClientInlineSchema = z.object({
  type: clientTypeSchema,
  company_name: z.string().max(255).optional(),
  contact_name: z.string().max(255).optional(),
  first_name: z.string().max(100).optional(),
  last_name: z.string().max(100).optional(),
  email: z.string().email().max(255).optional().or(z.literal('')),
  phone: z.string().max(30).optional(),
  address_line1: z.string().max(255).optional(),
  postal_code: z.string().max(10).optional(),
  city: z.string().max(100).optional(),
}).refine(
  data => !!(data.company_name?.trim() || data.last_name?.trim() || data.first_name?.trim()),
  { message: 'Le nom ou la raison sociale est requis.' }
)

export const UpdateClientSchema = z.object({
  client_id: z.string().uuid(),
  type: clientTypeSchema,
  company_name: z.string().max(255).nullable().optional(),
  contact_name: z.string().max(255).nullable().optional(),
  first_name: z.string().max(100).nullable().optional(),
  last_name: z.string().max(100).nullable().optional(),
  email: z.string().email().max(255).nullable().optional().or(z.literal('')).or(z.null()),
  phone: z.string().max(30).nullable().optional(),
  siret: z.string().max(14).nullable().optional(),
  address_line1: z.string().max(255).nullable().optional(),
  payment_terms_days: z.number().int().min(0).max(365).optional(),
  status: clientStatusSchema.optional(),
  source: z.string().max(100).nullable().optional(),
  currency: z.string().length(3).optional(),
  locale: z.string().max(5).optional(),
})

export type CreateClientInlineInput = z.infer<typeof CreateClientInlineSchema>
export type UpdateClientInput = z.infer<typeof UpdateClientSchema>
