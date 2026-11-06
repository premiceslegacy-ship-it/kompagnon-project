'use client'
// @atelier-migrated
// Entreprise : barre « Enregistrer » commune aux trois écrans, visible seulement quand quelque chose a changé.

import { Dock } from '@/components/ui/Dock'
import type { SettingsState } from './useSettings'
import screen from '@/components/layout/Screen.module.css'

export default function OrgSaveDock({ q }: { q: SettingsState }) {
  const saving = q.orgSaveStatus === 'saving'
  return (
    <>
      {q.orgErrorMessage && <p className={screen.error} role="alert">{q.orgErrorMessage}</p>}
      {q.orgSaveStatus === 'saved' && !q.orgIsDirty && <p className={screen.ok} role="status">Modifications enregistrées.</p>}
      {(q.orgIsDirty || saving) && (
        <Dock totalLabel="Entreprise" total="Modifié" actionLabel="Enregistrer" onAction={q.handleSaveOrganization} loading={saving} disabled={q.isPending} />
      )}
    </>
  )
}
