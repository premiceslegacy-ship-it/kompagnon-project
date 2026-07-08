'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getVerticalPackDefinition, type VerticalPackId } from '@/lib/vertical-packs'
import { seedStarterPresetsIfNeeded, seedStarterClausesIfNeeded } from '@/lib/data/mutations/catalog-seed'

type Result = { error: string | null }

/**
 * Active un pack verticale pour une organisation existante (cockpit Orsayn).
 * Contrairement au seed d'onboarding (table vide, count-guard global), une org
 * existante peut déjà avoir des prestation_types/quote_clause_templates sans
 * rapport avec le pack : on déduplique donc par nom/titre, pas par count global,
 * pour que le pack s'ajoute quel que soit l'état actuel du catalogue.
 * Idempotent : peut être rappelée sans créer de doublons.
 */
export async function activateVerticalPackForOrganization(params: {
  organizationId: string
  packId: VerticalPackId
  actorUserId: string
}): Promise<Result> {
  const pack = getVerticalPackDefinition(params.packId)
  if (!pack) return { error: 'Pack inconnu.' }

  const admin = createAdminClient()

  const { error: updateError } = await admin
    .from('organizations')
    .update({ business_vertical_pack: pack.id })
    .eq('id', params.organizationId)

  if (updateError) return { error: updateError.message }

  if (pack.starterPresets.length > 0) {
    const presetNames = pack.starterPresets.map((p) => p.name)
    const { data: existingPresets } = await admin
      .from('prestation_types')
      .select('name')
      .eq('organization_id', params.organizationId)
      .in('name', presetNames)

    const existingNames = new Set((existingPresets ?? []).map((p) => p.name))
    const presetsToInsert = pack.starterPresets.filter((p) => !existingNames.has(p.name))

    if (presetsToInsert.length > 0) {
      await seedStarterPresetsIfNeeded({
        admin,
        organizationId: params.organizationId,
        createdBy: params.actorUserId,
        starterPresets: presetsToInsert,
        skipCountGuard: true,
      })
    }
  }

  if (pack.starterClauses.length > 0) {
    const clauseTitles = pack.starterClauses.map((c) => c.title)
    const { data: existingClauses } = await admin
      .from('quote_clause_templates')
      .select('title')
      .eq('organization_id', params.organizationId)
      .in('title', clauseTitles)

    const existingTitles = new Set((existingClauses ?? []).map((c) => c.title))
    const clausesToInsert = pack.starterClauses.filter((c) => !existingTitles.has(c.title))

    if (clausesToInsert.length > 0) {
      await seedStarterClausesIfNeeded({
        admin,
        organizationId: params.organizationId,
        starterClauses: clausesToInsert,
        skipCountGuard: true,
      })
    }
  }

  return { error: null }
}

/**
 * Désactive le pack verticale d'une organisation. Ne supprime jamais les
 * presets/clauses déjà créés : l'artisan a pu les modifier ou les utiliser
 * dans des devis existants. Désactive seulement le pilotage IA/contrat.
 */
export async function deactivateVerticalPackForOrganization(params: {
  organizationId: string
}): Promise<Result> {
  const admin = createAdminClient()
  const { error } = await admin
    .from('organizations')
    .update({ business_vertical_pack: null })
    .eq('id', params.organizationId)

  return { error: error?.message ?? null }
}
