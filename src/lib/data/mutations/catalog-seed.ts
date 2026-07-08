'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import type { StarterPreset, StarterClause } from '@/lib/catalog-context'

/**
 * Insère les prestation_types + prestation_type_items d'une liste de presets.
 * Par défaut (onboarding, table vide) : n'insère rien si l'organisation a déjà
 * la moindre ligne dans prestation_types (count-guard global).
 * Avec skipCountGuard=true (activation d'un pack sur une org existante) : insère
 * directement la liste fournie sans vérifier le count global — l'appelant est
 * responsable d'avoir déjà filtré les presets déjà présents (par nom).
 */
export async function seedStarterPresetsIfNeeded(params: {
  admin: ReturnType<typeof createAdminClient>
  organizationId: string
  createdBy: string
  starterPresets: StarterPreset[]
  skipCountGuard?: boolean
}) {
  const { admin, organizationId, createdBy, starterPresets, skipCountGuard } = params

  if (starterPresets.length === 0) return

  if (!skipCountGuard) {
    const { count, error: countError } = await admin
      .from('prestation_types')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)

    if (countError) {
      console.error('[seedStarterPresetsIfNeeded] count error:', countError.message)
      return
    }

    if ((count ?? 0) > 0) return
  }

  const templatePayload = starterPresets.map((preset) => ({
    organization_id: organizationId,
    name: preset.name,
    description: preset.description,
    unit: preset.unit,
    category: preset.category,
    profile_kind: preset.profile_kind,
    vat_rate: preset.vat_rate,
    created_by: createdBy,
  }))

  const { data: insertedTemplates, error: templateError } = await admin
    .from('prestation_types')
    .insert(templatePayload)
    .select('id, name')

  if (templateError) {
    console.error('[seedStarterPresetsIfNeeded] insert templates error:', templateError.message)
    return
  }

  const itemPayload = starterPresets.flatMap((preset) => {
    const template = insertedTemplates?.find((entry) => entry.name === preset.name)
    if (!template) return []

    return preset.lines.map((line, index) => ({
      prestation_type_id: template.id,
      organization_id: organizationId,
      position: index,
      section_title: line.section_title ?? '',
      item_type: line.item_type,
      designation: line.designation,
      quantity: line.quantity,
      unit: line.unit,
      unit_price_ht: line.unit_price_ht ?? 0,
      unit_cost_ht: line.unit_cost_ht ?? 0,
      is_internal: line.is_internal ?? false,
    }))
  })

  if (itemPayload.length === 0) return

  const { error: itemError } = await admin
    .from('prestation_type_items')
    .insert(itemPayload)

  if (itemError) {
    console.error('[seedStarterPresetsIfNeeded] insert items error:', itemError.message)
  }
}

/**
 * Insère les quote_clause_templates d'une liste de clauses.
 * Même logique de count-guard optionnel que seedStarterPresetsIfNeeded.
 */
export async function seedStarterClausesIfNeeded(params: {
  admin: ReturnType<typeof createAdminClient>
  organizationId: string
  starterClauses: StarterClause[]
  skipCountGuard?: boolean
}) {
  const { admin, organizationId, starterClauses, skipCountGuard } = params
  if (starterClauses.length === 0) return

  if (!skipCountGuard) {
    const { count } = await admin
      .from('quote_clause_templates')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)

    if ((count ?? 0) > 0) return
  }

  const payload = starterClauses.map((clause) => ({
    organization_id: organizationId,
    title: clause.title,
    body: clause.body,
    category: clause.category,
    position: clause.position,
  }))

  const { error } = await admin.from('quote_clause_templates').insert(payload)
  if (error) console.error('[seedStarterClausesIfNeeded] error:', error.message)
}
