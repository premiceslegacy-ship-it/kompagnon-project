'use client'
// @atelier-migrated
// Entreprise : choix de l'activité de référence et des activités secondaires.

import { Check } from 'lucide-react'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Sheet } from '@/components/ui/Sheet'
import {
  BUSINESS_ACTIVITIES_BY_PROFILE, getSecondaryActivityOptions, normalizeSecondaryActivityIds, resolveBusinessSelection,
  type BusinessActivityId, type BusinessProfile,
} from '@/lib/catalog-context'
import type { SettingsState } from './useSettings'
import local from './Settings.module.css'

export type ActivityMode = 'primary' | 'secondary'

function Tick() {
  return <span className={local.tick}><Check size={18} aria-label="Sélectionnée" role="img" /></span>
}

export default function ActivitySheet({ q, mode, onClose }: { q: SettingsState; mode: ActivityMode | null; onClose: () => void }) {
  const current = q.companyDetails.business_activity as BusinessActivityId

  return (
    <Sheet
      open={mode !== null}
      onOpenChange={open => { if (!open) onClose() }}
      title={mode === 'secondary' ? 'Activités secondaires' : 'Activité de référence'}
      cancelLabel="Fermer"
    >
      {mode === 'primary' && (
        <div className={local.sheetBody}>
          {(Object.entries(BUSINESS_ACTIVITIES_BY_PROFILE) as Array<[BusinessProfile, typeof BUSINESS_ACTIVITIES_BY_PROFILE[BusinessProfile]]>).map(([profileKey, activities]) => {
            const profile = resolveBusinessSelection({ businessProfile: profileKey }).profileConfig
            const tier2 = activities.filter(a => a.tier === 2)
            const selectedIsSecondary = tier2.some(a => a.id === current)
            const expanded = (q.showSecondaryActivities[profileKey] ?? false) || selectedIsSecondary
            const visible = expanded ? activities : activities.filter(a => a.tier === 1)
            return (
              <ListGroup key={profileKey} title={profile.onboardingLabel}>
                {visible.map(activity => (
                  <ListRow
                    key={activity.id}
                    title={activity.label}
                    description={activity.description}
                    trailing={current === activity.id ? <Tick /> : undefined}
                    onClick={() => {
                      q.setSelectedSecondaryActivities(prev => normalizeSecondaryActivityIds(prev, activity.id))
                      q.setCompanyDetailsDirty({ ...q.companyDetails, business_activity: activity.id })
                    }}
                  />
                ))}
                {tier2.length > 0 && !expanded && (
                  <ListRow
                    title={`Voir d’autres activités (${tier2.length})`}
                    className={local.more}
                    onClick={() => q.setShowSecondaryActivities(prev => ({ ...prev, [profileKey]: true }))}
                  />
                )}
              </ListGroup>
            )
          })}
        </div>
      )}
      {mode === 'secondary' && (
        <ListGroup description="Optionnel. Aide Sarah à mieux contextualiser vos devis sur vos autres activités.">
          {getSecondaryActivityOptions(current).map(activity => {
            const checked = q.selectedSecondaryActivities.includes(activity.id)
            return (
              <ListRow
                key={activity.id}
                title={activity.label}
                trailing={checked ? <Tick /> : undefined}
                onClick={() => {
                  q.setSelectedSecondaryActivities(checked ? q.selectedSecondaryActivities.filter(id => id !== activity.id) : [...q.selectedSecondaryActivities, activity.id])
                  q.setCompanyDetailsDirty({ ...q.companyDetails })
                }}
              />
            )
          })}
        </ListGroup>
      )}
    </Sheet>
  )
}
