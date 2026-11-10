'use client'
// @atelier-migrated

import { METAL_LABELS } from '@/lib/metal-prices'
import type { MetalPriceGrid } from '@/lib/data/mutations/metal-price-grids'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import styles from './Panels.module.css'

type Props = {
  grids: MetalPriceGrid[]
  onGridSelect?: (grid: MetalPriceGrid) => void
}

const formatter = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })


/** Prix matières saisis par l'entreprise, sans fournisseur de cours automatique. */
export default function MetalPriceBanner({ grids, onGridSelect }: Props) {
  const manualGrids = grids.filter(grid => grid.source_type === 'manual'
    && grid.manual_price_eur_kg !== null
    && Number.isFinite(grid.manual_price_eur_kg)
    && grid.manual_price_eur_kg > 0)
  const requiresManualPrice = manualGrids.length !== grids.length

  return (
    <div className={styles.stack}>
      {manualGrids.length > 0 && (
        <ListGroup
          title="Vos prix matières"
          description="Vos prix fournisseur HT servent de référence. Les tarifs de devis sont arrondis au centime. Les quantités en tonnes se saisissent manuellement, avec trois décimales maximum."
        >
          {manualGrids.map(grid => {
            const description = `${METAL_LABELS[grid.metal_code]} · ${formatter.format(grid.manual_price_eur_kg!)} €/${grid.unit} · prix manuel`
            return onGridSelect ? (
              <ListRow
                key={grid.id}
                title={grid.label}
                description={description}
                onClick={() => onGridSelect(grid)}
                trailing={<span className={styles.chevron} aria-hidden="true">›</span>}
              />
            ) : (
              <ListRow key={grid.id} title={grid.label} description={description} />
            )
          })}
        </ListGroup>
      )}
      {requiresManualPrice && (
        <p className={`${styles.note} ${styles.noteWarn}`} role="status">
          Certaines grilles nécessitent un prix manuel valide. Les cours automatiques ne sont plus utilisés.
        </p>
      )}
      <ListGroup description={manualGrids.length === 0 ? 'Saisissez vos prix matières pour pré-remplir vos lignes de devis.' : undefined}>
        <ListRow
          title="Configurer les prix matières"
          href="/settings?tab=devis#metal-prices"
          trailing={<span className={styles.chevron} aria-hidden="true">›</span>}
        />
      </ListGroup>
    </div>
  )
}
