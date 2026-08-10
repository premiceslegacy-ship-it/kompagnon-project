'use client'

import {
  upsertOperatorClientMetalPricing,
  upsertOperatorClientModules,
  upsertOperatorClientVerticalPack,
} from '../actions'
import type { ClientRow } from '../types'
import { ORGANIZATION_MODULE_KEYS } from '@/lib/organization-modules'
import { VERTICAL_PACKS, getEligibleVerticalPack } from '@/lib/vertical-packs'

const sectionTitleCls = 'text-sm font-bold uppercase tracking-wide text-secondary font-display'

export default function ModulesTab({ row }: { row: ClientRow }) {
  if (!row.organizationId) {
    return (
      <div className="card px-6 py-5">
        <p className="text-sm text-secondary font-body">
          Cette ligne n&apos;a pas encore d&apos;organisation résolue — la configuration produit sera disponible dès le premier appel IA synchronisé (ingest).
        </p>
      </div>
    )
  }

  const suggestedPack = getEligibleVerticalPack(row.businessActivityId)

  return (
    <div className="space-y-5">
      <form action={upsertOperatorClientModules} className="card px-6 py-5 space-y-3">
        <input type="hidden" name="sourceInstance" value={row.sourceInstance} />
        <input type="hidden" name="organizationId" value={row.organizationId} />
        <p className={sectionTitleCls}>Modules</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {ORGANIZATION_MODULE_KEYS.map((key) => (
            <label key={key} className="flex items-center gap-2 rounded-lg border border-[var(--elevation-border)] px-3 py-2 text-sm text-secondary font-body">
              <input
                name={`module_${key}`}
                type="checkbox"
                defaultChecked={row.modules[key]}
                className="h-4 w-4 rounded border-[var(--elevation-border)] accent-accent"
              />
              {key}
            </label>
          ))}
        </div>
        <button type="submit" className="btn-pill btn-pill-primary w-full text-sm">
          Appliquer
        </button>
      </form>

      <form action={upsertOperatorClientVerticalPack} className="card px-6 py-5 space-y-3">
        <input type="hidden" name="sourceInstance" value={row.sourceInstance} />
        <input type="hidden" name="organizationId" value={row.organizationId} />
        <div className="flex items-center justify-between gap-3">
          <p className={sectionTitleCls}>Pack verticale métier</p>
          {suggestedPack && !row.businessVerticalPackId && (
            <span className="rounded-pill bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
              Suggéré : {suggestedPack.label}
            </span>
          )}
        </div>
        <select
          name="vertical_pack_id"
          defaultValue={row.businessVerticalPackId ?? ''}
          className="w-full input-glass px-3 py-2 text-sm text-primary font-body outline-none"
        >
          <option value="">Aucun pack</option>
          {Object.values(VERTICAL_PACKS).map((pack) => (
            <option key={pack.id} value={pack.id}>{pack.label}</option>
          ))}
        </select>
        <button type="submit" className="btn-pill btn-pill-primary w-full text-sm">
          Appliquer
        </button>
      </form>

      <form action={upsertOperatorClientMetalPricing} className="card px-6 py-5 space-y-3">
        <input type="hidden" name="sourceInstance" value={row.sourceInstance} />
        <input type="hidden" name="organizationId" value={row.organizationId} />
        <p className={sectionTitleCls}>Module prix matières (métal)</p>
        <label className="flex items-center gap-2 rounded-lg border border-[var(--elevation-border)] px-3 py-2 text-sm text-secondary font-body">
          <input
            name="hasMetalPricing"
            type="checkbox"
            defaultChecked={row.hasMetalPricing}
            className="h-4 w-4 rounded border-[var(--elevation-border)] accent-accent"
          />
          Actif — s&apos;active normalement seul (tier Pro+ et activité métal), ce toggle sert de filet manuel
        </label>
        <button type="submit" className="btn-pill btn-pill-primary w-full text-sm">
          Appliquer
        </button>
      </form>
    </div>
  )
}
