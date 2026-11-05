// Jeux de données réalistes (courts et longs) pour les tests de génération PDF
// et le script de rendu `scripts/render-pdf-samples.mts`. Aucune donnée réelle
// de client : ce sont les exemples de la maquette (Atelier Mbeboura, Lyon).
import type {
  InvoiceDocumentItem, InvoiceDocumentRecord, PdfOrganizationData, QuoteDocumentClient,
  QuoteDocumentItem, QuoteDocumentRecord, QuoteDocumentSection,
} from '@/lib/pdf/document-types'

export const organization: PdfOrganizationData = {
  id: 'org-1',
  name: 'Atelier Mbeboura',
  siret: '123 456 789 00012',
  siren: '123456789',
  vat_number: 'FR12345678900',
  email: 'contact@atelier-mbeboura.fr',
  email_from_name: 'Atelier Mbeboura',
  email_from_address: 'contact@atelier-mbeboura.fr',
  phone: '06 12 34 56 78',
  address_line1: '12 rue des Forges',
  address_line2: null,
  city: 'Lyon',
  postal_code: '69007',
  country: 'FR',
  logo_url: null,
  forme_juridique: 'SARL',
  capital_social: '10000',
  rcs: '123 456 789',
  rcs_ville: 'Lyon',
  insurance_info: 'AXA France IARD, contrat n° 987654321',
  certifications: 'Qualibat 4321',
  decennale_enabled: true,
  decennale_assureur: 'AXA France IARD',
  decennale_police: '987654321',
  decennale_couverture: 'France métropolitaine, tous corps d\'état du second œuvre',
  decennale_date_debut: '2026-01-01',
  decennale_date_fin: '2026-12-31',
  payment_terms_days: 30,
  late_penalty_rate: 10,
  iban: 'FR76 1234 5678 9012 3456 7890 123',
  bic: 'BNPAFRPPXXX',
  bank_name: 'BNP Paribas',
  court_competent: 'Tribunal de commerce de Lyon',
  signatory_name: 'Samuel Mbeboura',
  recovery_indemnity_text: null,
  is_vat_subject: true,
}

/** Logo PNG 1x1 (data URL) : suffit à tester la branche « en-tête réduit au logo ». */
export const LOGO_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

export const quoteClient: QuoteDocumentClient = {
  id: 'client-1',
  type: 'company',
  company_name: 'Dupont Rénovation',
  contact_name: 'Jean Dupont',
  first_name: null,
  last_name: null,
  email: 'jean.dupont@dupont-renovation.fr',
  phone: '06 98 76 54 32',
  address_line1: '12 rue des Lilas',
  postal_code: '69003',
  city: 'Lyon',
  siret: '987 654 321 00098',
}

type Line = { d: string; det?: string; q: number; u: string; pu: number; pending?: boolean }

const SHORT: { title: string; lines: Line[] }[] = [
  { title: 'Préparation et fourniture', lines: [
    { d: 'Dépose carrelage et ragréage', det: 'Évacuation des gravats incluse', q: 12, u: 'm²', pu: 38 },
    { d: 'Fourniture carrelage grès cérame', det: 'Format 60 × 60, finition mate', q: 12, u: 'm²', pu: 54 },
  ] },
  { title: 'Pose et plomberie', lines: [
    { d: 'Pose carrelage sol et murs', det: 'Joints époxy, angles protégés', q: 28, u: 'm²', pu: 62 },
    { d: "Douche à l'italienne, plomberie", det: 'Receveur extra-plat, siphon inox', q: 1, u: 'forfait', pu: 2450 },
  ] },
  { title: 'Équipement et finitions', lines: [
    { d: 'Meuble vasque et robinetterie', q: 1, u: 'forfait', pu: 1380 },
    { d: 'Électricité et ventilation', det: 'Mise aux normes NF C 15-100', q: 1, u: 'forfait', pu: 985 },
  ] },
]

const MORE: { title: string; lines: Line[] }[] = [
  { title: 'Menuiserie', lines: [
    { d: 'Porte coulissante sur mesure', det: 'Chêne, quincaillerie incluse', q: 1, u: 'u', pu: 640 },
    { d: 'Habillage de trémie', det: 'Médium peint, deux couches', q: 4, u: 'ml', pu: 85 },
    { d: 'Plinthes assorties', q: 14, u: 'ml', pu: 22 },
  ] },
  { title: 'Chauffage', lines: [
    { d: 'Radiateur sèche-serviettes', det: 'Électrique, 750 W, programmable', q: 1, u: 'u', pu: 420 },
    { d: 'Raccordement et programmation', q: 1, u: 'forfait', pu: 160 },
  ] },
  { title: 'Nettoyage et remise en état', lines: [
    { d: 'Protection des parties communes', det: 'Bâches et cartons sur 3 niveaux', q: 1, u: 'forfait', pu: 180 },
    { d: 'Nettoyage de fin de chantier', q: 1, u: 'forfait', pu: 220 },
    { d: 'Évacuation en déchetterie', det: 'Bordereaux remis au client', q: 2, u: 'rot.', pu: 95 },
    { d: 'Étude acoustique complémentaire', det: 'Prix fixé après visite du bureau d\'études', q: 1, u: 'forfait', pu: 0, pending: true },
  ] },
]

let seq = 0
function quoteItem(l: Line, sectionId: string | null): QuoteDocumentItem {
  seq += 1
  return {
    id: `qi-${seq}`,
    section_id: sectionId,
    description: null,
    details: l.det ?? null,
    designation: l.d,
    quantity: l.q,
    unit: l.u,
    unit_price: l.pu,
    vat_rate: 10,
    length_m: null,
    width_m: null,
    height_m: null,
    dim_quantity: 1,
    is_internal: false,
    price_pending: l.pending ?? false,
  }
}

function sections(groups: { title: string; lines: Line[] }[]): QuoteDocumentSection[] {
  return groups.map((g, i) => ({ id: `sec-${i}`, title: g.title, items: g.lines.map(l => quoteItem(l, `sec-${i}`)) }))
}

const REQUEST = 'Rénovation complète de la salle de bain : dépose, plomberie, carrelage sol et murs, meuble vasque. Intervention prévue sur 8 jours ouvrés.'

export function quoteRecord(long: boolean): QuoteDocumentRecord {
  const secs = sections(long ? [...SHORT, ...MORE] : SHORT)
  if (long) {
    // Une ligne interne (jamais imprimée) et une ligne avec dimensions.
    secs[0].items.push({ ...quoteItem({ d: 'Marge interne', q: 1, u: 'forfait', pu: 999 }, 'sec-0'), is_internal: true })
    secs[1].items.push({ ...quoteItem({ d: 'Faïence murale', det: 'Pose droite\nJoints gris perle', q: 1, u: 'm²', pu: 48 }, 'sec-1'), length_m: 3.2, width_m: 2.5, dim_quantity: 2 })
  }
  return {
    id: long ? 'quote-long' : 'quote-short',
    number: 'D-114',
    title: long ? 'Salle de bain et circulation du 3e étage, Lyon 3e, avec reprise des menuiseries' : 'Salle de bain, Lyon 3e',
    total_ht: null,
    total_ttc: null,
    currency: 'EUR',
    validity_days: 30,
    valid_until: '2026-12-01',
    sent_at: '2026-11-01T09:00:00Z',
    signed_at: null,
    client_signature_image: null,
    client_signatory_name: null,
    client_signatory_role: null,
    created_at: '2026-11-01T09:00:00Z',
    client_request_description: long ? `${REQUEST} ${REQUEST}` : REQUEST,
    client_request_visible_on_pdf: true,
    notes_client: long ? 'Merci de votre confiance. Ce devis fait suite à notre visite technique du 28 octobre. Les teintes de carrelage seront validées ensemble avant la commande.' : null,
    payment_conditions: 'Acompte de 30 % à la commande, solde à réception des travaux.',
    show_section_subtotals: true,
    sections: secs,
    unsectionedItems: long ? [quoteItem({ d: 'Déplacement et installation de chantier', q: 1, u: 'forfait', pu: 120 }, null)] : [],
  }
}

function invoiceItem(l: Line | { section: string }): InvoiceDocumentItem {
  seq += 1
  if ('section' in l) {
    return { id: `ii-${seq}`, description: l.section, quantity: 1, unit: '__section__', unit_price: 0, vat_rate: 10, is_internal: false, length_m: null, width_m: null, height_m: null, dim_quantity: 1 }
  }
  return {
    id: `ii-${seq}`,
    description: l.det ? `${l.d}\nComprend : ${l.det}` : l.d,
    quantity: l.q,
    unit: l.u,
    unit_price: l.pu,
    vat_rate: 10,
    is_internal: false,
    length_m: null,
    width_m: null,
    height_m: null,
    dim_quantity: 1,
  }
}

export function invoiceRecord(long: boolean, variant: 'standard' | 'situation' = 'standard'): InvoiceDocumentRecord {
  const groups = long ? [...SHORT, ...MORE] : SHORT
  const items = groups.flatMap(g => [invoiceItem({ section: g.title }), ...g.lines.filter(l => !l.pending).map(invoiceItem)])
  const isSituation = variant === 'situation'
  return {
    id: long ? 'invoice-long' : 'invoice-short',
    number: 'F-2026-042',
    title: 'Salle de bain, Lyon 3e',
    status: 'sent',
    invoice_type: isSituation ? 'situation' : 'standard',
    total_ht: null,
    total_tva: null,
    total_ttc: null,
    currency: 'EUR',
    issue_date: '2026-11-01',
    due_date: '2026-11-30',
    sent_at: '2026-11-01T09:00:00Z',
    created_at: '2026-11-01T09:00:00Z',
    notes_client: long ? 'Merci de votre confiance. Les travaux ont été réceptionnés sans réserve le 30 octobre 2026.' : null,
    payment_conditions: null,
    aid_label: long && !isSituation ? "MaPrimeRénov'" : null,
    aid_amount: long && !isSituation ? 1500 : null,
    quote_id: 'quote-short',
    client_id: 'client-1',
    situation_number: isSituation ? 2 : null,
    cumulative_pct: isSituation ? 65 : null,
    period_from: isSituation ? '2026-10-01' : null,
    period_to: isSituation ? '2026-10-31' : null,
    retention_pct: isSituation ? 5 : null,
    retention_amount: isSituation ? 382.75 : null,
    market_reference: isSituation ? 'M-2026-018' : null,
    is_reverse_charge: false,
    quote_number: 'D-114',
    client: {
      id: 'client-1',
      type: 'company',
      company_name: 'Dupont Rénovation',
      first_name: null,
      last_name: null,
      email: 'jean.dupont@dupont-renovation.fr',
      phone: '06 98 76 54 32',
      address_line1: '12 rue des Lilas',
      postal_code: '69003',
      city: 'Lyon',
      siret: '987 654 321 00098',
      siren: '987654321',
      vat_number: 'FR98765432100',
    },
    items,
  }
}
