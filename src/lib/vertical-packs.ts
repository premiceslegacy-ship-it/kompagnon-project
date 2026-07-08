import type { BusinessActivityId, StarterPreset, StarterClause } from '@/lib/catalog-context'
import type { ContractTemplate } from '@/lib/contracts/templates'

export type VerticalPackId = 'metal' // futurs : 'renovation_premium' | 'cvc'

export type VerticalPackChecklistItem = {
  label: string
  helpText?: string
}

export type VerticalPackChecklist = {
  label: string
  items: VerticalPackChecklistItem[]
}

export type VerticalPackDefinition = {
  id: VerticalPackId
  label: string
  description: string
  eligibleActivityIds: BusinessActivityId[]
  starterPresets: StarterPreset[]
  starterClauses: StarterClause[]
  contractTrade: ContractTemplate['trade']
  checklists: VerticalPackChecklist[]
  // Bloc de règles injecté au prompt IA (Chloé/Sarah) — source unique pour éviter
  // toute duplication entre business-context.ts et analyze-quote/route.ts.
  aiPromptGuidance: string
}

const METAL_STARTER_PRESETS: StarterPreset[] = [
  {
    name: 'Garde-corps métallique sur mesure',
    description: "Fourniture et pose de garde-corps acier, montants + lisses, finition thermolaquée.",
    category: 'Métallerie extérieure',
    unit: 'ml',
    vat_rate: 20,
    profile_kind: 'mixed',
    lines: [
      { section_title: 'Étude et fabrication', designation: "Relevé de cotes et plan d'exécution", quantity: 1, unit: 'forfait', item_type: 'service', unit_price_ht: 180, unit_cost_ht: 90 },
      { section_title: 'Étude et fabrication', designation: 'Débit et façonnage montants acier 40x40mm', quantity: 1, unit: 'ml', item_type: 'material', unit_price_ht: 65, unit_cost_ht: 38 },
      { section_title: 'Étude et fabrication', designation: 'Lisse haute et sous-lisse tube acier 40x20mm', quantity: 1, unit: 'ml', item_type: 'material', unit_price_ht: 42, unit_cost_ht: 24 },
      { section_title: 'Étude et fabrication', designation: 'Barreaudage vertical (entraxe 11cm réglementaire)', quantity: 1, unit: 'ml', item_type: 'material', unit_price_ht: 55, unit_cost_ht: 30 },
      { section_title: 'Traitement et finition', designation: 'Sablage et traitement antirouille', quantity: 1, unit: 'ml', item_type: 'labor', unit_price_ht: 18, unit_cost_ht: 9, is_internal: true },
      { section_title: 'Traitement et finition', designation: 'Thermolaquage RAL au choix', quantity: 1, unit: 'ml', item_type: 'service', unit_price_ht: 28, unit_cost_ht: 15 },
      { section_title: 'Pose', designation: 'Pose et scellement chimique platines', quantity: 1, unit: 'ml', item_type: 'labor', unit_price_ht: 45, unit_cost_ht: 22, is_internal: true },
      { section_title: 'Documentation', designation: 'Certificat matière EN 10204 3.1 (sur demande)', quantity: 1, unit: 'forfait', item_type: 'free', unit_price_ht: 0, unit_cost_ht: 0 },
    ],
  },
  {
    name: 'Portail battant acier motorisable',
    description: 'Fourniture et pose portail 2 vantaux acier, structure tube + remplissage, prêt pour motorisation.',
    category: 'Métallerie extérieure',
    unit: 'u',
    vat_rate: 20,
    profile_kind: 'mixed',
    lines: [
      { section_title: 'Étude et fabrication', designation: "Relevé de cotes et étude de faisabilité (dénivelé, sens ouverture)", quantity: 1, unit: 'forfait', item_type: 'service', unit_price_ht: 150, unit_cost_ht: 75 },
      { section_title: 'Étude et fabrication', designation: 'Ossature vantaux tube acier 60x40mm renforcé', quantity: 2, unit: 'vantail', item_type: 'material', unit_price_ht: 320, unit_cost_ht: 190 },
      { section_title: 'Étude et fabrication', designation: 'Remplissage tôle perforée ou barreaudage (au choix)', quantity: 2, unit: 'vantail', item_type: 'material', unit_price_ht: 180, unit_cost_ht: 105 },
      { section_title: 'Étude et fabrication', designation: 'Gonds réglables et pentures renforcées', quantity: 1, unit: 'forfait', item_type: 'material', unit_price_ht: 95, unit_cost_ht: 55 },
      { section_title: 'Traitement et finition', designation: 'Galvanisation à chaud', quantity: 1, unit: 'forfait', item_type: 'service', unit_price_ht: 220, unit_cost_ht: 150 },
      { section_title: 'Traitement et finition', designation: 'Thermolaquage RAL au choix', quantity: 1, unit: 'forfait', item_type: 'service', unit_price_ht: 280, unit_cost_ht: 160 },
      { section_title: 'Pose', designation: 'Scellement des piliers ou platines de fixation', quantity: 1, unit: 'forfait', item_type: 'labor', unit_price_ht: 260, unit_cost_ht: 130, is_internal: true },
      { section_title: 'Pose', designation: 'Pose vantaux, réglage aplomb et jeux de fonctionnement', quantity: 1, unit: 'forfait', item_type: 'labor', unit_price_ht: 180, unit_cost_ht: 90, is_internal: true },
      { section_title: 'Option', designation: 'Prééquipement motorisation (fourreaux, platines moteur)', quantity: 1, unit: 'forfait', item_type: 'free', unit_price_ht: 0, unit_cost_ht: 0 },
    ],
  },
  {
    name: 'Escalier métallique droit ou quart-tournant',
    description: 'Fabrication et pose escalier structure acier, marches tôle larmée ou bois, garde-corps assorti.',
    category: 'Métallerie intérieure',
    unit: 'u',
    vat_rate: 20,
    profile_kind: 'mixed',
    lines: [
      { section_title: 'Étude et fabrication', designation: "Relevé de cotes, note de calcul et plan d'exécution", quantity: 1, unit: 'forfait', item_type: 'service', unit_price_ht: 320, unit_cost_ht: 160 },
      { section_title: 'Étude et fabrication', designation: 'Limons acier soudés (épaisseur selon charge)', quantity: 2, unit: 'u', item_type: 'material', unit_price_ht: 380, unit_cost_ht: 220 },
      { section_title: 'Étude et fabrication', designation: 'Marches tôle larmée antidérapante', quantity: 1, unit: 'marche', item_type: 'material', unit_price_ht: 95, unit_cost_ht: 55 },
      { section_title: 'Étude et fabrication', designation: 'Garde-corps et main courante assortis', quantity: 1, unit: 'ml', item_type: 'material', unit_price_ht: 145, unit_cost_ht: 85 },
      { section_title: 'Traitement et finition', designation: 'Contrôle visuel des soudures et reprise antirouille', quantity: 1, unit: 'forfait', item_type: 'labor', unit_price_ht: 90, unit_cost_ht: 45, is_internal: true },
      { section_title: 'Traitement et finition', designation: 'Thermolaquage ou peinture époxy', quantity: 1, unit: 'forfait', item_type: 'service', unit_price_ht: 380, unit_cost_ht: 210 },
      { section_title: 'Pose', designation: 'Ancrage structure et mise à niveau', quantity: 1, unit: 'forfait', item_type: 'labor', unit_price_ht: 420, unit_cost_ht: 220, is_internal: true },
      { section_title: 'Documentation', designation: 'Note de calcul structure (si escalier porteur)', quantity: 1, unit: 'forfait', item_type: 'free', unit_price_ht: 0, unit_cost_ht: 0 },
    ],
  },
]

const METAL_CHECKLISTS: VerticalPackChecklist[] = [
  {
    label: 'Avant livraison chantier — ouvrage métallique',
    items: [
      { label: 'Certificat matière EN 10204 3.1 collecté pour les aciers structurels' },
      { label: 'Contrôle visuel des soudures (absence de porosité, morsures, manque de pénétration)' },
      { label: 'Traitement anticorrosion appliqué et séché (galvanisation à chaud ou peinture époxy primaire + finition)' },
      { label: 'Fixations et ancrages dimensionnés selon la note de calcul (si ouvrage porteur ou garde-corps)' },
      { label: 'Conformité garde-corps NF P01-012 (hauteur ≥ 1m, résistance aux chocs) si applicable' },
    ],
  },
]

const METAL_AI_PROMPT_GUIDANCE = `PACK VERTICALE MÉTIER ACTIF : MÉTAL (métallerie / tôlerie / chaudronnerie / soudure)
Cette entreprise a une expertise métal reconnue. Applique ces règles :
- Priorise les presets "garde-corps", "portail", "escalier métallique" du catalogue quand la demande client correspond.
- Pour tout contrat de sous-traitance ou de maintenance, propose en priorité le modèle "Métal" (clauses EN 10204 3.1, assurances atelier et pose, normes de soudure).
- Rappelle si pertinent la nécessité d'un certificat matière EN 10204 3.1 pour les ouvrages structurels ou en milieu ERP.
- Ne jamais valider un devis métal sans mentionner l'assurance décennale ou la RC pro pose selon le type d'ouvrage.`

export const VERTICAL_PACKS: Record<VerticalPackId, VerticalPackDefinition> = {
  metal: {
    id: 'metal',
    label: 'Métal (métallerie / tôlerie / chaudronnerie / soudure)',
    description: 'Presets garde-corps/portail/escalier, contrat dédié EN 10204 3.1, checklists soudure.',
    eligibleActivityIds: ['metallerie', 'tolerie', 'chaudronnerie', 'soudure'],
    starterPresets: METAL_STARTER_PRESETS,
    starterClauses: [],
    contractTrade: 'metal',
    checklists: METAL_CHECKLISTS,
    aiPromptGuidance: METAL_AI_PROMPT_GUIDANCE,
  },
}

export function getVerticalPackDefinition(id: string | null | undefined): VerticalPackDefinition | null {
  if (!id) return null
  return Object.prototype.hasOwnProperty.call(VERTICAL_PACKS, id)
    ? VERTICAL_PACKS[id as VerticalPackId]
    : null
}

export function getEligibleVerticalPack(activityId: string | null | undefined): VerticalPackDefinition | null {
  if (!activityId) return null
  return (
    Object.values(VERTICAL_PACKS).find((pack) =>
      pack.eligibleActivityIds.includes(activityId as BusinessActivityId),
    ) ?? null
  )
}

export function normalizeVerticalPackId(value: string | null | undefined): VerticalPackId | null {
  if (!value) return null
  return Object.prototype.hasOwnProperty.call(VERTICAL_PACKS, value) ? (value as VerticalPackId) : null
}
