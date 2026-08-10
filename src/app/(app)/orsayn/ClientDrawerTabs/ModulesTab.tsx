'use client'

import {
  upsertOperatorClientMetalPricing,
  upsertOperatorClientModules,
  upsertOperatorClientVerticalPack,
} from '../actions'
import type { ClientRow } from '../types'
import { ORGANIZATION_MODULE_KEYS } from '@/lib/organization-modules'
import { VERTICAL_PACKS, getEligibleVerticalPack } from '@/lib/vertical-packs'

export default function ModulesTab({ row }: { row: ClientRow }) {
  if (!row.organizationId) {
    return (
      <p className="text-sm text-secondary font-body">
        Cette ligne n&apos;a pas encore d&apos;organisation résolue — la configuration produit sera disponible dès le premier appel IA synchronisé (ingest).
      </p>
    )
  }

  const suggestedPack = getEligibleVerticalPack(row.businessActivityId)

  return (
    <div className="space-y-4">
      <form action={upsertOperatorClientModules} className="rounded-lg border border-[var(--elevation-border)] bg-interactive/40 p-3 space-y-2">
        <input type="hidden" name="sourceInstance" value={row.sourceInstance} />
        <input type="hidden" name="organizationId" value={row.organizationId} />
        <p className="text-xs font-bold uppercase tracking-wide text-secondary font-display mb-1">Modules</p>
        {ORGANIZATION_MODULE_KEYS.map((key) => (
          <label key={key} className="flex items-center gap-2 text-xs text-secondary font-body">
            <input
              name={`module_${key}`}
              type="checkbox"
              defaultChecked={row.modules[key]}
              className="h-4 w-4 rounded border-[var(--elevation-border)] accent-accent"
            />
            {key}
          </label>
        ))}
        <button type="submit" className="inline-flex justify-center rounded-pill bg-accent/10 text-accent px-3 py-2 text-xs font-semibold font-display transition hover:bg-accent/20">
          Appliquer
        </button>
      </form>

      <form action={upsertOperatorClientVerticalPack} className="rounded-lg border border-[var(--elevation-border)] bg-interactive/40 p-3 space-y-2">
        <input type="hidden" name="sourceInstance" value={row.sourceInstance} />
        <input type="hidden" name="organizationId" value={row.organizationId} />
        <p className="text-xs font-bold uppercase tracking-wide text-secondary font-display mb-1">
          Pack verticale métier
          {suggestedPack && !row.businessVerticalPackId && (
            <span className="ml-2 rounded-pill bg-accent/10 px-2 py-0.5 text-[10px] font-semibold normal-case text-accent">
              Suggéré : {suggestedPack.label}
            </span>
          )}
        </p>
        <select
          name="vertical_pack_id"
          defaultValue={row.businessVerticalPackId ?? ''}
          className="rounded-md border border-[var(--elevation-border)] bg-transparent px-2 py-1.5 text-xs text-primary"
        >
          <option value="">Aucun pack</option>
          {Object.values(VERTICAL_PACKS).map((pack) => (
            <option key={pack.id} value={pack.id}>{pack.label}</option>
          ))}
        </select>
        <button type="submit" className="inline-flex justify-center rounded-pill bg-accent/10 text-accent px-3 py-2 text-xs font-semibold font-display transition hover:bg-accent/20">
          Appliquer
        </button>
      </form>

      <form action={upsertOperatorClientMetalPricing} className="rounded-lg border border-[var(--elevation-border)] bg-interactive/40 p-3 space-y-2">
        <input type="hidden" name="sourceInstance" value={row.sourceInstance} />
        <input type="hidden" name="organizationId" value={row.organizationId} />
        <p className="text-xs font-bold uppercase tracking-wide text-secondary font-display mb-1">
          Module prix matières (métal)
        </p>
        <label className="flex items-center gap-2 text-xs text-secondary font-body">
          <input
            name="hasMetalPricing"
            type="checkbox"
            defaultChecked={row.hasMetalPricing}
            className="h-4 w-4 rounded border-[var(--elevation-border)] accent-accent"
          />
          Actif — s&apos;active normalement seul (tier Pro+ et activité métal), ce toggle sert de filet manuel
        </label>
        <button type="submit" className="inline-flex justify-center rounded-pill bg-accent/10 text-accent px-3 py-2 text-xs font-semibold font-display transition hover:bg-accent/20">
          Appliquer
        </button>
      </form>
    </div>
  )
}
