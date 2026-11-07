'use client'
// @atelier-migrated
// Choix de l'activité de référence : cinq familles, ou la liste complète à la demande.

import { Check } from 'lucide-react'
import { AuthLinkButton } from '@/components/auth/AuthParts'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import {
  BUSINESS_ACTIVITIES_BY_PROFILE,
  getBusinessActivityById,
  resolveBusinessSelection,
  type BusinessProfile,
} from '@/lib/catalog-context'
import { PRIORITY_FAMILIES } from './onboardingModel'
import type { OnboardingState } from './useOnboarding'
import styles from './Onboarding.module.css'

function Tick() {
  return (
    <span className={styles.tick}>
      <Check size={18} role="img" aria-label="Sélectionnée" />
    </span>
  )
}

export default function ActivityPicker({ q }: { q: OnboardingState }) {
  if (q.pickerShowsAll) return <AllActivities q={q} />

  const family = PRIORITY_FAMILIES.find((candidate) => candidate.activityIds.includes(q.selectedActivity as never))
  const subChoices = family && family.activityIds.length > 1 ? family.activityIds : null

  return (
    <>
      <ListGroup title="Votre activité">
        {PRIORITY_FAMILIES.map((candidate) => {
          const selected = candidate === family
          return (
            <ListRow
              key={candidate.label}
              title={candidate.label}
              description={candidate.description}
              trailing={selected ? <Tick /> : undefined}
              onClick={() => {
                if (!selected) q.selectActivity(candidate.activityIds[0])
              }}
            />
          )
        })}
        <ListRow
          title="Autre activité"
          description="Choisir parmi tous les métiers, par domaine."
          className={styles.more}
          onClick={() => q.setShowOtherActivities(true)}
        />
      </ListGroup>
      {subChoices && (
        <ListGroup title="Précisez" description="Vous pourrez ensuite chiffrer plusieurs types de prestations.">
          {subChoices.map((activityId) => {
            const activity = getBusinessActivityById(activityId)
            if (!activity) return null
            return (
              <ListRow
                key={activityId}
                title={activity.label}
                trailing={q.selectedActivity === activityId ? <Tick /> : undefined}
                onClick={() => q.selectActivity(activityId)}
              />
            )
          })}
        </ListGroup>
      )}
    </>
  )
}

function AllActivities({ q }: { q: OnboardingState }) {
  return (
    <>
      {(Object.entries(BUSINESS_ACTIVITIES_BY_PROFILE) as Array<[BusinessProfile, (typeof BUSINESS_ACTIVITIES_BY_PROFILE)[BusinessProfile]]>).map(
        ([profileKey, activities]) => {
          const profile = resolveBusinessSelection({ businessProfile: profileKey }).profileConfig
          const secondary = activities.filter((activity) => activity.tier === 2)
          const selectedIsSecondary = secondary.some((activity) => activity.id === q.selectedActivity)
          const expanded = (q.showSecondaryActivities[profileKey] ?? false) || selectedIsSecondary
          const visible = expanded ? activities : activities.filter((activity) => activity.tier === 1)
          return (
            <ListGroup key={profileKey} title={profile.onboardingLabel}>
              {visible.map((activity) => (
                <ListRow
                  key={activity.id}
                  title={activity.label}
                  description={activity.description}
                  trailing={q.selectedActivity === activity.id ? <Tick /> : undefined}
                  onClick={() => q.selectActivity(activity.id)}
                />
              ))}
              {secondary.length > 0 && !expanded && (
                <ListRow
                  title={`Voir d’autres activités (${secondary.length})`}
                  className={styles.more}
                  onClick={() => q.setShowSecondaryActivities((previous) => ({ ...previous, [profileKey]: true }))}
                />
              )}
            </ListGroup>
          )
        },
      )}
      <div className={styles.centerRow}>
        <AuthLinkButton quiet onClick={() => q.setShowOtherActivities(false)}>
          Revenir aux activités prioritaires
        </AuthLinkButton>
      </div>
    </>
  )
}
