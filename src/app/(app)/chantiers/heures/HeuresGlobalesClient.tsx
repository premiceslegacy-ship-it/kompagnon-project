'use client'
// @atelier-migrated

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Menu, type MenuItem } from '@/components/ui/Menu'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { DateRow } from '../FormRows'
import { fmtHours } from '../chantiersModel'
import { ManualSheet, MissingSheet, PersonSheet, ReportsSheet } from './HeuresSheets'
import { useHeures, type HeuresProps } from './useHeures'
import screen from '@/components/layout/Screen.module.css'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'
import docs from '../../finances/Documents.module.css'
import planning from '../planning/Planning.module.css'
import fiche from '../[chantierId]/ChantierFiche.module.css'

const NB = ' '

export default function HeuresGlobalesClient(props: HeuresProps) {
  const { individualMembers = [], chantiers = [], canManage = false, missingSlots = [], initialPointages } = props
  const q = useHeures(props)
  const [sheet, setSheet] = useState<'manual' | 'missing' | 'reports' | null>(null)
  const [personKey, setPersonKey] = useState<string | null>(null)
  const person = q.byPerson.find(p => p.key === personKey) ?? null
  const chantierLabel = q.chantiersFilter.find(([id]) => id === q.chantierId)?.[1] ?? 'Tous les chantiers'
  const userLabel = q.users.find(([k]) => k === q.userKey)?.[1] ?? 'Toutes les personnes'

  const menuItems: MenuItem[] = [
    ...(canManage && individualMembers.length > 0 ? [{ label: 'Pointer pour un membre', onSelect: () => setSheet('manual') }] : []),
    ...(canManage && initialPointages.length > 0 ? [{ label: 'Rapports d’heures PDF', onSelect: () => setSheet('reports') }] : []),
  ]

  return (
    <main className={screen.root}>
      <div className={screen.page}>
        <Link href="/chantiers" className={styles.back}>
          <ChevronLeft size={20} aria-hidden="true" />
          Chantiers
        </Link>
        <header className={screen.header}>
          <div>
            <p className={screen.kicker}>Vue globale par personne et par chantier</p>
            <h1 className={screen.title}>Heures pointées</h1>
          </div>
          <div className={styles.headerEnd}>
            <Menu title="Heures" items={menuItems} trigger={<button type="button" className={screen.round} aria-label="Plus d'options"><MoreHorizontal size={20} aria-hidden="true" /></button>} />
            {canManage && individualMembers.length > 0 && <Button size="md" onClick={() => setSheet('manual')}>Pointer</Button>}
          </div>
        </header>

        {canManage && missingSlots.length > 0 && (
          <button type="button" className={screen.alert} data-expired="true" onClick={() => setSheet('missing')}>
            <span>{missingSlots.length} pointage{missingSlots.length > 1 ? 's' : ''} à vérifier : des créneaux sont passés sans heures pointées.</span>
            <ChevronRight size={18} className={screen.chevron} aria-hidden="true" />
          </button>
        )}

        <div style={{ marginTop: 12 }}>
          <SegmentedControl
            fullWidth
            label="Période"
            options={[{ value: 'week', label: 'Semaine' }, { value: 'month', label: 'Mois' }, { value: 'custom', label: 'Personnalisé' }]}
            value={q.period}
            onChange={v => q.setPeriod(v as 'week' | 'month' | 'custom')}
          />
        </div>

        {q.period !== 'custom' ? (
          <div className={planning.nav}>
            <button type="button" className={screen.round} aria-label="Période précédente" disabled={q.stepDisabled(-1)} onClick={() => q.step(-1)}><ChevronLeft size={20} aria-hidden="true" /></button>
            <span className={planning.navLabel}>
              {q.periodLabel.charAt(0).toUpperCase() + q.periodLabel.slice(1)}
              {!q.atCurrent && <button type="button" className={planning.navToday} onClick={q.goCurrent}>{q.period === 'week' ? 'Cette semaine' : 'Ce mois-ci'}</button>}
            </span>
            <button type="button" className={screen.round} aria-label="Période suivante" disabled={q.stepDisabled(1)} onClick={() => q.step(1)}><ChevronRight size={20} aria-hidden="true" /></button>
          </div>
        ) : (
          <div className={styles.fields} style={{ marginTop: 12 }}>
            <DateRow label="Du" value={q.customFrom} onChange={q.setCustomFrom} />
            <DateRow label="Au" value={q.customTo} onChange={q.setCustomTo} />
          </div>
        )}

        <div className={docs.chips}>
          <Menu
            title="Chantier"
            items={[['', 'Tous les chantiers'], ...q.chantiersFilter].map(([id, title]) => ({ label: title, checked: q.chantierId === id, onSelect: () => q.setChantierId(id) }))}
            trigger={<button type="button" className={docs.chip} data-on={q.chantierId ? 'true' : 'false'}>{chantierLabel}<ChevronDown size={14} aria-hidden="true" /></button>}
          />
          <Menu
            title="Personne"
            items={[['', 'Toutes les personnes'], ...q.users].map(([k, name]) => ({ label: name, checked: q.userKey === k, onSelect: () => q.setUserKey(k) }))}
            trigger={<button type="button" className={docs.chip} data-on={q.userKey ? 'true' : 'false'}>{userLabel}<ChevronDown size={14} aria-hidden="true" /></button>}
          />
        </div>

        <p className={planning.stats}>
          {fmtHours(q.totalHours)} · {q.byPerson.length}{NB}personne{q.byPerson.length > 1 ? 's' : ''} · {q.byChantier.length}{NB}chantier{q.byChantier.length > 1 ? 's' : ''} · {q.filtered.length}{NB}pointage{q.filtered.length > 1 ? 's' : ''}
        </p>

        <div className={styles.stack} style={{ marginTop: 16 }}>
          {q.filtered.length === 0 ? (
            <EmptyState title="Aucun pointage sur cette période" description="Changez de période ou de filtre." />
          ) : (
            <>
              <ListGroup title="Par personne">
                {q.byPerson.map(p => (
                  <ListRow
                    key={p.key}
                    leading={<Avatar name={p.name} />}
                    title={p.name}
                    description={`${p.chantierIds.size}${NB}chantier${p.chantierIds.size > 1 ? 's' : ''}`}
                    trailing={<span className={styles.trailStack}><span className={styles.amount}>{fmtHours(p.hours)}</span><span className={fiche.kpiSub}>{Math.round((p.hours / q.totalHours) * 100)}{NB}%</span></span>}
                    onClick={() => setPersonKey(p.key)}
                  />
                ))}
              </ListGroup>
              <ListGroup title="Par chantier">
                {q.byChantier.map(c => (
                  <ListRow
                    key={c.id}
                    href={`/chantiers/${c.id}`}
                    title={c.title}
                    description={`${c.memberKeys.size}${NB}personne${c.memberKeys.size > 1 ? 's' : ''}`}
                    trailing={<span className={styles.trailStack}><span className={styles.amount}>{fmtHours(c.hours)}</span><span className={fiche.kpiSub}>{Math.round((c.hours / q.totalHours) * 100)}{NB}%</span></span>}
                  />
                ))}
              </ListGroup>
            </>
          )}
        </div>
      </div>

      {person && <PersonSheet person={person} canManage={canManage} onClose={() => setPersonKey(null)} />}
      {sheet === 'manual' && <ManualSheet members={individualMembers} chantiers={chantiers} onClose={() => setSheet(null)} />}
      {sheet === 'missing' && <MissingSheet slots={missingSlots} individualMembers={individualMembers} onClose={() => setSheet(null)} />}
      {sheet === 'reports' && <ReportsSheet pointages={initialPointages} individualMembers={individualMembers} onClose={() => setSheet(null)} />}
    </main>
  )
}
