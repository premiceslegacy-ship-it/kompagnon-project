import { notFound } from 'next/navigation'
import {
  getChantierById,
  getChantierTaches,
  getChantierPointages,
  getChantierPhotos,
  getChantierNotes,
  getEquipes,
  getChantierEquipes,
  getChantierPlannings,
  getOrgTaskTitles,
} from '@/lib/data/queries/chantiers'
import { getQuotesForLinking } from '@/lib/data/queries/quotes'
import ChantierDetailClient from './ChantierDetailClient'

export default async function ChantierDetailPage({
  params,
}: {
  params: { chantierId: string }
}) {
  const [chantier, taches, pointages, photos, notes, allEquipes, chantierEquipes, plannings, linkableQuotes, taskLibraryTitles] = await Promise.all([
    getChantierById(params.chantierId),
    getChantierTaches(params.chantierId),
    getChantierPointages(params.chantierId),
    getChantierPhotos(params.chantierId),
    getChantierNotes(params.chantierId),
    getEquipes(),
    getChantierEquipes(params.chantierId),
    getChantierPlannings(params.chantierId),
    getQuotesForLinking(),
    getOrgTaskTitles(params.chantierId),
  ])

  if (!chantier) notFound()

  return (
    <ChantierDetailClient
      chantier={chantier}
      initialTaches={taches}
      initialPointages={pointages}
      initialPhotos={photos}
      initialNotes={notes}
      allEquipes={allEquipes}
      initialChantierEquipes={chantierEquipes}
      initialPlannings={plannings}
      linkableQuotes={linkableQuotes}
      taskLibraryTitles={taskLibraryTitles}
    />
  )
}
