// Mentions de l'entreprise reprises par tous les documents : pied de page légal, coordonnées, décennale.

import type { PdfOrganizationData } from '../document-types'
import { fmtCapitalSocial, pdfText } from '../pdf-design-system'

/** Lignes légales du pied de page (forme et capital, immatriculation, assurance, certifications). */
export type LegalFooterOrganization = Partial<Pick<
  PdfOrganizationData,
  'forme_juridique' | 'capital_social' | 'siret' | 'rcs' | 'rcs_ville' | 'vat_number' | 'insurance_info' | 'certifications' | 'decennale_enabled'
>>

export function legalFooterLines(organization: LegalFooterOrganization, isVatSubject = true): string[] {
  const line1: string[] = []
  if (organization.forme_juridique) line1.push(organization.forme_juridique)
  const capital = fmtCapitalSocial(organization.capital_social ?? null)
  if (capital) line1.push(`Capital social : ${capital}`)

  const line2: string[] = []
  if (organization.siret) line2.push(`SIRET : ${organization.siret}`)
  if (organization.rcs && organization.rcs_ville) line2.push(`RCS ${organization.rcs_ville} ${organization.rcs}`)
  else if (organization.rcs) line2.push(`RCS ${organization.rcs}`)
  if (!isVatSubject) line2.push('TVA non applicable, art. 293B du CGI')
  else if (organization.vat_number) line2.push(`TVA : ${organization.vat_number}`)

  let insurance: string | null = null
  if (organization.insurance_info) {
    const label = organization.decennale_enabled
      ? 'Assurance responsabilité civile professionnelle et décennale'
      : 'Assurance responsabilité civile professionnelle'
    insurance = `${label} : ${organization.insurance_info}`
  }
  const certifications = Array.isArray(organization.certifications)
    ? organization.certifications.join(' · ')
    : organization.certifications

  return [line1.join(' · '), line2.join(' · '), insurance, certifications].filter((l): l is string => !!l && l.length > 0)
}

/** Coordonnées de l'entreprise sous son nom (bloc « De »). */
export function organizationPartyLines(organization: PdfOrganizationData, opts: { siren?: boolean } = {}): string[] {
  const street = organization.address_line1
  const postalCity = [organization.postal_code, organization.city].filter(Boolean).join(' ') || null
  const contact = [organization.email, organization.phone].filter(Boolean).join(' · ') || null
  const registration = organization.siret
    ? `SIRET ${organization.siret}`
    : opts.siren && organization.siren
      ? `SIREN ${organization.siren}`
      : null
  return [street, postalCity, contact, registration].filter((l): l is string => !!l).map(pdfText)
}

const fmtFrDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR')

/** Texte de la garantie décennale (art. L241-1), ou null si elle n'est pas activée. */
export function decennaleText(organization: PdfOrganizationData): string | null {
  if (!organization.decennale_enabled || !organization.decennale_assureur) return null
  return [
    `Assureur : ${organization.decennale_assureur}`,
    organization.decennale_police ? `Police n° ${organization.decennale_police}` : '',
    organization.decennale_couverture ? `Couverture : ${organization.decennale_couverture}` : '',
    organization.decennale_date_debut || organization.decennale_date_fin
      ? `Validité : ${organization.decennale_date_debut ? fmtFrDate(organization.decennale_date_debut) : '?'} - ${organization.decennale_date_fin ? fmtFrDate(organization.decennale_date_fin) : '?'}`
      : '',
  ].filter(Boolean).join('  ·  ')
}

export const DECENNALE_LABEL = 'Garantie décennale, art. L241-1 du Code des assurances'
