'use client'
// @atelier-migrated
// Rôles et permissions : un rôle à la fois, ses droits regroupés par catégorie, enregistrés ensemble.

import { useEffect, useState } from 'react'
import { Dock } from '@/components/ui/Dock'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import { Switch } from '@/components/ui/Switch'
import { categoryLabel, permissionLabel } from '@/lib/permissions/labels'
import { groupPermissions, permissionSummary, permissionsChanged, type PermissionGroup } from './equipeModel'
import type { SettingsState } from './useSettings'
import screen from '@/components/layout/Screen.module.css'
import local from './Settings.module.css'

function CategorySheet({ q, group, onClose }: { q: SettingsState; group: PermissionGroup | null; onClose: () => void }) {
  const enabled = q.localPerms[q.selectedRoleId]
  return (
    <Sheet open={group !== null} onOpenChange={o => { if (!o) onClose() }} title={group ? categoryLabel(group.category) : 'Droits'} cancelLabel="Fermer">
      {group && (
        <ListGroup description="Les modifications sont enregistrées avec le bouton de l’écran précédent.">
          {group.perms.map(perm => (
            <ListRow
              key={perm.key}
              title={permissionLabel(perm.key, perm.label)}
              trailing={<Switch label={permissionLabel(perm.key, perm.label)} checked={enabled?.[perm.key] ?? false} onChange={() => q.togglePerm(q.selectedRoleId, perm.key)} />}
            />
          ))}
        </ListGroup>
      )}
    </Sheet>
  )
}

export default function RolesView({ q }: { q: SettingsState }) {
  const roles = q.rolesWithPermissions.roles
  const selected = roles.find(r => r.id === q.selectedRoleId)
  const isOwnerRole = selected?.slug === 'owner'
  const groups = groupPermissions(q.rolesWithPermissions.allPermissions)
  const [openGroup, setOpenGroup] = useState<PermissionGroup | null>(null)

  // Droits enregistrés, par rôle : la barre « Enregistrer » n'apparaît que si le rôle affiché a changé.
  const [saved, setSaved] = useState<Record<string, Record<string, boolean>>>(() => structuredClone(q.localPerms))
  useEffect(() => {
    if (q.permSaveStatus === 'saved') setSaved(prev => ({ ...prev, [q.selectedRoleId]: { ...q.localPerms[q.selectedRoleId] } }))
  }, [q.permSaveStatus]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !isOwnerRole && permissionsChanged(saved[q.selectedRoleId], q.localPerms[q.selectedRoleId])
  const saving = q.permSaveStatus === 'saving'

  return (
    <div className={local.detail}>
      <div className={local.sections}>
        <div>
          <SegmentedControl
            label="Rôle"
            value={q.selectedRoleId}
            onChange={q.setSelectedRoleId}
            options={roles.map(r => ({ value: r.id, label: r.name }))}
          />
          <p className={screen.note} style={{ marginTop: 12 }}>Les modifications s’appliquent à tous les membres ayant ce rôle.</p>
        </div>

        {isOwnerRole && (
          <ListGroup>
            <ListRow title="Accès complet" description="Le dirigeant a accès à toutes les fonctionnalités : ses droits ne peuvent pas être modifiés." />
          </ListGroup>
        )}

        {selected && !isOwnerRole && (
          <ListGroup title={`Droits du rôle « ${selected.name} »`}>
            {groups.map(group => (
              <ListRow
                key={group.category}
                title={categoryLabel(group.category)}
                description={permissionSummary(group.perms, q.localPerms[q.selectedRoleId])}
                onClick={() => setOpenGroup(group)}
              />
            ))}
          </ListGroup>
        )}
      </div>

      {(dirty || saving) && (
        <Dock totalLabel="Rôle" total={selected?.name ?? ''} actionLabel="Enregistrer" onAction={q.handleSavePermissions} loading={saving} />
      )}
      {q.permSaveStatus === 'error' && <p className={screen.error} role="alert">Les permissions n’ont pas pu être enregistrées.</p>}
      <CategorySheet q={q} group={openGroup} onClose={() => setOpenGroup(null)} />
    </div>
  )
}
