// Petites aides partagées par les documents commerciaux (devis, facture).
import type { PdfOrganizationData } from '@/lib/pdf/document-types'
import { pdfText } from '@/lib/pdf/pdf-design-system'

/** « 12 m² », « 1 forfait » : quantité et unité dans la même colonne. */
export function quantityLabel(quantity: number | null | undefined, unit: string | null | undefined): string {
  if (quantity == null) return ''
  const q = quantity.toLocaleString('fr-FR', { maximumFractionDigits: 3 })
  const u = pdfText(unit ?? '').trim()
  return pdfText(u ? `${q} ${u}` : q)
}

/** Lignes de détail sous la désignation (comme la maquette, sans « Comprend : »), puis dimensions. */
export function itemDetailLines(details: string[], dimDetail: string | null): string[] {
  const out: string[] = []
  if (details.length) out.push(details.join(' · '))
  if (dimDetail) out.push(dimDetail)
  return out
}

/** Texte de la garantie décennale (art. L241-1 du Code des assurances), à l'identique des anciens gabarits. */
export function decennaleText(organization: PdfOrganizationData): string | null {
  if (!organization.decennale_enabled || !organization.decennale_assureur) return null
  const parts = [
    `Assureur : ${organization.decennale_assureur}`,
    organization.decennale_police ? `Police n° ${organization.decennale_police}` : '',
    organization.decennale_couverture ? `Couverture : ${organization.decennale_couverture}` : '',
    (organization.decennale_date_debut || organization.decennale_date_fin)
      ? `Validité : ${organization.decennale_date_debut ? new Date(organization.decennale_date_debut).toLocaleDateString('fr-FR') : '?'} - ${organization.decennale_date_fin ? new Date(organization.decennale_date_fin).toLocaleDateString('fr-FR') : '?'}`
      : '',
  ].filter(Boolean)
  return parts.join(' · ')
}
