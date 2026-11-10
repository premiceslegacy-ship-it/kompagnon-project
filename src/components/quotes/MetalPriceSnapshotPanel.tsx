'use client'
// @atelier-migrated

import { METAL_LABELS, type MetalCode } from '@/lib/metal-prices'
import type { MetalPriceSnapshotRow } from '@/lib/data/queries/metal-price-snapshots'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import styles from './Panels.module.css'

type Props = {
  snapshots: MetalPriceSnapshotRow[]
}

const nf = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const fmtEurKg = (n: number) => `${nf.format(n)} €/kg`
const fmtEur = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n)

function fmtDateHeure(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
}

/** Prix matière figés à la validation du devis, ligne par ligne. */
export default function MetalPriceSnapshotPanel({ snapshots }: Props) {
  if (snapshots.length === 0) return null

  return (
    <ListGroup
      title="Prix matière enregistrés à la validation"
      description="Références matière au moment de la validation, non contractuelles. Le prix final reste celui validé par l’artisan."
    >
      {snapshots.map(s => {
        const manual = s.source === 'manual' || s.lme_price_eur_kg === null
        const reference = manual
          ? `Référence manuelle au centime ${nf.format(Number(s.computed_price))} € HT / ${s.item_unit ?? 'unité non renseignée'}`
          : `Cours ${fmtEurKg(s.lme_price_eur_kg!)} × ${Number(s.coefficient).toFixed(2)}`
        return (
          <ListRow
            key={s.id}
            title={s.item_description ?? '—'}
            description={`${METAL_LABELS[s.metal_code as MetalCode] ?? s.metal_code} · ${reference} · ${fmtDateHeure(s.price_date)}`}
            trailing={<span className={styles.value}>{fmtEur(s.validated_price)}</span>}
          />
        )
      })}
    </ListGroup>
  )
}
