'use client'
// @atelier-migrated
// Jalons d'acompte : pourcentages, tâches rattachées, rapport de fin, facture d'acompte.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import AICreditsErrorModal from '@/components/shared/AICreditsErrorModal'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { CheckRow, ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Field } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { StatusPill, type StatusPillStatus } from '@/components/ui/StatusPill'
import { formatCurrency } from '@/components/shared'
import { AI_NAME } from '@/lib/brand'
import type { ChantierJalon } from '@/lib/data/queries/chantier-jalons'
import type { Tache } from '@/lib/data/queries/chantiers'
import { createJalon, updateJalon, deleteJalon, completeJalon, generateJalonInvoice, assignTasksToJalon } from '@/lib/data/mutations/chantier-jalons'
import screen from '@/components/layout/Screen.module.css'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'
import fiche from './ChantierFiche.module.css'

const NB = ' '

const STATUS: Record<ChantierJalon['status'], { label: string; pill: StatusPillStatus }> = {
  pending: { label: 'À venir', pill: 'neutral' },
  in_progress: { label: 'En cours', pill: 'wait' },
  completed: { label: 'Complété', pill: 'success' },
  invoiced: { label: 'Facturé', pill: 'success' },
}

type AiSuggestion = { title: string; acompte_pct: number; description: string; tasks: Array<{ title: string }> }

/** Un jalon : titre, pourcentage, tâches, validation avec rapport, facture. */
function JalonSheet({ jalon, budgetHt, chantierId, allTaches, onUpdated, onDeleted, onClose }: {
  jalon: ChantierJalon
  budgetHt: number
  chantierId: string
  allTaches: Tache[]
  onUpdated: (id: string, patch: Partial<ChantierJalon>) => void
  onDeleted: (id: string) => void
  onClose: () => void
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [title, setTitle] = useState(jalon.title)
  const [pct, setPct] = useState(String(jalon.acompte_pct))
  const [desc, setDesc] = useState(jalon.description ?? '')
  const [report, setReport] = useState(jalon.completion_report ?? '')
  const [taskIds, setTaskIds] = useState(() => new Set(jalon.taches.map(t => t.id)))
  const [loading, setLoading] = useState(false)
  const [action, setAction] = useState<'none' | 'complete' | 'invoice' | 'delete'>('none')
  const [err, setErr] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const amount = budgetHt > 0 ? (budgetHt * jalon.acompte_pct) / 100 : 0
  const locked = jalon.status === 'invoiced'

  async function save() {
    const value = parseFloat(pct)
    if (isNaN(value) || value < 0 || value > 100) { setErr('Pourcentage invalide.'); return }
    setLoading(true)
    const { error } = await updateJalon(jalon.id, { title, acomptePct: value, description: desc || null })
    if (error) { setLoading(false); setErr(error); return }
    onUpdated(jalon.id, { title, acompte_pct: value, description: desc || null })
    const before = new Set(jalon.taches.map(t => t.id))
    const changed = before.size !== taskIds.size || [...taskIds].some(id => !before.has(id))
    if (changed) {
      await assignTasksToJalon(jalon.id, Array.from(taskIds), chantierId)
      const unselected = jalon.taches.filter(t => !taskIds.has(t.id)).map(t => t.id)
      if (unselected.length) await assignTasksToJalon(null, unselected, chantierId)
      startTransition(() => router.refresh())
    }
    setLoading(false)
    onClose()
  }

  async function complete() {
    if (!report.trim()) { setErr('Le rapport est requis pour valider le jalon.'); return }
    setAction('complete')
    const { error } = await completeJalon(jalon.id, report.trim())
    setAction('none')
    if (error) { setErr(error); return }
    onUpdated(jalon.id, { status: 'completed', completion_report: report.trim() })
    onClose()
  }

  async function invoice() {
    setAction('invoice')
    setErr(null)
    const { invoiceId, error } = await generateJalonInvoice(jalon.id)
    setAction('none')
    if (error) { setErr(error); return }
    onUpdated(jalon.id, { status: 'invoiced', invoice_id: invoiceId })
    if (invoiceId) router.push(`/finances/invoice-editor?${new URLSearchParams({ id: invoiceId, returnTo: `/chantiers/${chantierId}` })}`)
  }

  async function remove() {
    setAction('delete')
    const { error } = await deleteJalon(jalon.id)
    setAction('none')
    setConfirmDelete(false)
    if (error) { setErr(error); return }
    onDeleted(jalon.id)
    onClose()
  }

  return (
    <>
      <Sheet
        open
        onOpenChange={o => { if (!o && !confirmDelete) onClose() }}
        title="Jalon d’acompte"
        description={`${STATUS[jalon.status].label}${amount > 0 ? ` · ${formatCurrency(amount)}${NB}HT` : ''}`}
        confirmLabel={locked ? undefined : 'Enregistrer'}
        onConfirm={locked ? undefined : save}
        confirmLoading={loading}
        cancelLabel={locked ? 'Fermer' : 'Annuler'}
      >
        <div className={styles.stack}>
          <div className={styles.fields}>
            <Field type="text" label="Titre" value={title} onChange={e => setTitle(e.target.value)} disabled={locked} />
            <Field type="text" label="Acompte (%)" inputMode="decimal" value={pct} onChange={e => setPct(e.target.value)} disabled={locked} />
            <Field type="text" label="Description" placeholder="Facultatif" value={desc} onChange={e => setDesc(e.target.value)} disabled={locked} />
          </div>

          {allTaches.length > 0 && !locked && (
            <ListGroup title="Tâches dans ce jalon" description={`${jalon.taches_done} sur ${jalon.taches_total} terminées.`}>
              {allTaches.map(t => (
                <CheckRow
                  key={t.id}
                  title={t.title}
                  checked={taskIds.has(t.id)}
                  onCheckedChange={checked => setTaskIds(prev => {
                    const next = new Set(prev)
                    if (checked) next.add(t.id)
                    else next.delete(t.id)
                    return next
                  })}
                />
              ))}
            </ListGroup>
          )}

          {jalon.status !== 'invoiced' && jalon.status !== 'completed' && (
            <Field type="textarea" label="Rapport d’avancement" placeholder="Décrivez ce qui a été réalisé dans ce jalon…" hint="Requis pour valider le jalon." value={report} onChange={e => setReport(e.target.value)} />
          )}
          {jalon.completion_report && jalon.status !== 'pending' && <p className={styles.requestText}>« {jalon.completion_report} »</p>}

          <ListGroup>
            {jalon.status !== 'invoiced' && jalon.status !== 'completed' && (
              <ListRow title={action === 'complete' ? 'Validation…' : 'Marquer complété'} description="Enregistre le rapport et ouvre la facturation." onClick={complete} disabled={action !== 'none'} />
            )}
            {jalon.status === 'completed' && !jalon.invoice_id && (
              <ListRow title={action === 'invoice' ? 'Génération…' : 'Générer la facture'} onClick={invoice} disabled={action !== 'none'} />
            )}
            {jalon.status === 'invoiced' && jalon.invoice_id && (
              <ListRow title="Voir la facture" href={`/finances/invoice-editor?${new URLSearchParams({ id: jalon.invoice_id, returnTo: `/chantiers/${chantierId}` })}`} />
            )}
            {!locked && (
              <li className={styles.destructiveRow}>
                <button type="button" onClick={() => setConfirmDelete(true)}>Supprimer le jalon</button>
              </li>
            )}
          </ListGroup>
          {err && <p className={screen.error} role="alert">{err}</p>}
        </div>
      </Sheet>
      <AlertDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Supprimer « ${jalon.title} » ?`}
        description="Le jalon sera retiré de l’échéancier d’acompte."
        confirmLabel="Supprimer"
        confirmLoading={action === 'delete'}
        onConfirm={remove}
      />
    </>
  )
}

export default function JalonsSection({ initialJalons, chantierId, budgetHt, taches }: {
  initialJalons: ChantierJalon[]
  chantierId: string
  budgetHt: number
  taches: Tache[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [jalons, setJalons] = useState(initialJalons)
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newPct, setNewPct] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [addErr, setAddErr] = useState<string | null>(null)
  const [addLoading, setAddLoading] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiCreditsError, setAiCreditsError] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[] | null>(null)
  const [aiErr, setAiErr] = useState<string | null>(null)
  const [creatingFromAi, setCreatingFromAi] = useState(false)

  const totalPct = jalons.reduce((s, j) => s + j.acompte_pct, 0)
  const remainingPct = 100 - totalPct
  const open = jalons.find(j => j.id === openId) ?? null

  async function handleAdd() {
    const pct = parseFloat(newPct)
    if (!newTitle.trim()) { setAddErr('Titre requis.'); return }
    if (isNaN(pct) || pct <= 0 || pct > 100) { setAddErr('Pourcentage invalide (1–100).'); return }
    if (totalPct + pct > 100) { setAddErr(`Dépasse 100 % (il reste ${remainingPct.toFixed(0)} %).`); return }
    setAddLoading(true)
    const { jalonId, error } = await createJalon(chantierId, { title: newTitle.trim(), acomptePct: pct, description: newDesc.trim() || null })
    setAddLoading(false)
    if (error || !jalonId) { setAddErr(error ?? 'Erreur'); return }
    setJalons(prev => [...prev, {
      id: jalonId, chantier_id: chantierId, position: prev.length, title: newTitle.trim(), acompte_pct: pct,
      description: newDesc.trim() || null, status: 'pending', completion_report: null, completed_at: null,
      invoice_id: null, created_at: new Date().toISOString(), taches: [], taches_total: 0, taches_done: 0,
    }])
    setNewTitle(''); setNewPct(''); setNewDesc('')
    setAdding(false); setAddErr(null)
  }

  async function handleAiSuggest() {
    setAiLoading(true); setAiErr(null); setAiSuggestions(null)
    try {
      const res = await fetch('/api/ai/suggest-jalons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chantierId }) })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 402) { setAiCreditsError(true); return }
        setAiErr(data.error ?? 'Erreur de l’assistante'); return
      }
      setAiSuggestions(data)
    } catch {
      setAiErr('Impossible de contacter l’assistante.')
    } finally {
      setAiLoading(false)
    }
  }

  async function handleCreateFromAi() {
    if (!aiSuggestions) return
    setCreatingFromAi(true)
    for (let i = 0; i < aiSuggestions.length; i++) {
      const s = aiSuggestions[i]
      await createJalon(chantierId, { title: s.title, acomptePct: s.acompte_pct, description: s.description || null, position: i })
    }
    setCreatingFromAi(false)
    setAiSuggestions(null)
    startTransition(() => router.refresh())
  }

  const first = jalons[0]
  const notice = totalPct > 100
    ? 'La somme des acomptes dépasse 100 %. Ajustez les pourcentages.'
    : first && first.acompte_pct < 30
      ? `Le premier jalon (${first.acompte_pct} %) est sous les 30 % habituellement demandés à la signature.`
      : null

  return (
    <>
      {aiCreditsError && <AICreditsErrorModal onClose={() => setAiCreditsError(false)} />}
      {notice && <p className={screen.alert} data-expired={totalPct > 100}><span>{notice}</span></p>}
      <ListGroup
        title={`Jalons d’acompte${jalons.length ? ` · ${totalPct.toFixed(0)}${NB}% alloué` : ''}`}
        description="Les jalons structurent la facturation par étapes."
      >
        {jalons.map(j => (
          <ListRow
            key={j.id}
            title={j.title}
            description={`${j.acompte_pct}${NB}%${budgetHt > 0 ? ` · ${formatCurrency((budgetHt * j.acompte_pct) / 100)}${NB}HT` : ''}${j.taches_total ? ` · ${j.taches_done}/${j.taches_total} tâches` : ''}`}
            trailing={<StatusPill status={STATUS[j.status].pill}>{STATUS[j.status].label}</StatusPill>}
            onClick={() => setOpenId(j.id)}
          />
        ))}
        <ListRow title="Ajouter un jalon" className={fiche.linkRow} onClick={() => setAdding(true)} />
        {jalons.length === 0 && (
          <ListRow
            title={aiLoading ? 'Analyse en cours…' : `Proposer des jalons avec ${AI_NAME}`}
            leading={<Sparkles size={18} aria-hidden="true" />}
            disabled={aiLoading}
            onClick={handleAiSuggest}
          />
        )}
      </ListGroup>
      {aiErr && <p className={screen.error} role="alert">{aiErr}</p>}

      {open && (
        <JalonSheet
          jalon={open}
          budgetHt={budgetHt}
          chantierId={chantierId}
          allTaches={taches}
          onUpdated={(id, patch) => setJalons(prev => prev.map(j => j.id === id ? { ...j, ...patch } : j))}
          onDeleted={id => setJalons(prev => prev.filter(j => j.id !== id))}
          onClose={() => setOpenId(null)}
        />
      )}

      {adding && (
        <Sheet
          open
          onOpenChange={o => { if (!o) { setAdding(false); setAddErr(null) } }}
          title="Nouveau jalon"
          description={remainingPct > 0 ? `Il reste ${remainingPct.toFixed(0)}${NB}% à allouer.` : undefined}
          confirmLabel="Ajouter"
          confirmLoading={addLoading}
          onConfirm={handleAdd}
        >
          <div className={styles.stack}>
            <div className={styles.fields}>
              <Field type="text" label="Titre" placeholder="Acompte à la commande" value={newTitle} onChange={e => setNewTitle(e.target.value)} />
              <Field type="text" label="Acompte (%)" inputMode="decimal" placeholder="30" value={newPct} onChange={e => setNewPct(e.target.value)} />
              <Field type="text" label="Description" placeholder="Facultatif" value={newDesc} onChange={e => setNewDesc(e.target.value)} />
            </div>
            {addErr && <p className={screen.error} role="alert">{addErr}</p>}
          </div>
        </Sheet>
      )}

      {aiSuggestions && (
        <Sheet
          open
          onOpenChange={o => { if (!o) setAiSuggestions(null) }}
          title="Jalons proposés"
          description={`Total : ${aiSuggestions.reduce((s, j) => s + j.acompte_pct, 0)}${NB}%${aiSuggestions.reduce((s, j) => s + j.acompte_pct, 0) !== 100 ? ' · à ajuster ensuite' : ''}`}
          confirmLabel="Créer ces jalons"
          confirmLoading={creatingFromAi}
          onConfirm={handleCreateFromAi}
        >
          <ListGroup>
            {aiSuggestions.map((s, i) => (
              <ListRow
                key={i}
                title={s.title}
                description={[s.description, s.tasks?.length ? `${s.tasks.length} tâche${s.tasks.length > 1 ? 's' : ''}` : null].filter(Boolean).join(' · ') || undefined}
                trailing={<span className={styles.amount}>{s.acompte_pct}{NB}%</span>}
              />
            ))}
          </ListGroup>
        </Sheet>
      )}
    </>
  )
}
