// @atelier-migrated
// Logique pure : types locaux, conversions et calculs. Aucun état React ici.

import type { AIQuoteResult } from '@/app/api/ai/analyze-quote/route'
import { type PlanMeasurementItem, type PlanMeasurementResult, type PlanMeasurementSettings } from '@/lib/plan-measurement'

// ─── Helpers ──────────────────────────────────────────────────────────────────

export type Mode = 'voice' | 'text' | 'pdf' | 'measure'

export const ACCEPTED_FILE_TYPES = '.pdf,application/pdf,.png,.jpg,.jpeg,image/png,image/jpeg,image/jpg'

export const ACCEPTED_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'])

export const fmtPrice = (n: number) =>
  n > 0 ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n) : '-'

export const splitDetails = (description: string | null | undefined) => {
  const parts = (description ?? '').split(/\n\n?Comprend\s*:\s*/i)
  return {
    designation: parts[0]?.trim() ?? '',
    details: parts.length > 1 ? parts.slice(1).join('\nComprend : ').trim() : '',
  }
}

export function formulaVariablesForItem(item: PlanMeasurementItem, settings: PlanMeasurementSettings): Record<string, number> {
  const variables = { ...item.formulaVariables, quantity: item.quantity }
  if ('L' in variables && item.length_m != null) variables.L = item.length_m
  if ('W' in variables && item.width_m != null) variables.W = item.width_m
  if ('H' in variables) variables.H = item.height_m ?? settings.defaultHeightM
  if ('N' in variables && item.dim_quantity != null) variables.N = item.dim_quantity
  if ('waste' in variables) variables.waste = settings.wastePct / 100
  if ('spacing' in variables) variables.spacing = settings.studSpacingM
  if ('coats' in variables) variables.coats = settings.paintCoats
  return variables
}

// ─── 3D Icon Wrapper ──────────────────────────────────────────────────────────
// Applies layered drop-shadows + gradient tint for sculpted depth effect

export function joinNotes(label: string, values: string[] | undefined) {
  return values?.length ? `${label} : ${values.join(' ; ')}` : null
}

export function measurementToQuote(measurement: PlanMeasurementResult): AIQuoteResult {
  const grouped = new Map<string, PlanMeasurementItem[]>()
  for (const item of measurement.items.filter(candidate => candidate.validationStatus !== 'excluded')) {
    const key = `${item.trade} (${item.roomName?.trim() || 'Général'})`
    grouped.set(key, [...(grouped.get(key) ?? []), item])
  }

  const quoteWarnings = [
    ...measurement.globalWarnings,
    ...(measurement.needsCalibration ? ['Échelle ou cotes à confirmer avant devis définitif.'] : []),
    ...measurement.items
      .filter(item => item.confidence != null && item.confidence < 0.65)
      .slice(0, 5)
      .map(item => `${item.roomName} - ${item.designation} : confiance faible, à vérifier.`),
  ]

  return {
    title: measurement.title || 'Pré-métré depuis plan',
    clientName: null,
    clientDraft: null,
    quoteWarnings,
    sections: [...grouped.entries()].map(([sectionTitle, items]) => ({
      title: sectionTitle,
      items: items.map(item => {
        const details = [
          item.trade ? `Lot : ${item.trade}` : null,
          item.formula ? `Formule : ${item.formula}` : null,
          joinNotes('Hypothèses', item.assumptions),
          joinNotes('À vérifier', item.warnings),
          'Prix à renseigner après validation du métré.',
        ].filter(Boolean).join('\n')
        return {
          designation: item.designation,
          details,
          description: `${item.designation}\n\nComprend :\n${details}`,
          quantity: item.quantity,
          unit: item.unit,
          unit_price: 0,
          unit_cost_ht: null,
          vat_rate: 20,
          is_estimated: true,
          is_internal: false,
          ai_confidence: item.confidence ?? null,
          ai_source: 'document' as const,
          ai_warnings: item.warnings ?? [],
          dim_quantity: item.dim_quantity ?? 1,
          length_m: item.length_m ?? null,
          width_m: item.width_m ?? null,
          height_m: item.height_m ?? null,
          dimension_pricing_mode: item.dimension_pricing_mode ?? null,
          measurement_metadata: {
            measurementId: measurement.id ?? null,
            measurementLineId: item.id,
            tradeId: item.tradeId,
            sourceKind: item.sourceKind,
            validationStatus: item.validationStatus,
            formula: item.formula,
            formulaVariables: item.formulaVariables,
            evidence: item.evidence,
            confidence: item.confidence ?? null,
            rulesVersion: item.rulesVersion,
            settings: measurement.settings,
          },
        }
      }),
    })),
  }
}

