'use client'
// @atelier-migrated

import Link from 'next/link'
import { ChevronLeft, MoreHorizontal } from 'lucide-react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Menu } from '@/components/ui/Menu'
import MemberGoalsSettings from '@/app/(app)/settings/MemberGoalsSettings'
import { AppRateSheet, EquipeSheet, ExistingSheet, MembreSheet } from './EquipesSheets'
import { fullName } from './equipesModel'
import { useEquipes, type EquipesProps } from './useEquipes'
import screen from '@/components/layout/Screen.module.css'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'
import fiche from '../[chantierId]/ChantierFiche.module.css'

const NB = ' '

export default function EquipesClient(props: EquipesProps) {
  const { equipes, soloMembers, orgRoles, canManageTeam, canEditRates, canEditGoals, memberGoals, currentUserId } = props
  const q = useEquipes(props)
  const total = equipes.reduce((s, e) => s + e.membres.length, 0) + soloMembers.length
  const available = q.showAddExistant ? q.membresDispo(q.showAddExistant) : []
  const rate = (taux: number | null | undefined) => (canEditRates && taux != null ? ` · ${taux}${NB}€/h` : '')

  return (
    <main className={screen.root}>
      <div className={screen.page}>
        <Link href="/chantiers" className={styles.back}>
          <ChevronLeft size={20} aria-hidden="true" />
          Chantiers
        </Link>
        <header className={screen.header}>
          <div>
            <p className={screen.kicker}>{equipes.length}{NB}équipe{equipes.length > 1 ? 's' : ''} · {total}{NB}intervenant{total > 1 ? 's' : ''}</p>
            <h1 className={screen.title}>Équipes</h1>
          </div>
          {canManageTeam && (
            <div className={styles.headerEnd}>
              <Menu title="Équipes" items={[{ label: 'Nouvel intervenant', onSelect: q.openNewSolo }]} trigger={<button type="button" className={screen.round} aria-label="Plus d'options"><MoreHorizontal size={20} aria-hidden="true" /></button>} />
              <Button size="md" onClick={q.openCreateEquipe}>Nouvelle équipe</Button>
            </div>
          )}
        </header>
        <p className={screen.note} style={{ margin: '0 4px 8px' }}>Une équipe regroupe des intervenants pour le planning et les pointages ; un intervenant solo n’appartient à aucune équipe.</p>
        {q.error && !q.membreModal && !q.equipeModal && <p className={screen.error} role="alert">{q.error}</p>}

        <div className={styles.stack}>
          {equipes.length === 0 && soloMembers.length === 0 && (
            canManageTeam
              ? <EmptyState title="Aucune équipe pour le moment" description="Créez une équipe pour organiser votre personnel sur les chantiers." actionLabel="Nouvelle équipe" onAction={q.openCreateEquipe} />
              : <EmptyState title="Aucune équipe pour le moment" description="Aucune équipe n’a encore été créée." />
          )}

          {equipes.map(equipe => (
            <ListGroup
              key={equipe.id}
              title={equipe.name}
              description={equipe.description ?? undefined}
              action={canManageTeam ? (
                <Menu
                  title={equipe.name}
                  items={[
                    { label: 'Modifier l’équipe', onSelect: () => q.openEditEquipe(equipe) },
                    { label: 'Supprimer l’équipe', destructive: true, onSelect: () => q.setConfirmDelete({ type: 'equipe', id: equipe.id, label: equipe.name }) },
                  ]}
                  trigger={<button type="button" className={fiche.iconButton} aria-label={`Actions de l’équipe ${equipe.name}`}><MoreHorizontal size={18} aria-hidden="true" /></button>}
                />
              ) : undefined}
            >
              {equipe.membres.map(m => {
                const props = { leading: <Avatar name={fullName(m)} />, title: fullName(m), description: `${m.role_label ?? 'Intervenant'}${rate(m.taux_horaire)}${m.profile_id ? '' : ' · externe'}` }
                return canManageTeam ? <ListRow key={m.id} {...props} onClick={() => q.openEditMembre(m)} /> : <ListRow key={m.id} {...props} />
              })}
              {equipe.membres.length === 0 && <ListRow title="Aucun membre" description="Ajoutez des intervenants à cette équipe." />}
              {canManageTeam && <ListRow title="Nouveau membre" className={fiche.linkRow} onClick={() => q.openNewInEquipe(equipe.id)} />}
              {canManageTeam && q.membresDispo(equipe.id).length > 0 && <ListRow title="Ajouter un intervenant existant" className={fiche.linkRow} onClick={() => { q.setShowAddExistant(equipe.id); q.setSelectedExistant('') }} />}
            </ListGroup>
          ))}

          {(soloMembers.length > 0 || canManageTeam) && (
            <ListGroup title="Intervenants solo" description="Ils ne font partie d’aucune équipe. Un lien d’espace membre leur permet de pointer sans compte.">
              {soloMembers.map(m => {
                const props = { leading: <Avatar name={fullName(m)} />, title: fullName(m), description: `${m.role_label ?? 'Intervenant'}${rate(m.taux_horaire)}${q.inviteSent.has(m.id) ? ' · invitation envoyée' : ''}` }
                return canManageTeam ? <ListRow key={m.id} {...props} onClick={() => q.openEditMembre(m)} /> : <ListRow key={m.id} {...props} />
              })}
              {canManageTeam && <ListRow title="Nouvel intervenant" className={fiche.linkRow} onClick={q.openNewSolo} />}
            </ListGroup>
          )}

          {q.appMembersState.length > 0 && (
            <ListGroup title={`Comptes de l’application · ${q.appMembersState.length}`} description={canEditRates ? 'Touchez un compte pour régler son taux horaire.' : undefined}>
              {q.appMembersState.map(m => {
                const props = { leading: <Avatar name={m.full_name ?? m.email} />, title: m.full_name ?? m.email, description: `${m.job_title ?? m.role_name}${canEditRates ? ` · ${m.labor_cost_per_hour != null ? `${m.labor_cost_per_hour}${NB}€/h` : 'taux non défini'}` : ''}` }
                return canEditRates ? <ListRow key={m.membership_id} {...props} onClick={() => q.startEditAppMember(m)} /> : <ListRow key={m.membership_id} {...props} />
              })}
            </ListGroup>
          )}

          {canEditGoals && (soloMembers.length > 0 || props.appMembers.length > 0) && (
            <section aria-label="Objectifs des membres">
              <MemberGoalsSettings intervenants={soloMembers} orgMembers={q.appMembersState} initialGoals={memberGoals} currentUserId={currentUserId} />
            </section>
          )}
        </div>
      </div>

      <MembreSheet q={q} orgRoles={orgRoles} />
      <EquipeSheet q={q} />
      {q.showAddExistant && <ExistingSheet q={q} equipeId={q.showAddExistant} available={available} />}
      <AppRateSheet q={q} />
      <AlertDialog
        open={q.confirmDelete !== null}
        onOpenChange={o => { if (!o) q.setConfirmDelete(null) }}
        title={`Supprimer « ${q.confirmDelete?.label ?? ''} » ?`}
        description={q.confirmDelete?.type === 'equipe' ? 'Les membres sont conservés comme intervenants solo.' : 'L’intervenant et ses pointages associés seront supprimés définitivement.'}
        confirmLabel="Supprimer"
        confirmLoading={q.saving}
        onConfirm={() => {
          const c = q.confirmDelete
          if (!c) return
          if (c.type === 'equipe') q.handleDeleteEquipe(c.id)
          else if (c.soloMembre) q.handleDeleteSoloMembre(c.id)
          else q.handleDeleteEquipeMembre(c.id)
        }}
      />
    </main>
  )
}
