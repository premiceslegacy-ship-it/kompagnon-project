'use client'
// @atelier-migrated

import { useMemo, useState } from 'react'
import { checkBtpMentions, countMissingByCategory, type BtpMentionCategory } from '@/lib/btp-legal-mentions'
import { Button } from '@/components/ui/Button'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import styles from './Panels.module.css'

type Props = {
  quote: Parameters<typeof checkBtpMentions>[0]
  org: Parameters<typeof checkBtpMentions>[1]
}

const CATEGORY_LABELS: Record<BtpMentionCategory, string> = {
  identification: 'Identification entreprise',
  client: 'Identification client',
  description_travaux: 'Description des travaux',
  prix: 'Prix et montants',
  tva: 'TVA',
  delai: 'Délais',
  garanties: 'Garanties et assurances',
  paiement: 'Conditions de paiement',
  divers: 'Mentions diverses',
}

/** Contrôle des mentions légales obligatoires d'un devis BTP, par catégorie. */
export default function BtpMentionsPanel({ quote, org }: Props) {
  const [showAll, setShowAll] = useState(false)

  const checks = useMemo(() => checkBtpMentions(quote, org), [quote, org])
  const summary = useMemo(() => countMissingByCategory(checks), [checks])
  const missing = checks.filter(c => c.missing)
  const ok = checks.filter(c => !c.missing)

  const groups = useMemo(() => {
    const cats = Object.keys(CATEGORY_LABELS) as BtpMentionCategory[]
    return cats
      .map(cat => ({
        cat,
        label: CATEGORY_LABELS[cat],
        missing: missing.filter(c => c.category === cat),
        ok: showAll ? ok.filter(c => c.category === cat) : [],
      }))
      .filter(g => g.missing.length > 0 || g.ok.length > 0)
  }, [missing, ok, showAll])

  if (summary.total === 0) {
    return <p className={styles.note} role="status">Toutes les mentions contrôlées sont validées.</p>
  }

  return (
    <div className={styles.stack}>
      <p className={styles.note}>
        {summary.bloquant > 0 && <>{summary.bloquant} bloquante{summary.bloquant > 1 ? 's' : ''}</>}
        {summary.bloquant > 0 && summary.important > 0 && ' · '}
        {summary.important > 0 && <>{summary.important} importante{summary.important > 1 ? 's' : ''}</>}
        {summary.bloquant === 0 && summary.important === 0 && 'Quelques mentions facultatives à compléter.'}
      </p>
      {groups.map(g => (
        <ListGroup key={g.cat} title={g.label}>
          {g.missing.map(c => (
            <ListRow
              key={c.id}
              title={c.label}
              description={c.detail}
              trailing={
                <span className={`${styles.pill} ${c.severity === 'bloquant' ? styles.pillWarn : ''}`}>
                  {c.severity === 'bloquant' ? 'Bloquant' : 'À compléter'}
                </span>
              }
            />
          ))}
          {g.ok.map(c => (
            <ListRow
              key={c.id}
              title={c.label}
              description={c.detail}
              trailing={<span className={`${styles.pill} ${styles.pillGood}`}>Validée</span>}
            />
          ))}
        </ListGroup>
      ))}
      {ok.length > 0 && (
        <div className={styles.actions}>
          <Button variant="text" size="md" onClick={() => setShowAll(v => !v)}>
            {showAll ? 'Masquer les mentions validées' : `Voir les ${ok.length} mentions validées`}
          </Button>
        </div>
      )}
    </div>
  )
}
