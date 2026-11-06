'use client'
// @atelier-migrated
// Pointages du chantier : total par personne, saisie, détail, rapports d'heures PDF.

import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Avatar } from '@/components/ui/Avatar'
import { CheckRow, ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Field } from '@/components/ui/Field'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import type { Pointage } from '@/lib/data/queries/chantiers'
import { DateRow } from '../FormRows'
import { fmtHours } from '../chantiersModel'
import { reportRange } from '../heures/heuresModel'
import type { ChantierDetailState } from './useChantierDetail'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'
import fiche from './ChantierFiche.module.css'

const NB = ' '
const submitEvent = { preventDefault() {} } as unknown as React.SyntheticEvent

type Group = { key: string; name: string; total: number; entries: Pointage[] }

function groupPointages(pointages: Pointage[]): Group[] {
  const map = new Map<string, Group>()
  for (const p of pointages) {
    const key = p.user_id ?? `m_${p.member_id}`
    const g = map.get(key)
    if (g) { g.total += p.hours; g.entries.push(p) }
    else map.set(key, { key, name: p.user_name, total: p.hours, entries: [p] })
  }
  return [...map.values()].sort((a, b) => b.total - a.total)
}

/** Saisie d'un pointage pour soi ou pour une équipe présente. */
function PointageSheet({ q, onClose }: { q: ChantierDetailState; onClose: () => void }) {
  const equipe = q.selectedPointageEquipe
  const team = q.ptMode === 'team'
  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) onClose() }}
      title="Pointer des heures"
      confirmLabel="Enregistrer"
      confirmLoading={q.ptLoading}
      confirmDisabled={!q.ptDate || !(Number(q.ptHoursInt) > 0 || Number(q.ptMinutes) > 0) || (team && q.ptPresentMemberIds.size === 0)}
      onConfirm={async () => { await q.handleAddPointage(submitEvent); onClose() }}
    >
      <div className={styles.stack}>
        {q.canManagePointages && q.initialChantierEquipes.length > 0 && (
          <SegmentedControl
            fullWidth
            label="Pour qui"
            options={[{ value: 'me', label: 'Moi' }, { value: 'team', label: 'Équipe' }]}
            value={q.ptMode}
            onChange={v => q.setPtMode(v as 'me' | 'team')}
          />
        )}
        {team && (
          <>
            <Field
              type="select"
              label="Équipe concernée"
              value={q.ptEquipeId}
              onChange={e => {
                const id = e.target.value
                q.setPtEquipeId(id)
                q.setPtPresentMemberIds(new Set(q.initialChantierEquipes.find(eq => eq.id === id)?.membres.map(m => m.id) ?? []))
              }}
            >
              {q.initialChantierEquipes.map(eq => <option key={eq.id} value={eq.id}>{eq.name} ({eq.membres.length} pers.)</option>)}
            </Field>
            {equipe && (
              <ListGroup title="Présents à pointer" description="Un pointage est créé pour chaque personne cochée, avec son taux horaire pour la rentabilité.">
                {equipe.membres.map(member => (
                  <CheckRow
                    key={member.id}
                    title={[member.prenom, member.name].filter(Boolean).join(' ') || member.name}
                    description={q.canEditRates && member.taux_horaire != null ? `${member.taux_horaire}${NB}€/h` : undefined}
                    checked={q.ptPresentMemberIds.has(member.id)}
                    onCheckedChange={() => q.setPtPresentMemberIds(prev => {
                      const next = new Set(prev)
                      if (next.has(member.id)) next.delete(member.id)
                      else next.add(member.id)
                      return next
                    })}
                  />
                ))}
              </ListGroup>
            )}
          </>
        )}
        <div className={styles.fields}>
          <DateRow label="Date" value={q.ptDate} onChange={q.setPtDate} />
          <DateRow label="Heure de début" type="time" value={q.ptStartTime} onChange={q.setPtStartTime} />
          <Field type="text" label="Heures" inputMode="numeric" placeholder="7" value={q.ptHoursInt} onChange={e => q.setPtHoursInt(e.target.value)} />
          <Field type="select" label="Minutes" value={q.ptMinutes} onChange={e => q.setPtMinutes(e.target.value)}>
            {Array.from({ length: 12 }, (_, i) => i * 5).map(m => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
          </Field>
          <Field type="select" label="Tâche" value={q.ptTacheId} onChange={e => q.setPtTacheId(e.target.value)}>
            <option value="">Aucune</option>
            {q.taches.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
          </Field>
          <Field type="text" label="Description" placeholder="Facultatif" value={q.ptDesc} onChange={e => q.setPtDesc(e.target.value)} />
        </div>
      </div>
    </Sheet>
  )
}

/** Détail des pointages d'une personne. */
function MemberHoursSheet({ q, group, onClose, onDelete }: { q: ChantierDetailState; group: Group; onClose: () => void; onDelete: (p: Pointage) => void }) {
  const sorted = [...group.entries].sort((a, b) => b.date.localeCompare(a.date))
  return (
    <Sheet open onOpenChange={o => { if (!o) onClose() }} title={group.name} description={`${fmtHours(group.total)} sur ${group.entries.length} pointage${group.entries.length > 1 ? 's' : ''}`} cancelLabel="Fermer">
      <ListGroup>
        {sorted.map(p => (
          <ListRow
            key={p.id}
            title={`${new Date(p.date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' })}${p.start_time ? ` · ${p.start_time.slice(0, 5)}` : ''}`}
            description={[p.tache_title, p.description].filter(Boolean).join(' · ') || undefined}
            trailing={
              <span className={styles.trailStack}>
                <span className={styles.amount}>{fmtHours(p.hours)}</span>
                {q.canManagePointages && (
                  <button type="button" className={fiche.iconButton} data-tone="danger" aria-label="Supprimer ce pointage" onClick={() => onDelete(p)}>
                    <Trash2 size={18} aria-hidden="true" />
                  </button>
                )}
              </span>
            }
          />
        ))}
      </ListGroup>
    </Sheet>
  )
}

/** Rapports d'heures par personne : mois ou année, puis téléchargement du PDF. */
function ReportsSheet({ q, onClose }: { q: ChantierDetailState; onClose: () => void }) {
  type ReportMember = { id: string; idType: 'member' | 'user'; fullName: string; roleLabel?: string | null }
  const now = new Date()
  const thisYear = now.getFullYear()
  const minYear = thisYear - 1
  const defaultSel = `${thisYear}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [current, setCurrent] = useState<ReportMember | null>(null)
  const [selection, setSelection] = useState(defaultSel)

  const members = useMemo<ReportMember[]>(() => {
    const seen = new Set<string>()
    const result: ReportMember[] = []
    for (const p of q.pointages) {
      if (p.member_id && !seen.has(p.member_id)) {
        seen.add(p.member_id)
        const info = q.initialIndividualMembers.find(m => m.id === p.member_id)
        result.push({ id: p.member_id, idType: 'member', fullName: info ? ([info.prenom, info.name].filter(Boolean).join(' ') || info.name) : p.user_name, roleLabel: info?.role_label })
      } else if (p.user_id && !seen.has(p.user_id)) {
        seen.add(p.user_id)
        result.push({ id: p.user_id, idType: 'user', fullName: p.user_name })
      }
    }
    return result.sort((a, b) => a.fullName.localeCompare(b.fullName, 'fr'))
  }, [q.pointages, q.initialIndividualMembers])

  const options = useMemo(() => {
    const opts: { value: string; label: string }[] = []
    for (let y = thisYear; y >= minYear; y--) {
      opts.push({ value: String(y), label: `Année ${y}` })
      for (let mo = 12; mo >= 1; mo--) {
        opts.push({ value: `${y}-${String(mo).padStart(2, '0')}`, label: new Date(y, mo - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) })
      }
    }
    return opts
  }, [thisYear, minYear])

  const download = (m: ReportMember) => {
    const { from, to } = reportRange(selection)
    const params = new URLSearchParams({ from, to, download: '1', type: m.idType })
    window.open(`/api/pdf/member/${m.id}?${params.toString()}`, '_blank')
  }

  return (
    <>
      <Sheet open onOpenChange={o => { if (!o) onClose() }} title="Rapports d’heures" description="Un PDF par personne, par mois ou par année." cancelLabel="Fermer">
        <ListGroup description={members.length === 0 ? 'Aucun pointage pour l’instant.' : undefined}>
          {members.map(m => (
            <ListRow key={m.id} leading={<Avatar name={m.fullName} />} title={m.fullName} description={m.roleLabel ?? undefined} onClick={() => { setSelection(defaultSel); setCurrent(m) }} />
          ))}
        </ListGroup>
      </Sheet>
      {current && (
        <Sheet open onOpenChange={o => { if (!o) setCurrent(null) }} title={current.fullName} confirmLabel="Télécharger le PDF" onConfirm={() => download(current)}>
          <Field type="select" label="Période" value={selection} onChange={e => setSelection(e.target.value)}>
            {options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </Field>
        </Sheet>
      )}
    </>
  )
}

export default function HoursSection({ q }: { q: ChantierDetailState }) {
  const [adding, setAdding] = useState(false)
  const [reports, setReports] = useState(false)
  const [groupKey, setGroupKey] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Pointage | null>(null)
  const groups = useMemo(() => groupPointages(q.pointages), [q.pointages])
  const group = groups.find(g => g.key === groupKey) ?? null
  const canAdd = q.canPointage || q.canManagePointages

  return (
    <>
      <ListGroup
        title={`Heures pointées${q.totalHours ? ` · ${fmtHours(q.totalHours)}` : ''}`}
        description={groups.length === 0 ? 'Aucun pointage. Les heures de l’équipe apparaîtront ici.' : undefined}
      >
        {groups.map(g => (
          <ListRow
            key={g.key}
            leading={<Avatar name={g.name} />}
            title={g.name}
            description={`${g.entries.length} pointage${g.entries.length > 1 ? 's' : ''}`}
            trailing={<span className={styles.amount}>{fmtHours(g.total)}</span>}
            onClick={() => setGroupKey(g.key)}
          />
        ))}
        {canAdd && <ListRow title="Pointer des heures" className={fiche.linkRow} onClick={() => setAdding(true)} />}
        {q.canManagePointages && q.pointages.length > 0 && (
          <ListRow title="Rapports d’heures par personne" description="Un PDF par mois" onClick={() => setReports(true)} />
        )}
      </ListGroup>

      {adding && <PointageSheet q={q} onClose={() => setAdding(false)} />}
      {reports && <ReportsSheet q={q} onClose={() => setReports(false)} />}
      {group && <MemberHoursSheet q={q} group={group} onClose={() => setGroupKey(null)} onDelete={p => { setGroupKey(null); setDeleting(p) }} />}
      <AlertDialog
        open={deleting !== null}
        onOpenChange={o => { if (!o) setDeleting(null) }}
        title="Supprimer ce pointage ?"
        description="Les heures seront retirées du chantier et de la rentabilité."
        confirmLabel="Supprimer"
        onConfirm={() => { if (deleting) q.handleDeletePointage(deleting); setDeleting(null) }}
      />
    </>
  )
}
