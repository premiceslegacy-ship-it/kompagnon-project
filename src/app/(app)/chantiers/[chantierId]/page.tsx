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
import { getInvoiceStubs } from '@/lib/data/queries/invoices'
import { getTeamMembers } from '@/lib/data/queries/team'
import { getChantierProfitability } from '@/lib/data/queries/chantier-profitability'
import { getJalonsForChantier } from '@/lib/data/queries/chantier-jalons'
import { getChantierIndividualMembers, getOrgIndividualMembers } from '@/lib/data/queries/members'
import { getOrganization } from '@/lib/data/queries/organization'
import { getMaterials } from '@/lib/data/queries/catalog'
import ChantierDetailClient from './ChantierDetailClient'

export default async function ChantierDetailPage({
  params,
}: {
  params: { chantierId: string }
}) {
  const [chantier, taches, pointages, photos, notes, allEquipes, chantierEquipes, plannings, linkableQuotes, taskLibraryTitles, orgMembers, profitability, jalons, individualMembers, orgPhantomMembers, organization, materials, invoiceStubs] = await Promise.all([
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
    getTeamMembers(),
    getChantierProfitability(params.chantierId),
    getJalonsForChantier(params.chantierId),
    getChantierIndividualMembers(params.chantierId),
    getOrgIndividualMembers(),
    getOrganization(),
    getMaterials(),
    getInvoiceStubs(),
  ])

  if (!chantier) notFound()

  const defaultProfitability = profitability ?? {
    budgetHt: chantier.budget_ht,
    revenueHt: 0,
    costMaterial: 0,
    costLabor: 0,
    costSubcontract: 0,
    costOther: 0,
    costTotal: 0,
    marginEur: 0,
    marginPct: 0,
    hoursLogged: 0,
    expenses: [],
    laborByMember: [],
  }

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
      orgMembers={orgMembers}
      initialProfitability={defaultProfitability}
      initialJalons={jalons}
      initialIndividualMembers={individualMembers}
      orgPhantomMembers={orgPhantomMembers}
      invoiceStubs={invoiceStubs}
      orgSector={organization?.sector ?? null}
      materials={materials}
    />
  )
}
