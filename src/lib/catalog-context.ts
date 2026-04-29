import type { DimensionPricingMode } from '@/lib/catalog-pricing'

export type BusinessProfile = 'cleaning' | 'btp' | 'industry'

export type BusinessActivityId =
  | 'nettoyage_bureaux'
  | 'vitrerie'
  | 'desinfection'
  | 'remise_en_etat'
  | 'renovation'
  | 'electricite'
  | 'plomberie'
  | 'menuiserie'
  | 'maconnerie'
  | 'peinture'
  | 'carrelage'
  | 'facade'
  | 'charpente'
  | 'depannage_multitechnique'
  | 'tolerie'
  | 'chaudronnerie'
  | 'decoupe_laser'
  | 'pliage'
  | 'soudure'
  | 'fabrication_atelier'

export type BusinessActivityDefinition = {
  id: BusinessActivityId
  label: string
  description: string
  businessProfile: BusinessProfile
}

export type CatalogLabelDefinition = {
  singular: string
  plural: string
  createLabel: string
  emptyLabel: string
  emptyHelp: string
}

export type CatalogLabelSet = {
  catalogTitle: string
  catalogSubtitle: string
  material: CatalogLabelDefinition
  service: CatalogLabelDefinition
  laborRate: CatalogLabelDefinition
  bundleTemplate: CatalogLabelDefinition
}

export type DefaultCategories = {
  material: string[]
  service: string[]
  laborRate: string[]
  bundleTemplate: string[]
}

export type StarterPresetLine = {
  designation: string
  quantity: number
  unit: string
  item_type: 'free' | 'service' | 'material' | 'labor' | 'transport' | 'mixed'
  unit_price_ht?: number
  unit_cost_ht?: number
}

export type StarterPreset = {
  name: string
  description: string
  category: string
  unit: string
  vat_rate: number
  profile_kind: 'article' | 'service' | 'mixed'
  lines: StarterPresetLine[]
}

// Copies UI spécifiques à l'écran "taux / ressources internes"
export type LaborRateUi = {
  modalTitle: string           // titre du bouton et de la modale de création
  designationLabel: string     // label du champ "Désignation" dans la modale
  costLabel: string            // label du coût interne (colonne + champ)
  rateLabel: string            // label du tarif facturé (colonne + champ)
  typeHumanLabel: string       // label pour type = 'human'
  typeMachineLabel: string     // label pour type = 'machine'
  typeEquipmentLabel: string   // label pour type = 'equipment'
  typeSubcontractorLabel: string // label pour type = 'subcontractor'
  typeOtherLabel: string       // label pour type = 'other'
  referencePlaceholder: string // exemple de référence interne
  tableColumnType: string      // en-tête colonne "Type" dans le tableau
}

// Copies UI spécifiques à l'éditeur de modèles (bundle_template / prestation_type)
export type BundleTemplateUi = {
  lineTypeLabels: {
    service: string    // type de ligne = service vendu
    labor: string      // type de ligne interne = ressource humaine/machine
    material: string   // type de ligne = fourniture/matière/produit
    transport: string  // type de ligne = déplacement/logistique
    free: string       // ligne libre (identique pour tous les profils)
    equipment: string  // type de ligne = matériel amorti (aspirateur, machine, etc.)
  }
  internalLineHelp: string     // aide contextuelle sur les lignes internes
  sectionPlaceholder: string   // placeholder pour le titre d'une section
  catalogMaterialHint: string  // placeholder du picker catalogue côté matière
  catalogLaborHint: string     // placeholder du picker catalogue côté ressource
}

export type BusinessProfileConfig = {
  activityId: BusinessActivityId
  businessProfile: BusinessProfile
  sectorFallback: string
  onboardingLabel: string
  onboardingDescription: string
  labelSet: CatalogLabelSet
  unitSet: string[]
  unitSetsByKind: {
    material: string[]
    service: string[]
    laborRate: string[]
  }
  defaultCategories: DefaultCategories
  starterPresets: StarterPreset[]
  laborRateUi: LaborRateUi
  bundleTemplateUi: BundleTemplateUi
  resourceTypeOptions: Array<{ value: string; label: string }>
}

export type ResolvedCatalogContext = BusinessProfileConfig

export type OrganizationCatalogConfigInput = {
  business_activity_id?: string | null
  business_profile?: string | null
  label_set?: unknown
  unit_set?: unknown
  default_categories?: unknown
  starter_presets?: unknown
  sector?: string | null
}

export type CatalogItemKind = 'material' | 'service'

export type CatalogItem = {
  id: string
  kind: CatalogItemKind
  label: string
  internal_ref: string | null
  category: string | null
  unit: string | null
  vat_rate: number | null
  sale_price_ht: number | null
  target_margin: number | null
  is_active: boolean
  purchase_cost_ht: number | null
  dimensional_mode: DimensionPricingMode
}

export type LaborRateModel = {
  id: string
  label: string
  unit: string | null
  hourly_cost_ht: number | null
  hourly_sale_ht: number | null
  margin_target: number | null
  role: string | null
  active: boolean
}

export type BundleTemplateModel = {
  id: string
  label: string
  description: string | null
  category: string | null
  unit: string
  sale_price_ht: number
  cost_ht: number
  margin_pct: number | null
  active: boolean
}

function buildLabelSet(input: {
  catalogTitle: string
  catalogSubtitle: string
  material: [string, string, string, string, string]
  service: [string, string, string, string, string]
  laborRate: [string, string, string, string, string]
  bundleTemplate: [string, string, string, string, string]
}): CatalogLabelSet {
  return {
    catalogTitle: input.catalogTitle,
    catalogSubtitle: input.catalogSubtitle,
    material: {
      singular: input.material[0],
      plural: input.material[1],
      createLabel: input.material[2],
      emptyLabel: input.material[3],
      emptyHelp: input.material[4],
    },
    service: {
      singular: input.service[0],
      plural: input.service[1],
      createLabel: input.service[2],
      emptyLabel: input.service[3],
      emptyHelp: input.service[4],
    },
    laborRate: {
      singular: input.laborRate[0],
      plural: input.laborRate[1],
      createLabel: input.laborRate[2],
      emptyLabel: input.laborRate[3],
      emptyHelp: input.laborRate[4],
    },
    bundleTemplate: {
      singular: input.bundleTemplate[0],
      plural: input.bundleTemplate[1],
      createLabel: input.bundleTemplate[2],
      emptyLabel: input.bundleTemplate[3],
      emptyHelp: input.bundleTemplate[4],
    },
  }
}

function buildResourceTypeOptions(ui: LaborRateUi) {
  return [
    { value: 'human', label: ui.typeHumanLabel },
    { value: 'machine', label: ui.typeMachineLabel },
    { value: 'equipment', label: ui.typeEquipmentLabel },
    { value: 'subcontractor', label: ui.typeSubcontractorLabel },
    { value: 'other', label: ui.typeOtherLabel },
  ]
}

export const BUSINESS_ACTIVITIES: BusinessActivityDefinition[] = [
  {
    id: 'nettoyage_bureaux',
    label: 'Nettoyage de bureaux',
    description: 'Entretien régulier, consommables et prestations récurrentes.',
    businessProfile: 'cleaning',
  },
  {
    id: 'vitrerie',
    label: 'Vitrerie',
    description: 'Nettoyage de vitres, vitrines et façades vitrées.',
    businessProfile: 'cleaning',
  },
  {
    id: 'desinfection',
    label: 'Désinfection',
    description: 'Traitements ponctuels ou récurrents de désinfection.',
    businessProfile: 'cleaning',
  },
  {
    id: 'remise_en_etat',
    label: 'Remise en état',
    description: 'Interventions après travaux, sinistres ou états des lieux.',
    businessProfile: 'cleaning',
  },
  {
    id: 'renovation',
    label: 'Rénovation',
    description: "Travaux tous corps d'état et interventions multi-lots.",
    businessProfile: 'btp',
  },
  {
    id: 'electricite',
    label: 'Électricité',
    description: 'Installations, dépannages et mises en conformité électriques.',
    businessProfile: 'btp',
  },
  {
    id: 'plomberie',
    label: 'Plomberie',
    description: 'Plomberie, sanitaire, chauffage et réseaux.',
    businessProfile: 'btp',
  },
  {
    id: 'menuiserie',
    label: 'Menuiserie',
    description: 'Pose, fabrication et finitions bois, alu ou PVC.',
    businessProfile: 'btp',
  },
  {
    id: 'maconnerie',
    label: 'Maçonnerie',
    description: 'Gros œuvre, dalles, murs et ouvrages maçonnés.',
    businessProfile: 'btp',
  },
  {
    id: 'peinture',
    label: 'Peinture',
    description: 'Préparation, peinture et finitions intérieures ou extérieures.',
    businessProfile: 'btp',
  },
  {
    id: 'carrelage',
    label: 'Carrelage',
    description: 'Sols, faïence, revêtements et finitions associées.',
    businessProfile: 'btp',
  },
  {
    id: 'facade',
    label: 'Façade',
    description: "Ravalement, enduits et isolation par l'extérieur.",
    businessProfile: 'btp',
  },
  {
    id: 'charpente',
    label: 'Charpente',
    description: 'Charpente, couverture et zinguerie.',
    businessProfile: 'btp',
  },
  {
    id: 'depannage_multitechnique',
    label: 'Dépannage multitechnique',
    description: "Interventions rapides avec fournitures et main-d'œuvre.",
    businessProfile: 'btp',
  },
  {
    id: 'tolerie',
    label: 'Tôlerie',
    description: 'Découpe, pliage et fabrication de pièces en tôle.',
    businessProfile: 'industry',
  },
  {
    id: 'chaudronnerie',
    label: 'Chaudronnerie',
    description: 'Assemblages, ouvrages sur mesure et fabrication métal.',
    businessProfile: 'industry',
  },
  {
    id: 'decoupe_laser',
    label: 'Découpe laser',
    description: 'Découpe de précision, séries courtes et pièces unitaires.',
    businessProfile: 'industry',
  },
  {
    id: 'pliage',
    label: 'Pliage',
    description: 'Pliage atelier, réglages machine et reprises.',
    businessProfile: 'industry',
  },
  {
    id: 'soudure',
    label: 'Soudure',
    description: 'Assemblage, soudure TIG, MIG ou MAG et finitions.',
    businessProfile: 'industry',
  },
  {
    id: 'fabrication_atelier',
    label: 'Fabrication atelier',
    description: 'Production, assemblage et contrôle en atelier.',
    businessProfile: 'industry',
  },
]

export const BUSINESS_ACTIVITIES_BY_PROFILE: Record<BusinessProfile, BusinessActivityDefinition[]> = {
  cleaning: BUSINESS_ACTIVITIES.filter((activity) => activity.businessProfile === 'cleaning'),
  btp: BUSINESS_ACTIVITIES.filter((activity) => activity.businessProfile === 'btp'),
  industry: BUSINESS_ACTIVITIES.filter((activity) => activity.businessProfile === 'industry'),
}

export const BUSINESS_PROFILE_CONFIGS: Record<BusinessProfile, BusinessProfileConfig> = {
  cleaning: {
    activityId: 'nettoyage_bureaux',
    businessProfile: 'cleaning',
    sectorFallback: 'Nettoyage de bureaux',
    onboardingLabel: 'Nettoyage',
    onboardingDescription: "Produits, prestations et modèles de devis prêts à l'emploi.",
    labelSet: buildLabelSet({
      catalogTitle: 'Catalogue & process',
      catalogSubtitle: 'Produits, prestations, ressources internes et modèles adaptés à votre activité de nettoyage.',
      material: ['Produit', 'Produits', 'Nouveau produit', "Aucun produit pour l'instant", 'Commencez par ajouter vos premiers produits.'],
      service: ['Prestation', 'Prestations', 'Nouvelle prestation', "Aucune prestation pour l'instant", 'Commencez par ajouter vos premières prestations.'],
      laborRate: ['Ressource interne', 'Ressources internes', 'Nouvelle ressource interne', "Aucune ressource interne pour l'instant", 'Commencez par ajouter vos ressources internes.'],
      bundleTemplate: ['Modèle de devis', 'Modèles de devis', 'Nouveau modèle de devis', "Aucun modèle de devis pour l'instant", 'Créez des modèles réutilisables pour accélérer vos devis.'],
    }),
    unitSet: ['h', 'forfait', 'm²', 'm', 'ml', 'u', 'jour'],
    unitSetsByKind: {
      material: ['u', 'L', 'kg', 'forfait'],
      service: ['forfait', 'm²', 'h', 'jour', 'passage'],
      laborRate: ['h', 'jour', 'forfait', 'passage'],
    },
    defaultCategories: {
      material: ['Consommables', 'Produits vitrerie', 'Désinfection', 'Entretien courant'],
      service: ['Entretien bureaux', 'Vitrerie', 'Remise en état', 'Désinfection'],
      laborRate: ['Équipe jour', 'Équipe soir', 'Renfort ponctuel'],
      bundleTemplate: ['Hebdomadaire', 'Mensuel', 'Ponctuel'],
    },
    starterPresets: [
      {
        name: 'Entretien hebdo bureaux',
        description: 'Passage régulier de nettoyage de bureaux.',
        category: 'Hebdomadaire',
        unit: 'forfait',
        vat_rate: 20,
        profile_kind: 'service',
        lines: [
          { designation: 'Entretien des sols et surfaces', quantity: 1, unit: 'forfait', item_type: 'free' },
          { designation: 'Vidage des corbeilles', quantity: 1, unit: 'forfait', item_type: 'free' },
        ],
      },
      {
        name: 'Nettoyage vitres',
        description: 'Intervention ponctuelle de vitrerie intérieure et extérieure.',
        category: 'Ponctuel',
        unit: 'forfait',
        vat_rate: 20,
        profile_kind: 'service',
        lines: [
          { designation: 'Nettoyage des vitres intérieures', quantity: 1, unit: 'forfait', item_type: 'free' },
          { designation: 'Nettoyage des vitres extérieures', quantity: 1, unit: 'forfait', item_type: 'free' },
        ],
      },
      {
        name: 'Remise en état',
        description: 'Nettoyage approfondi après travaux ou avant restitution.',
        category: 'Ponctuel',
        unit: 'forfait',
        vat_rate: 20,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Nettoyage intensif des surfaces', quantity: 1, unit: 'forfait', item_type: 'free' },
          { designation: 'Évacuation des résidus légers', quantity: 1, unit: 'forfait', item_type: 'free' },
        ],
      },
      {
        name: 'Contrat mensuel copropriété',
        description: 'Base de contrat mensuel pour les parties communes.',
        category: 'Mensuel',
        unit: 'forfait',
        vat_rate: 20,
        profile_kind: 'service',
        lines: [
          { designation: 'Nettoyage des halls et circulations', quantity: 1, unit: 'forfait', item_type: 'free' },
          { designation: 'Sortie des conteneurs', quantity: 1, unit: 'forfait', item_type: 'free' },
        ],
      },
      {
        name: 'Désinfection ponctuelle',
        description: 'Traitement ponctuel de désinfection.',
        category: 'Ponctuel',
        unit: 'forfait',
        vat_rate: 20,
        profile_kind: 'service',
        lines: [
          { designation: 'Application du produit désinfectant', quantity: 1, unit: 'forfait', item_type: 'free' },
          { designation: "Compte-rendu d'intervention", quantity: 1, unit: 'forfait', item_type: 'free' },
        ],
      },
    ],
    laborRateUi: {
      modalTitle: "Nouvelle ressource interne",
      designationLabel: "Nom de la ressource",
      costLabel: "Coût entreprise / unité",
      rateLabel: "Valorisation interne / unité",
      typeHumanLabel: "Équipe",
      typeMachineLabel: "Machine",
      typeEquipmentLabel: "Équipement amorti",
      typeSubcontractorLabel: "Sous-traitant",
      typeOtherLabel: "Autre charge",
      referencePlaceholder: "ex: EQ-JOUR",
      tableColumnType: "Type",
    },
    bundleTemplateUi: {
      lineTypeLabels: {
        service: "Prestation",
        labor: "Équipe",
        material: "Produit",
        transport: "Déplacement",
        free: "Ligne libre",
        equipment: "Équipement amorti",
      },
      internalLineHelp: "Les lignes internes (ressources, déplacements, équipements) contribuent au coût de revient mais n'apparaissent pas dans le devis client.",
      sectionPlaceholder: "ex: Nettoyage des vitres",
      catalogMaterialHint: "Chercher un produit...",
      catalogLaborHint: "Chercher une ressource interne...",
    },
    resourceTypeOptions: [],
  },
  btp: {
    activityId: 'renovation',
    businessProfile: 'btp',
    sectorFallback: 'Rénovation',
    onboardingLabel: 'BTP',
    onboardingDescription: "Fournitures, main-d'œuvre vendue, taux horaires et modèles de devis chantier.",
    labelSet: buildLabelSet({
      catalogTitle: 'Catalogue & tarifs',
      catalogSubtitle: "Fournitures, prestations, ressources internes et modèles de devis adaptés à vos chantiers.",
      material: ['Fourniture', 'Fournitures', 'Nouvelle fourniture', "Aucune fourniture pour l'instant", 'Commencez par ajouter vos premières fournitures.'],
      service: ["Main-d'œuvre", "Main-d'œuvre", "Nouvelle ligne de main-d'œuvre", "Aucune main-d'œuvre pour l'instant", "Commencez par ajouter vos postes vendus de main-d'œuvre."],
      laborRate: ['Ressource interne', 'Ressources internes', 'Nouvelle ressource interne', "Aucune ressource interne pour l'instant", 'Commencez par ajouter vos ressources internes de chantier.'],
      bundleTemplate: ['Modèle de devis', 'Modèles de devis', 'Nouveau modèle de devis', "Aucun modèle de devis pour l'instant", 'Créez des modèles réutilisables pour accélérer la saisie de vos devis.'],
    }),
    unitSet: ['h', 'u', 'ml', 'm²', 'm³', 'forfait', 'jour'],
    unitSetsByKind: {
      material: ['u', 'ml', 'm²', 'm³', 'forfait'],
      service: ['forfait', 'u', 'ml', 'm²', 'm³', 'h', 'jour'],
      laborRate: ['h', 'jour', 'forfait', 'u'],
    },
    defaultCategories: {
      material: ['Fournitures chantier', 'Plomberie', 'Électricité', 'Pose', 'Dépannage'],
      service: ['Pose', 'Dépannage', 'Maintenance', 'Mise en service'],
      laborRate: ['Taux chantier', 'Encadrement', 'Sous-traitance'],
      bundleTemplate: ['Installation type', 'Dépannage', 'Entretien'],
    },
    starterPresets: [
      {
        name: 'Dépannage simple',
        description: 'Base de devis pour intervention courte.',
        category: 'Dépannage',
        unit: 'forfait',
        vat_rate: 20,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Diagnostic et intervention', quantity: 1, unit: 'forfait', item_type: 'free' },
          { designation: 'Petites fournitures', quantity: 1, unit: 'forfait', item_type: 'free' },
        ],
      },
      {
        name: 'Pose standard',
        description: "Trame simple de pose avec fournitures et main-d'œuvre.",
        category: 'Pose',
        unit: 'forfait',
        vat_rate: 20,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Préparation du chantier', quantity: 1, unit: 'forfait', item_type: 'free' },
          { designation: 'Pose et finitions', quantity: 1, unit: 'forfait', item_type: 'free' },
        ],
      },
      {
        name: 'Installation type',
        description: 'Base de chiffrage pour installation complète.',
        category: 'Installation type',
        unit: 'forfait',
        vat_rate: 20,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Fournitures principales', quantity: 1, unit: 'forfait', item_type: 'free' },
          { designation: 'Mise en service', quantity: 1, unit: 'forfait', item_type: 'free' },
        ],
      },
      {
        name: 'Entretien annuel',
        description: 'Base de maintenance planifiée.',
        category: 'Entretien',
        unit: 'forfait',
        vat_rate: 20,
        profile_kind: 'service',
        lines: [
          { designation: 'Visite de contrôle', quantity: 1, unit: 'forfait', item_type: 'free' },
          { designation: 'Petits réglages', quantity: 1, unit: 'forfait', item_type: 'free' },
        ],
      },
      {
        name: 'Intervention forfaitaire',
        description: 'Forfait standard avec déplacement et intervention.',
        category: 'Dépannage',
        unit: 'forfait',
        vat_rate: 20,
        profile_kind: 'service',
        lines: [
          { designation: 'Déplacement', quantity: 1, unit: 'forfait', item_type: 'free' },
          { designation: 'Intervention sur site', quantity: 1, unit: 'forfait', item_type: 'free' },
        ],
      },
    ],
    laborRateUi: {
      modalTitle: "Nouvelle ressource interne",
      designationLabel: "Intitulé de la ressource",
      costLabel: "Coût entreprise / unité",
      rateLabel: "Valorisation interne / unité",
      typeHumanLabel: "Main-d'oeuvre",
      typeMachineLabel: "Engin / machine",
      typeEquipmentLabel: "Équipement amorti",
      typeSubcontractorLabel: "Sous-traitant",
      typeOtherLabel: "Autre charge",
      referencePlaceholder: "ex: MO-CHARP",
      tableColumnType: "Ressource",
    },
    bundleTemplateUi: {
      lineTypeLabels: {
        service: "Prestation",
        labor: "Main-d'oeuvre",
        material: "Fourniture",
        transport: "Déplacement",
        free: "Ligne libre",
        equipment: "Équipement amorti",
      },
      internalLineHelp: "Les lignes internes (main-d'oeuvre, déplacements, équipements) contribuent au coût de revient mais n'apparaissent pas dans le devis client.",
      sectionPlaceholder: "ex: Menuiserie intérieure",
      catalogMaterialHint: "Chercher une fourniture...",
      catalogLaborHint: "Chercher une ressource interne...",
    },
    resourceTypeOptions: [],
  },
  industry: {
    activityId: 'tolerie',
    businessProfile: 'industry',
    sectorFallback: 'Tôlerie',
    onboardingLabel: 'Tôlerie / industrie',
    onboardingDescription: 'Matières, opérations, postes de charge et gammes atelier.',
    labelSet: buildLabelSet({
      catalogTitle: 'Catalogue atelier',
      catalogSubtitle: 'Matières, opérations, ressources internes et gammes adaptées à votre production.',
      material: ['Matière', 'Matières', 'Nouvelle matière', "Aucune matière pour l'instant", 'Commencez par ajouter vos premières matières.'],
      service: ['Opération', 'Opérations', 'Nouvelle opération', "Aucune opération pour l'instant", 'Commencez par ajouter vos opérations vendues.'],
      laborRate: ['Ressource interne', 'Ressources internes', 'Nouvelle ressource interne', "Aucune ressource interne pour l'instant", 'Commencez par ajouter vos postes de charge internes.'],
      bundleTemplate: ['Gamme', 'Gammes', 'Nouvelle gamme', "Aucune gamme pour l'instant", 'Créez des gammes réutilisables pour vos chiffrages atelier.'],
    }),
    unitSet: ['kg', 'ml', 'm²', 'h', 'u', 'forfait', 'jour'],
    unitSetsByKind: {
      material: ['kg', 'ml', 'm²', 'u', 'forfait'],
      service: ['u', 'forfait', 'ml', 'm²', 'h'],
      laborRate: ['h', 'jour', 'u', 'forfait'],
    },
    defaultCategories: {
      material: ['Tôle brute', 'Profilé', 'Consommables', 'Finition'],
      service: ['Découpe', 'Pliage', 'Soudure', 'Assemblage'],
      laborRate: ['Atelier', 'Machine', 'Finition'],
      bundleTemplate: ['Série courte', 'Prototype', 'Assemblage'],
    },
    starterPresets: [
      {
        name: 'Découpe simple',
        description: 'Base de chiffrage pour découpe simple.',
        category: 'Série courte',
        unit: 'u',
        vat_rate: 20,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Préparation matière', quantity: 1, unit: 'u', item_type: 'free' },
          { designation: 'Découpe', quantity: 1, unit: 'u', item_type: 'free' },
        ],
      },
      {
        name: 'Découpe laser',
        description: 'Base de chiffrage pour opération de découpe laser.',
        category: 'Série courte',
        unit: 'u',
        vat_rate: 20,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Programmation machine', quantity: 1, unit: 'forfait', item_type: 'free' },
          { designation: 'Découpe laser', quantity: 1, unit: 'u', item_type: 'free' },
        ],
      },
      {
        name: 'Pliage standard',
        description: 'Gamme type de pliage atelier.',
        category: 'Prototype',
        unit: 'u',
        vat_rate: 20,
        profile_kind: 'service',
        lines: [
          { designation: 'Réglage presse plieuse', quantity: 1, unit: 'forfait', item_type: 'free' },
          { designation: 'Pliage', quantity: 1, unit: 'u', item_type: 'free' },
        ],
      },
      {
        name: 'Ensemble soudé',
        description: 'Base de chiffrage pour assemblage soudé.',
        category: 'Assemblage',
        unit: 'u',
        vat_rate: 20,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Pointage et assemblage', quantity: 1, unit: 'u', item_type: 'free' },
          { designation: 'Soudure et reprise', quantity: 1, unit: 'u', item_type: 'free' },
        ],
      },
      {
        name: 'Prototype atelier',
        description: 'Gamme de base pour pièce unitaire atelier.',
        category: 'Prototype',
        unit: 'u',
        vat_rate: 20,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Préparation et contrôle', quantity: 1, unit: 'forfait', item_type: 'free' },
          { designation: 'Fabrication prototype', quantity: 1, unit: 'u', item_type: 'free' },
        ],
      },
    ],
    laborRateUi: {
      modalTitle: "Nouvelle ressource interne",
      designationLabel: "Désignation de la ressource",
      costLabel: "Coût entreprise / unité",
      rateLabel: "Valorisation interne / unité",
      typeHumanLabel: "Humain",
      typeMachineLabel: "Machine",
      typeEquipmentLabel: "Outillage amorti",
      typeSubcontractorLabel: "Sous-traitant",
      typeOtherLabel: "Autre charge",
      referencePlaceholder: "ex: PC-LASER",
      tableColumnType: "Ressource",
    },
    bundleTemplateUi: {
      lineTypeLabels: {
        service: "Opération vendue",
        labor: "Poste de charge",
        material: "Matière",
        transport: "Logistique",
        free: "Ligne libre",
        equipment: "Équipement amorti",
      },
      internalLineHelp: "Les lignes internes (postes de charge, logistique, équipements) contribuent au coût de revient mais n'apparaissent pas dans le devis client.",
      sectionPlaceholder: "ex: Découpe laser",
      catalogMaterialHint: "Chercher une matière...",
      catalogLaborHint: "Chercher une ressource interne...",
    },
    resourceTypeOptions: [],
  },
}

Object.values(BUSINESS_PROFILE_CONFIGS).forEach((config) => {
  config.resourceTypeOptions = buildResourceTypeOptions(config.laborRateUi)
})

type BusinessActivityConfigOverride = {
  labelSet?: Partial<CatalogLabelSet>
  unitSet?: string[]
  unitSetsByKind?: Partial<BusinessProfileConfig['unitSetsByKind']>
  defaultCategories?: Partial<DefaultCategories>
  starterPresets?: StarterPreset[]
  laborRateUi?: Partial<LaborRateUi>
  bundleTemplateUi?: Partial<BundleTemplateUi>
}

const BUSINESS_ACTIVITY_OVERRIDES: Partial<Record<BusinessActivityId, BusinessActivityConfigOverride>> = {
  vitrerie: {
    labelSet: { catalogSubtitle: 'Produits, interventions vitrerie et ressources adaptées aux surfaces vitrées.' },
    defaultCategories: {
      service: ['Vitrerie intérieure', 'Façades vitrées', 'Verrières'],
      laborRate: ['Binôme vitrerie', 'Nacelle', 'Aspirateur eau'],
      bundleTemplate: ['Tournée vitres', 'Intervention ponctuelle', 'Contrat vitrerie'],
    },
    starterPresets: [
      {
        name: 'Tournée vitres intérieures',
        description: 'Passage régulier de nettoyage des vitres intérieures.',
        category: 'Tournée vitres',
        unit: 'forfait',
        vat_rate: 20,
        profile_kind: 'service',
        lines: [
          { designation: 'Nettoyage vitres intérieures', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Essuyage et finition', quantity: 1, unit: 'forfait', item_type: 'free' },
        ],
      },
      {
        name: 'Vitrerie extérieure façade',
        description: 'Nettoyage de façade vitrée avec nacelle ou perche.',
        category: 'Contrat vitrerie',
        unit: 'forfait',
        vat_rate: 20,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Nettoyage vitres extérieures', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Mise en place matériel nacelle', quantity: 1, unit: 'forfait', item_type: 'free' },
        ],
      },
      {
        name: 'Contrat vitrerie mensuel',
        description: 'Contrat récurrent mensuel pour entretien des surfaces vitrées.',
        category: 'Contrat vitrerie',
        unit: 'forfait',
        vat_rate: 20,
        profile_kind: 'service',
        lines: [
          { designation: 'Vitrerie intérieure', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Vitrerie extérieure', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Compte-rendu intervention', quantity: 1, unit: 'forfait', item_type: 'free' },
        ],
      },
    ],
  },
  desinfection: {
    labelSet: { catalogSubtitle: 'Produits, protocoles et ressources dédiés aux traitements de désinfection.' },
    defaultCategories: {
      service: ['Traitement', 'Désinfection', 'Décontamination'],
      laborRate: ['Équipe mobile', 'Pulvérisateur', 'Nébulisation'],
    },
    starterPresets: [
      {
        name: 'Désinfection ponctuelle',
        description: 'Traitement de désinfection sur intervention unique.',
        category: 'Ponctuel',
        unit: 'forfait',
        vat_rate: 20,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Application désinfectant surfaces', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Produit désinfectant', quantity: 1, unit: 'L', item_type: 'material' },
          { designation: "Compte-rendu d'intervention", quantity: 1, unit: 'forfait', item_type: 'free' },
        ],
      },
      {
        name: 'Protocole nébulisation',
        description: 'Désinfection par nébulisation de locaux.',
        category: 'Ponctuel',
        unit: 'forfait',
        vat_rate: 20,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Nébulisation des locaux', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Produit nébulisation', quantity: 1, unit: 'L', item_type: 'material' },
          { designation: 'Temps de contact et aération', quantity: 1, unit: 'h', item_type: 'free' },
        ],
      },
      {
        name: 'Contrat désinfection mensuel',
        description: 'Traitement récurrent mensuel de désinfection.',
        category: 'Mensuel',
        unit: 'forfait',
        vat_rate: 20,
        profile_kind: 'service',
        lines: [
          { designation: 'Désinfection sanitaires', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Désinfection surfaces communes', quantity: 1, unit: 'forfait', item_type: 'service' },
        ],
      },
    ],
  },
  electricite: {
    labelSet: { catalogSubtitle: 'Fournitures, prestations et ressources cohérentes avec vos interventions électriques.' },
    defaultCategories: {
      material: ['Tableau', 'Câblage', 'Appareillage', 'Dépannage'],
      service: ['Pose', 'Recherche de panne', 'Mise en conformité'],
      bundleTemplate: ['Installation', 'Dépannage', 'Mise en conformité', 'Rénovation électrique'],
    },
    starterPresets: [
      {
        name: 'Tableau électrique neuf',
        description: 'Fourniture et pose de tableau électrique avec protection différentielle.',
        category: 'Installation',
        unit: 'forfait',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Tableau électrique 13 modules', quantity: 1, unit: 'u', item_type: 'material', unit_price_ht: 120 },
          { designation: 'Disjoncteurs et différentiels', quantity: 1, unit: 'forfait', item_type: 'material' },
          { designation: 'Pose et câblage tableau', quantity: 4, unit: 'h', item_type: 'service' },
          { designation: 'Essais et mise en service', quantity: 1, unit: 'forfait', item_type: 'service' },
        ],
      },
      {
        name: 'Dépannage électrique',
        description: 'Intervention de dépannage avec diagnostic et remise en service.',
        category: 'Dépannage',
        unit: 'forfait',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Déplacement et diagnostic', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Intervention et réparation', quantity: 1, unit: 'h', item_type: 'service' },
          { designation: 'Petites fournitures', quantity: 1, unit: 'forfait', item_type: 'material' },
        ],
      },
      {
        name: 'Mise en conformité électrique',
        description: 'Diagnostic et mise en conformité selon normes NF C 15-100.',
        category: 'Mise en conformité',
        unit: 'forfait',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Diagnostic électrique complet', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Mise en conformité tableaux et circuits', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Fournitures de mise en conformité', quantity: 1, unit: 'forfait', item_type: 'material' },
          { designation: 'Rapport de conformité', quantity: 1, unit: 'forfait', item_type: 'free' },
        ],
      },
      {
        name: 'Rénovation électrique complète',
        description: 'Réfection totale de l\'installation électrique d\'un logement.',
        category: 'Rénovation électrique',
        unit: 'forfait',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Dépose ancienne installation', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Passage de câbles', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Pose tableau neuf et protection', quantity: 1, unit: 'forfait', item_type: 'mixed' },
          { designation: 'Pose prises et interrupteurs', quantity: 1, unit: 'forfait', item_type: 'mixed' },
          { designation: 'Essais, mise en service et rapport', quantity: 1, unit: 'forfait', item_type: 'free' },
        ],
      },
      {
        name: 'Pose points lumineux',
        description: 'Fourniture et pose de points lumineux avec câblage.',
        category: 'Installation',
        unit: 'u',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Câblage et raccordement', quantity: 1, unit: 'u', item_type: 'service' },
          { designation: 'Boite de dérivation', quantity: 1, unit: 'u', item_type: 'material' },
          { designation: 'Interrupteur ou variateur', quantity: 1, unit: 'u', item_type: 'material' },
        ],
      },
    ],
  },
  plomberie: {
    labelSet: { catalogSubtitle: 'Fournitures, prestations et ressources adaptées aux chantiers de plomberie.' },
    defaultCategories: {
      material: ['Réseaux', 'Sanitaire', 'Chauffe-eau', 'Dépannage'],
      service: ['Installation', 'Recherche de fuite', 'Maintenance'],
      bundleTemplate: ['Salle de bain', 'Dépannage', 'Chauffe-eau', 'Réseau'],
    },
    starterPresets: [
      {
        name: 'Remplacement chauffe-eau',
        description: 'Dépose et remplacement de chauffe-eau électrique avec raccordement.',
        category: 'Chauffe-eau',
        unit: 'forfait',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Dépose ancien chauffe-eau', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Chauffe-eau électrique 200L', quantity: 1, unit: 'u', item_type: 'material' },
          { designation: 'Raccordement eau et électricité', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Groupe de sécurité et accessoires', quantity: 1, unit: 'forfait', item_type: 'material' },
          { designation: 'Mise en service et essais', quantity: 1, unit: 'forfait', item_type: 'free' },
        ],
      },
      {
        name: 'Rénovation salle de bain complète',
        description: 'Réfection complète de salle de bain avec dépose et pose.',
        category: 'Salle de bain',
        unit: 'forfait',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Dépose équipements existants', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Réseaux eau froide / chaude', quantity: 1, unit: 'forfait', item_type: 'mixed' },
          { designation: 'Pose receveur de douche', quantity: 1, unit: 'u', item_type: 'mixed' },
          { designation: 'Pose lavabo et robinetterie', quantity: 1, unit: 'u', item_type: 'mixed' },
          { designation: 'Pose WC suspendu', quantity: 1, unit: 'u', item_type: 'mixed' },
          { designation: 'Evacuation et siphons', quantity: 1, unit: 'forfait', item_type: 'mixed' },
        ],
      },
      {
        name: 'Recherche et réparation de fuite',
        description: 'Intervention de détection et réparation de fuite.',
        category: 'Dépannage',
        unit: 'forfait',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Déplacement et diagnostic', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Recherche de fuite', quantity: 1, unit: 'h', item_type: 'service' },
          { designation: 'Réparation et fournitures', quantity: 1, unit: 'forfait', item_type: 'mixed' },
        ],
      },
      {
        name: 'Débouchage canalisation',
        description: 'Intervention de débouchage par furet ou haute pression.',
        category: 'Dépannage',
        unit: 'forfait',
        vat_rate: 10,
        profile_kind: 'service',
        lines: [
          { designation: 'Déplacement', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Débouchage furet motorisé', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Test d\'écoulement', quantity: 1, unit: 'forfait', item_type: 'free' },
        ],
      },
      {
        name: 'Entretien chaudière annuel',
        description: 'Contrat d\'entretien annuel de chaudière gaz.',
        category: 'Maintenance',
        unit: 'forfait',
        vat_rate: 10,
        profile_kind: 'service',
        lines: [
          { designation: 'Nettoyage brûleur et échangeur', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Contrôle combustion et sécurités', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Rapport d\'entretien', quantity: 1, unit: 'forfait', item_type: 'free' },
        ],
      },
    ],
  },
  menuiserie: {
    starterPresets: [
      {
        name: 'Pose fenêtre PVC double vitrage',
        description: 'Dépose et remplacement de fenêtre PVC avec isolation.',
        category: 'Pose',
        unit: 'u',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Dépose ancienne fenêtre', quantity: 1, unit: 'u', item_type: 'service' },
          { designation: 'Fenêtre PVC double vitrage', quantity: 1, unit: 'u', item_type: 'material' },
          { designation: 'Pose et calfeutrement', quantity: 1, unit: 'u', item_type: 'service' },
          { designation: 'Joint mousse et silicone', quantity: 1, unit: 'forfait', item_type: 'material' },
        ],
      },
      {
        name: 'Pose porte intérieure',
        description: 'Fourniture et pose de porte intérieure avec huisserie.',
        category: 'Pose',
        unit: 'u',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Porte intérieure avec huisserie', quantity: 1, unit: 'u', item_type: 'material' },
          { designation: 'Pose huisserie et calage', quantity: 1, unit: 'u', item_type: 'service' },
          { designation: 'Pose porte et réglage', quantity: 1, unit: 'u', item_type: 'service' },
          { designation: 'Serrure et quincaillerie', quantity: 1, unit: 'u', item_type: 'material' },
        ],
      },
      {
        name: 'Fabrication meuble sur mesure',
        description: 'Conception et fabrication de meuble en bois sur mesure.',
        category: 'Fabrication',
        unit: 'forfait',
        vat_rate: 20,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Étude et plans', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Panneaux bois et accessoires', quantity: 1, unit: 'forfait', item_type: 'material' },
          { designation: 'Fabrication atelier', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Pose et réglages', quantity: 1, unit: 'forfait', item_type: 'service' },
        ],
      },
      {
        name: 'Pose parquet flottant',
        description: 'Fourniture et pose de parquet flottant avec sous-couche.',
        category: 'Pose',
        unit: 'm²',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Parquet flottant', quantity: 1, unit: 'm²', item_type: 'material' },
          { designation: 'Sous-couche acoustique', quantity: 1, unit: 'm²', item_type: 'material' },
          { designation: 'Pose et plinthes', quantity: 1, unit: 'm²', item_type: 'service' },
        ],
      },
    ],
  },
  maconnerie: {
    starterPresets: [
      {
        name: 'Dalle béton',
        description: 'Réalisation d\'une dalle béton armée avec coffrage.',
        category: 'Gros oeuvre',
        unit: 'm²',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Terrassement et préparation fond de forme', quantity: 1, unit: 'm²', item_type: 'service' },
          { designation: 'Gravillon et film polyane', quantity: 1, unit: 'm²', item_type: 'material' },
          { designation: 'Ferraillage treillis soudé', quantity: 1, unit: 'm²', item_type: 'material' },
          { designation: 'Coulage béton', quantity: 1, unit: 'm²', item_type: 'mixed' },
        ],
      },
      {
        name: 'Mur en parpaing',
        description: 'Construction d\'un mur en parpaings avec enduit.',
        category: 'Maçonnerie',
        unit: 'm²',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Parpaings 20x20x50', quantity: 1, unit: 'm²', item_type: 'material' },
          { designation: 'Mortier de pose', quantity: 1, unit: 'm²', item_type: 'material' },
          { designation: 'Montage et chaînage', quantity: 1, unit: 'm²', item_type: 'service' },
          { designation: 'Enduit de finition', quantity: 1, unit: 'm²', item_type: 'mixed' },
        ],
      },
      {
        name: 'Création d\'ouverture',
        description: 'Création d\'une ouverture dans mur porteur avec linteau.',
        category: 'Gros oeuvre',
        unit: 'forfait',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Étaiement et sécurisation', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Démolition et découpe', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Linteau béton armé', quantity: 1, unit: 'u', item_type: 'material' },
          { designation: 'Rebouchage et finitions', quantity: 1, unit: 'forfait', item_type: 'mixed' },
        ],
      },
    ],
  },
  peinture: {
    starterPresets: [
      {
        name: 'Peinture intérieure pièce',
        description: 'Peinture complète d\'une pièce (murs et plafond).',
        category: 'Peinture intérieure',
        unit: 'm²',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Préparation et rebouchage', quantity: 1, unit: 'm²', item_type: 'service' },
          { designation: 'Impression', quantity: 1, unit: 'm²', item_type: 'mixed' },
          { designation: 'Peinture 2 couches', quantity: 1, unit: 'm²', item_type: 'mixed' },
          { designation: 'Protection sols et mobilier', quantity: 1, unit: 'forfait', item_type: 'free' },
        ],
      },
      {
        name: 'Ravalement de façade',
        description: 'Nettoyage haute pression et peinture façade.',
        category: 'Peinture extérieure',
        unit: 'm²',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Nettoyage haute pression', quantity: 1, unit: 'm²', item_type: 'service' },
          { designation: 'Rebouchage fissures', quantity: 1, unit: 'm²', item_type: 'mixed' },
          { designation: 'Peinture façade 2 couches', quantity: 1, unit: 'm²', item_type: 'mixed' },
        ],
      },
      {
        name: 'Pose papier peint',
        description: 'Dépose et pose de papier peint.',
        category: 'Revêtement mural',
        unit: 'm²',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Dépose ancien revêtement', quantity: 1, unit: 'm²', item_type: 'service' },
          { designation: 'Préparation mur', quantity: 1, unit: 'm²', item_type: 'service' },
          { designation: 'Papier peint et colle', quantity: 1, unit: 'm²', item_type: 'material' },
          { designation: 'Pose papier peint', quantity: 1, unit: 'm²', item_type: 'service' },
        ],
      },
    ],
  },
  carrelage: {
    starterPresets: [
      {
        name: 'Pose carrelage sol',
        description: 'Fourniture et pose carrelage sol avec joint.',
        category: 'Carrelage sol',
        unit: 'm²',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Ragréage sol', quantity: 1, unit: 'm²', item_type: 'mixed' },
          { designation: 'Carrelage sol', quantity: 1, unit: 'm²', item_type: 'material' },
          { designation: 'Pose colle et joint', quantity: 1, unit: 'm²', item_type: 'mixed' },
          { designation: 'Plinthes et finitions', quantity: 1, unit: 'ml', item_type: 'mixed' },
        ],
      },
      {
        name: 'Pose faïence murale',
        description: 'Fourniture et pose faïence murale salle de bain ou cuisine.',
        category: 'Faïence',
        unit: 'm²',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Préparation support', quantity: 1, unit: 'm²', item_type: 'service' },
          { designation: 'Faïence murale', quantity: 1, unit: 'm²', item_type: 'material' },
          { designation: 'Pose colle et joint', quantity: 1, unit: 'm²', item_type: 'mixed' },
        ],
      },
      {
        name: 'Dépose et repose carrelage',
        description: 'Dépose de l\'existant et repose avec nouveau carrelage.',
        category: 'Rénovation',
        unit: 'm²',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Dépose carrelage existant', quantity: 1, unit: 'm²', item_type: 'service' },
          { designation: 'Ragréage et préparation', quantity: 1, unit: 'm²', item_type: 'mixed' },
          { designation: 'Carrelage et pose', quantity: 1, unit: 'm²', item_type: 'mixed' },
        ],
      },
    ],
  },
  facade: {
    starterPresets: [
      {
        name: 'Ravalement enduit projeté',
        description: 'Ravalement de façade avec enduit hydraulique projeté.',
        category: 'Ravalement',
        unit: 'm²',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Nettoyage et démoussage', quantity: 1, unit: 'm²', item_type: 'service' },
          { designation: 'Rebouchage fissures et arêtes', quantity: 1, unit: 'forfait', item_type: 'mixed' },
          { designation: 'Enduit hydraulique projeté', quantity: 1, unit: 'm²', item_type: 'mixed' },
          { designation: 'Finition grattée ou lissée', quantity: 1, unit: 'm²', item_type: 'service' },
        ],
      },
      {
        name: 'ITE (isolation thermique extérieure)',
        description: 'Isolation par l\'extérieur avec enduit de finition.',
        category: 'ITE',
        unit: 'm²',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Pose panneaux isolants', quantity: 1, unit: 'm²', item_type: 'mixed' },
          { designation: 'Treillis et enduit de base', quantity: 1, unit: 'm²', item_type: 'mixed' },
          { designation: 'Enduit de finition', quantity: 1, unit: 'm²', item_type: 'mixed' },
          { designation: 'Profils et accessoires', quantity: 1, unit: 'forfait', item_type: 'material' },
        ],
      },
    ],
  },
  charpente: {
    starterPresets: [
      {
        name: 'Charpente traditionnelle',
        description: 'Fourniture et pose de charpente bois traditionnelle.',
        category: 'Charpente',
        unit: 'forfait',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Bois de charpente (chevrons, faîtage)', quantity: 1, unit: 'forfait', item_type: 'material' },
          { designation: 'Pose et assemblage charpente', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Contreventement et fixations', quantity: 1, unit: 'forfait', item_type: 'material' },
        ],
      },
      {
        name: 'Couverture tuiles',
        description: 'Dépose et repose de couverture tuiles avec sous-toiture.',
        category: 'Couverture',
        unit: 'm²',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Dépose tuiles et liteaux', quantity: 1, unit: 'm²', item_type: 'service' },
          { designation: 'Écran sous-toiture', quantity: 1, unit: 'm²', item_type: 'material' },
          { designation: 'Liteaux et contre-liteaux', quantity: 1, unit: 'm²', item_type: 'material' },
          { designation: 'Repose tuiles', quantity: 1, unit: 'm²', item_type: 'service' },
          { designation: 'Faîtage et arêtiers', quantity: 1, unit: 'ml', item_type: 'mixed' },
        ],
      },
      {
        name: 'Zinguerie gouttières',
        description: 'Dépose et remplacement de gouttières et descentes.',
        category: 'Zinguerie',
        unit: 'ml',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Dépose gouttières existantes', quantity: 1, unit: 'ml', item_type: 'service' },
          { designation: 'Gouttière zinc ou alu', quantity: 1, unit: 'ml', item_type: 'material' },
          { designation: 'Pose et fixation', quantity: 1, unit: 'ml', item_type: 'service' },
          { designation: 'Descentes et raccords', quantity: 1, unit: 'forfait', item_type: 'mixed' },
        ],
      },
    ],
  },
  renovation: {
    starterPresets: [
      {
        name: 'Rénovation complète appartement',
        description: 'Réfection tous corps d\'état d\'un appartement.',
        category: 'Rénovation',
        unit: 'forfait',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Démolition et dépose', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Plâtrerie / cloisons', quantity: 1, unit: 'forfait', item_type: 'mixed' },
          { designation: 'Électricité', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Plomberie', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Carrelage et faïence', quantity: 1, unit: 'forfait', item_type: 'mixed' },
          { designation: 'Peinture', quantity: 1, unit: 'forfait', item_type: 'mixed' },
          { designation: 'Menuiseries intérieures', quantity: 1, unit: 'forfait', item_type: 'mixed' },
        ],
      },
      {
        name: 'Rénovation salle de bain',
        description: 'Réfection complète salle de bain tous corps d\'état.',
        category: 'Rénovation',
        unit: 'forfait',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Dépose équipements et revêtements', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Plomberie et évacuations', quantity: 1, unit: 'forfait', item_type: 'mixed' },
          { designation: 'Carrelage sol et faïence murale', quantity: 1, unit: 'forfait', item_type: 'mixed' },
          { designation: 'Fourniture et pose sanitaires', quantity: 1, unit: 'forfait', item_type: 'mixed' },
          { designation: 'Peinture et finitions', quantity: 1, unit: 'forfait', item_type: 'mixed' },
        ],
      },
    ],
  },
  tolerie: {
    labelSet: { catalogSubtitle: 'Matières, opérations vendues et postes internes dédiés à la tôlerie.' },
    defaultCategories: {
      material: ['Tôle brute', 'Bac acier', 'Pliage', 'Découpe'],
      service: ['Découpe', 'Pliage', 'Finition'],
      laborRate: ['Laser', 'Presse plieuse', 'Outillage amorti'],
      bundleTemplate: ['Pièce unitaire', 'Série courte', 'Assemblage', 'Sous-traitance'],
    },
    starterPresets: [
      {
        name: 'Découpe tôle + pliage simple',
        description: 'Découpe et pliage d\'une pièce tôle acier standard.',
        category: 'Pièce unitaire',
        unit: 'u',
        vat_rate: 20,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Tôle acier S235 2mm', quantity: 1, unit: 'kg', item_type: 'material' },
          { designation: 'Découpe cisaille ou laser', quantity: 1, unit: 'u', item_type: 'service' },
          { designation: 'Pliage presse plieuse', quantity: 1, unit: 'u', item_type: 'service' },
          { designation: 'Ébavurage et contrôle', quantity: 1, unit: 'u', item_type: 'service' },
        ],
      },
      {
        name: 'Ensemble soudé sur plan',
        description: 'Fabrication d\'un ensemble soudé à partir d\'un plan client.',
        category: 'Assemblage',
        unit: 'u',
        vat_rate: 20,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Débit matière', quantity: 1, unit: 'kg', item_type: 'material' },
          { designation: 'Découpe des éléments', quantity: 1, unit: 'u', item_type: 'service' },
          { designation: 'Pliage', quantity: 1, unit: 'u', item_type: 'service' },
          { designation: 'Pointage et soudure', quantity: 1, unit: 'u', item_type: 'service' },
          { designation: 'Finition et contrôle dimensionnel', quantity: 1, unit: 'u', item_type: 'service' },
        ],
      },
      {
        name: 'Série courte tôlerie',
        description: 'Production en série courte avec réglages machine inclus.',
        category: 'Série courte',
        unit: 'u',
        vat_rate: 20,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Mise au point programme / réglage', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Matière première', quantity: 1, unit: 'kg', item_type: 'material' },
          { designation: 'Découpe et pliage série', quantity: 1, unit: 'u', item_type: 'service' },
          { designation: 'Contrôle et conditionnement', quantity: 1, unit: 'forfait', item_type: 'service' },
        ],
      },
    ],
  },
  chaudronnerie: {
    starterPresets: [
      {
        name: 'Ouvrage chaudronné sur plan',
        description: 'Fabrication d\'un ouvrage métallique sur plan client.',
        category: 'Fabrication',
        unit: 'u',
        vat_rate: 20,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Étude et mise en plan', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Débit et préparation matière', quantity: 1, unit: 'kg', item_type: 'material' },
          { designation: 'Formage et assemblage', quantity: 1, unit: 'u', item_type: 'service' },
          { designation: 'Soudure TIG/MIG', quantity: 1, unit: 'u', item_type: 'service' },
          { designation: 'Contrôle et finition', quantity: 1, unit: 'u', item_type: 'service' },
        ],
      },
      {
        name: 'Réparation ouvrage existant',
        description: 'Intervention de réparation sur équipement chaudronné.',
        category: 'Réparation',
        unit: 'forfait',
        vat_rate: 20,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Diagnostic et dépose', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Fournitures de remplacement', quantity: 1, unit: 'forfait', item_type: 'material' },
          { designation: 'Soudure et remontage', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Contrôle et essai', quantity: 1, unit: 'forfait', item_type: 'free' },
        ],
      },
    ],
  },
  decoupe_laser: {
    labelSet: { catalogSubtitle: 'Matières, opérations et postes de charge orientés découpe laser.' },
    defaultCategories: {
      service: ['Découpe laser', 'Programmation', 'Ébavurage'],
      laborRate: ['Machine laser', 'Approvisionnement', 'Maintenance'],
      bundleTemplate: ['Pièce standard', 'Série laser', 'Prototype'],
    },
    starterPresets: [
      {
        name: 'Découpe laser pièce standard',
        description: 'Découpe laser d\'une pièce acier ou inox standard.',
        category: 'Pièce standard',
        unit: 'u',
        vat_rate: 20,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Programmation DXF / CAO', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Tôle acier ou inox', quantity: 1, unit: 'kg', item_type: 'material' },
          { designation: 'Découpe laser', quantity: 1, unit: 'u', item_type: 'service' },
          { designation: 'Ébavurage et contrôle', quantity: 1, unit: 'u', item_type: 'service' },
        ],
      },
      {
        name: 'Série laser répétitive',
        description: 'Production en série avec imbrication optimisée.',
        category: 'Série laser',
        unit: 'u',
        vat_rate: 20,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Imbrication et lancement série', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Matière', quantity: 1, unit: 'kg', item_type: 'material' },
          { designation: 'Découpe laser série', quantity: 1, unit: 'u', item_type: 'service' },
          { designation: 'Tri et conditionnement', quantity: 1, unit: 'forfait', item_type: 'service' },
        ],
      },
    ],
  },
  pliage: {
    starterPresets: [
      {
        name: 'Pliage série standard',
        description: 'Pliage de pièces en série avec réglage presse plieuse.',
        category: 'Série',
        unit: 'u',
        vat_rate: 20,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Réglage outil et programme pliage', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Matière (fournie ou à fournir)', quantity: 1, unit: 'kg', item_type: 'material' },
          { designation: 'Pliage presse plieuse', quantity: 1, unit: 'u', item_type: 'service' },
          { designation: 'Contrôle angulaire', quantity: 1, unit: 'u', item_type: 'free' },
        ],
      },
      {
        name: 'Pliage prototype / pièce unique',
        description: 'Pliage unitaire avec temps de réglage complet.',
        category: 'Prototype',
        unit: 'u',
        vat_rate: 20,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Réglage machine', quantity: 1, unit: 'h', item_type: 'service' },
          { designation: 'Matière', quantity: 1, unit: 'kg', item_type: 'material' },
          { designation: 'Pliage et reprise', quantity: 1, unit: 'u', item_type: 'service' },
        ],
      },
    ],
  },
  soudure: {
    starterPresets: [
      {
        name: 'Soudure assemblage simple',
        description: 'Assemblage par soudure MIG ou MAG de pièces préparées.',
        category: 'Assemblage',
        unit: 'u',
        vat_rate: 20,
        profile_kind: 'service',
        lines: [
          { designation: 'Pointage et assemblage', quantity: 1, unit: 'u', item_type: 'service' },
          { designation: 'Soudure MIG/MAG', quantity: 1, unit: 'u', item_type: 'service' },
          { designation: 'Meulage et ébavurage', quantity: 1, unit: 'u', item_type: 'service' },
          { designation: 'Consommables soudure', quantity: 1, unit: 'forfait', item_type: 'material' },
        ],
      },
      {
        name: 'Soudure TIG inox / alu',
        description: 'Soudure TIG sur inox ou aluminium avec finition soignée.',
        category: 'Soudure fine',
        unit: 'u',
        vat_rate: 20,
        profile_kind: 'service',
        lines: [
          { designation: 'Préparation et dégraissage', quantity: 1, unit: 'u', item_type: 'service' },
          { designation: 'Soudure TIG', quantity: 1, unit: 'u', item_type: 'service' },
          { designation: 'Reprise et finition', quantity: 1, unit: 'u', item_type: 'service' },
          { designation: 'Gaz argon et consommables', quantity: 1, unit: 'forfait', item_type: 'material' },
        ],
      },
    ],
  },
  fabrication_atelier: {
    starterPresets: [
      {
        name: 'Fabrication pièce atelier complète',
        description: 'Fabrication atelier complète d\'une pièce de A à Z.',
        category: 'Fabrication',
        unit: 'u',
        vat_rate: 20,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Étude et plan de fabrication', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Approvisionnement matière', quantity: 1, unit: 'kg', item_type: 'material' },
          { designation: 'Usinage et formage', quantity: 1, unit: 'u', item_type: 'service' },
          { designation: 'Assemblage', quantity: 1, unit: 'u', item_type: 'service' },
          { designation: 'Contrôle qualité et conditionnement', quantity: 1, unit: 'u', item_type: 'free' },
        ],
      },
      {
        name: 'Prototype atelier',
        description: 'Réalisation d\'un prototype avec suivi et ajustements.',
        category: 'Prototype',
        unit: 'u',
        vat_rate: 20,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Analyse cahier des charges', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Matière et composants', quantity: 1, unit: 'forfait', item_type: 'material' },
          { designation: 'Fabrication et ajustements', quantity: 1, unit: 'u', item_type: 'service' },
          { designation: 'Test et validation', quantity: 1, unit: 'forfait', item_type: 'free' },
        ],
      },
    ],
  },
  remise_en_etat: {
    starterPresets: [
      {
        name: 'Remise en état après travaux',
        description: 'Nettoyage approfondi de fin de chantier.',
        category: 'Ponctuel',
        unit: 'forfait',
        vat_rate: 20,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Dépoussiérage et aspiration', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Nettoyage vitres et menuiseries', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Nettoyage sols et finitions', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Produits et consommables', quantity: 1, unit: 'forfait', item_type: 'material' },
        ],
      },
      {
        name: 'État des lieux sortant',
        description: 'Nettoyage complet pour restitution de local.',
        category: 'Ponctuel',
        unit: 'forfait',
        vat_rate: 20,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Nettoyage cuisine et sanitaires', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Nettoyage pièces à vivre', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Nettoyage vitres', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Produits et consommables', quantity: 1, unit: 'forfait', item_type: 'material' },
        ],
      },
    ],
  },
  depannage_multitechnique: {
    defaultCategories: {
      bundleTemplate: ['Dépannage', 'Entretien', 'Mise en service'],
    },
    starterPresets: [
      {
        name: 'Dépannage toutes trades',
        description: 'Intervention de dépannage multi-corps d\'état.',
        category: 'Dépannage',
        unit: 'forfait',
        vat_rate: 10,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Déplacement et diagnostic', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Intervention', quantity: 1, unit: 'h', item_type: 'service' },
          { designation: 'Petites fournitures', quantity: 1, unit: 'forfait', item_type: 'material' },
        ],
      },
      {
        name: 'Visite de maintenance préventive',
        description: 'Visite de contrôle et maintenance préventive des installations.',
        category: 'Entretien',
        unit: 'forfait',
        vat_rate: 10,
        profile_kind: 'service',
        lines: [
          { designation: 'Déplacement', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Contrôle électricité', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Contrôle plomberie', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Rapport d\'intervention', quantity: 1, unit: 'forfait', item_type: 'free' },
        ],
      },
    ],
  },
  nettoyage_bureaux: {
    starterPresets: [
      {
        name: 'Entretien hebdomadaire bureaux',
        description: 'Passage régulier d\'entretien des espaces de travail.',
        category: 'Hebdomadaire',
        unit: 'forfait',
        vat_rate: 20,
        profile_kind: 'service',
        lines: [
          { designation: 'Aspiration et lavage des sols', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Dépoussiérage bureaux et équipements', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Vidage des corbeilles', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Nettoyage sanitaires', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Produits et consommables', quantity: 1, unit: 'forfait', item_type: 'material' },
        ],
      },
      {
        name: 'Grand nettoyage annuel',
        description: 'Nettoyage approfondi annuel de l\'ensemble des locaux.',
        category: 'Ponctuel',
        unit: 'forfait',
        vat_rate: 20,
        profile_kind: 'mixed',
        lines: [
          { designation: 'Nettoyage vitres intérieures et extérieures', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Nettoyage moquettes / sols', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Dépoussiérage mobilier et cloisonnements', quantity: 1, unit: 'forfait', item_type: 'service' },
          { designation: 'Produits et consommables', quantity: 1, unit: 'forfait', item_type: 'material' },
        ],
      },
      {
        name: 'Contrat mensuel locaux commerciaux',
        description: 'Contrat mensuel pour parties communes et locaux commerciaux.',
        category: 'Mensuel',
        unit: 'forfait',
        vat_rate: 20,
        profile_kind: 'service',
        lines: [
          { designation: 'Entretien parties communes', quantity: 4, unit: 'passage', item_type: 'service' },
          { designation: 'Nettoyage sanitaires', quantity: 4, unit: 'passage', item_type: 'service' },
          { designation: 'Produits et consommables', quantity: 1, unit: 'forfait', item_type: 'material' },
        ],
      },
    ],
  },
}

export function getBusinessActivities(): BusinessActivityDefinition[] {
  return BUSINESS_ACTIVITIES
}

export function getBusinessActivityById(activityId: string | null | undefined): BusinessActivityDefinition | null {
  if (!activityId) return null
  return BUSINESS_ACTIVITIES.find((activity) => activity.id === activityId) ?? null
}

export function getDefaultBusinessActivityId(profile: BusinessProfile): BusinessActivityId {
  switch (profile) {
    case 'cleaning':
      return 'nettoyage_bureaux'
    case 'industry':
      return 'tolerie'
    case 'btp':
    default:
      return 'renovation'
  }
}

export function normalizeBusinessProfile(value: string | null | undefined): BusinessProfile {
  if (value === 'cleaning' || value === 'btp' || value === 'industry') return value
  return 'btp'
}

export function inferBusinessProfileFromActivity(activityId: string | null | undefined): BusinessProfile | null {
  const activity = getBusinessActivityById(activityId)
  return activity?.businessProfile ?? null
}

export function inferBusinessProfileFromSector(sector: string | null | undefined): BusinessProfile {
  const normalized = (sector ?? '').trim().toLowerCase()
  if (!normalized) return 'btp'

  if (
    normalized.includes('nettoyage') ||
    normalized.includes('entretien') ||
    normalized.includes('propreté') ||
    normalized.includes('proprete') ||
    normalized.includes('hygiène') ||
    normalized.includes('hygiene') ||
    normalized.includes('vitrerie') ||
    normalized.includes('désinfection') ||
    normalized.includes('desinfection')
  ) {
    return 'cleaning'
  }

  if (
    normalized.includes('industrie') ||
    normalized.includes('industri') ||
    normalized.includes('tôlerie') ||
    normalized.includes('tolerie') ||
    normalized.includes('chaudron') ||
    normalized.includes('atelier') ||
    normalized.includes('métal') ||
    normalized.includes('metal') ||
    normalized.includes('soudure') ||
    normalized.includes('découpe') ||
    normalized.includes('decoupe') ||
    normalized.includes('pliage')
  ) {
    return 'industry'
  }

  return 'btp'
}

export function inferBusinessActivityId(params: {
  sector?: string | null
  businessProfile?: string | null
}): BusinessActivityId {
  const normalizedSector = (params.sector ?? '').trim().toLowerCase()

  const directMatch = BUSINESS_ACTIVITIES.find((activity) => activity.label.toLowerCase() === normalizedSector)
  if (directMatch) return directMatch.id

  const containsMatch = BUSINESS_ACTIVITIES.find((activity) => normalizedSector.includes(activity.label.toLowerCase()))
  if (containsMatch) return containsMatch.id

  const resolvedProfile = params.businessProfile
    ? normalizeBusinessProfile(params.businessProfile)
    : inferBusinessProfileFromSector(params.sector)

  return getDefaultBusinessActivityId(resolvedProfile)
}

export function getBusinessProfileConfig(profile: BusinessProfile): BusinessProfileConfig {
  return BUSINESS_PROFILE_CONFIGS[profile]
}

function mergeBundleTemplateUi(base: BundleTemplateUi, override: unknown): BundleTemplateUi {
  if (!isPlainObject(override)) return base
  return {
    lineTypeLabels: {
      service: typeof override.lineTypeLabels === 'object' && override.lineTypeLabels !== null && typeof (override.lineTypeLabels as Record<string, unknown>).service === 'string'
        ? (override.lineTypeLabels as Record<string, string>).service
        : base.lineTypeLabels.service,
      labor: typeof override.lineTypeLabels === 'object' && override.lineTypeLabels !== null && typeof (override.lineTypeLabels as Record<string, unknown>).labor === 'string'
        ? (override.lineTypeLabels as Record<string, string>).labor
        : base.lineTypeLabels.labor,
      material: typeof override.lineTypeLabels === 'object' && override.lineTypeLabels !== null && typeof (override.lineTypeLabels as Record<string, unknown>).material === 'string'
        ? (override.lineTypeLabels as Record<string, string>).material
        : base.lineTypeLabels.material,
      transport: typeof override.lineTypeLabels === 'object' && override.lineTypeLabels !== null && typeof (override.lineTypeLabels as Record<string, unknown>).transport === 'string'
        ? (override.lineTypeLabels as Record<string, string>).transport
        : base.lineTypeLabels.transport,
      free: typeof override.lineTypeLabels === 'object' && override.lineTypeLabels !== null && typeof (override.lineTypeLabels as Record<string, unknown>).free === 'string'
        ? (override.lineTypeLabels as Record<string, string>).free
        : base.lineTypeLabels.free,
      equipment: typeof override.lineTypeLabels === 'object' && override.lineTypeLabels !== null && typeof (override.lineTypeLabels as Record<string, unknown>).equipment === 'string'
        ? (override.lineTypeLabels as Record<string, string>).equipment
        : base.lineTypeLabels.equipment,
    },
    internalLineHelp: typeof override.internalLineHelp === 'string' ? override.internalLineHelp : base.internalLineHelp,
    sectionPlaceholder: typeof override.sectionPlaceholder === 'string' ? override.sectionPlaceholder : base.sectionPlaceholder,
    catalogMaterialHint: typeof override.catalogMaterialHint === 'string' ? override.catalogMaterialHint : base.catalogMaterialHint,
    catalogLaborHint: typeof override.catalogLaborHint === 'string' ? override.catalogLaborHint : base.catalogLaborHint,
  }
}

function mergeLaborRateUi(base: LaborRateUi, override: unknown): LaborRateUi {
  if (!isPlainObject(override)) return base
  return {
    modalTitle: typeof override.modalTitle === 'string' ? override.modalTitle : base.modalTitle,
    designationLabel: typeof override.designationLabel === 'string' ? override.designationLabel : base.designationLabel,
    costLabel: typeof override.costLabel === 'string' ? override.costLabel : base.costLabel,
    rateLabel: typeof override.rateLabel === 'string' ? override.rateLabel : base.rateLabel,
    typeHumanLabel: typeof override.typeHumanLabel === 'string' ? override.typeHumanLabel : base.typeHumanLabel,
    typeMachineLabel: typeof override.typeMachineLabel === 'string' ? override.typeMachineLabel : base.typeMachineLabel,
    typeEquipmentLabel: typeof override.typeEquipmentLabel === 'string' ? override.typeEquipmentLabel : base.typeEquipmentLabel,
    typeSubcontractorLabel: typeof override.typeSubcontractorLabel === 'string' ? override.typeSubcontractorLabel : base.typeSubcontractorLabel,
    typeOtherLabel: typeof override.typeOtherLabel === 'string' ? override.typeOtherLabel : base.typeOtherLabel,
    referencePlaceholder: typeof override.referencePlaceholder === 'string' ? override.referencePlaceholder : base.referencePlaceholder,
    tableColumnType: typeof override.tableColumnType === 'string' ? override.tableColumnType : base.tableColumnType,
  }
}

function mergeUnitSetsByKind(
  base: BusinessProfileConfig['unitSetsByKind'],
  override: BusinessActivityConfigOverride['unitSetsByKind'],
): BusinessProfileConfig['unitSetsByKind'] {
  return {
    material: override?.material ?? base.material,
    service: override?.service ?? base.service,
    laborRate: override?.laborRate ?? base.laborRate,
  }
}

function mergeActivityConfig(base: BusinessProfileConfig, activityId: BusinessActivityId): BusinessProfileConfig {
  const activity = getBusinessActivityById(activityId)
  const activitySectorFallback = activity?.label ?? base.sectorFallback
  const override = BUSINESS_ACTIVITY_OVERRIDES[activityId]
  if (!override) {
    return {
      ...base,
      activityId,
      sectorFallback: activitySectorFallback,
      laborRateUi: base.laborRateUi,
      bundleTemplateUi: base.bundleTemplateUi,
      resourceTypeOptions: buildResourceTypeOptions(base.laborRateUi),
    }
  }

  const laborRateUi = mergeLaborRateUi(base.laborRateUi, override.laborRateUi)
  return {
    ...base,
    activityId,
    sectorFallback: activitySectorFallback,
    labelSet: mergeLabelSet(base.labelSet, override.labelSet),
    unitSet: override.unitSet ?? base.unitSet,
    unitSetsByKind: mergeUnitSetsByKind(base.unitSetsByKind, override.unitSetsByKind),
    defaultCategories: {
      material: override.defaultCategories?.material ?? base.defaultCategories.material,
      service: override.defaultCategories?.service ?? base.defaultCategories.service,
      laborRate: override.defaultCategories?.laborRate ?? base.defaultCategories.laborRate,
      bundleTemplate: override.defaultCategories?.bundleTemplate ?? base.defaultCategories.bundleTemplate,
    },
    starterPresets: override.starterPresets ?? base.starterPresets,
    laborRateUi,
    bundleTemplateUi: mergeBundleTemplateUi(base.bundleTemplateUi, override.bundleTemplateUi),
    resourceTypeOptions: buildResourceTypeOptions(laborRateUi),
  }
}

export function resolveBusinessSelection(params: {
  activityId?: string | null
  businessProfile?: string | null
  sector?: string | null
}): {
  activity: BusinessActivityDefinition
  businessProfile: BusinessProfile
  sectorLabel: string
  profileConfig: BusinessProfileConfig
} {
  const activityFromInput = getBusinessActivityById(params.activityId)
  const businessProfileFromInput = params.businessProfile ? normalizeBusinessProfile(params.businessProfile) : null

  const activityId = activityFromInput
    ? activityFromInput.id
    : inferBusinessActivityId({
        sector: params.sector,
        businessProfile: businessProfileFromInput,
      })

  const activity = getBusinessActivityById(activityId)!
  const businessProfile = activity.businessProfile
  const profileConfig = mergeActivityConfig(getBusinessProfileConfig(businessProfile), activity.id)

  return {
    activity,
    businessProfile,
    sectorLabel: activity.label,
    profileConfig,
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mergeLabelDefinitions(base: CatalogLabelDefinition, override: unknown): CatalogLabelDefinition {
  if (!isPlainObject(override)) return base
  return {
    singular: typeof override.singular === 'string' ? override.singular : base.singular,
    plural: typeof override.plural === 'string' ? override.plural : base.plural,
    createLabel: typeof override.createLabel === 'string' ? override.createLabel : base.createLabel,
    emptyLabel: typeof override.emptyLabel === 'string' ? override.emptyLabel : base.emptyLabel,
    emptyHelp: typeof override.emptyHelp === 'string' ? override.emptyHelp : base.emptyHelp,
  }
}

function mergeLabelSet(base: CatalogLabelSet, override: unknown): CatalogLabelSet {
  if (!isPlainObject(override)) return base
  return {
    catalogTitle: typeof override.catalogTitle === 'string' ? override.catalogTitle : base.catalogTitle,
    catalogSubtitle: typeof override.catalogSubtitle === 'string' ? override.catalogSubtitle : base.catalogSubtitle,
    material: mergeLabelDefinitions(base.material, override.material),
    service: mergeLabelDefinitions(base.service, override.service),
    laborRate: mergeLabelDefinitions(base.laborRate, override.laborRate),
    bundleTemplate: mergeLabelDefinitions(base.bundleTemplate, override.bundleTemplate),
  }
}

function mergeDefaultCategories(base: DefaultCategories, override: unknown): DefaultCategories {
  if (!isPlainObject(override)) return base
  const record = override as Record<string, unknown>

  function readList(key: keyof DefaultCategories): string[] {
    const value = record[key]
    if (!Array.isArray(value)) return base[key]
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
  }

  return {
    material: readList('material'),
    service: readList('service'),
    laborRate: readList('laborRate'),
    bundleTemplate: readList('bundleTemplate'),
  }
}

function mergeUnitSet(base: string[], override: unknown): string[] {
  if (!Array.isArray(override)) return base
  const units = override.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
  return units.length > 0 ? units : base
}

function mergeStarterPresets(base: StarterPreset[], override: unknown): StarterPreset[] {
  if (!Array.isArray(override)) return base
  return override.length > 0 ? (override as StarterPreset[]) : base
}

export function resolveCatalogContext(input?: OrganizationCatalogConfigInput | null): ResolvedCatalogContext {
  const { profileConfig } = resolveBusinessSelection({
    activityId: input?.business_activity_id,
    businessProfile: input?.business_profile,
    sector: input?.sector,
  })

  return {
    ...profileConfig,
    labelSet: mergeLabelSet(profileConfig.labelSet, input?.label_set),
    unitSet: mergeUnitSet(profileConfig.unitSet, input?.unit_set),
    defaultCategories: mergeDefaultCategories(profileConfig.defaultCategories, input?.default_categories),
    starterPresets: mergeStarterPresets(profileConfig.starterPresets, input?.starter_presets),
  }
}

export type CatalogAIPromptContext = {
  businessProfile: BusinessProfile
  activityLabel: string
  materialLabel: string
  serviceLabel: string
  laborRateLabel: string
  bundleTemplateLabel: string
  defaultCategories: DefaultCategories
  unitsByKind: BusinessProfileConfig['unitSetsByKind']
  vatRates: number[]
  dimensionModes: string[]
}

export function getCatalogAIPromptContext(profileConfig: BusinessProfileConfig): CatalogAIPromptContext {
  return {
    businessProfile: profileConfig.businessProfile,
    activityLabel: profileConfig.sectorFallback,
    materialLabel: profileConfig.labelSet.material.singular,
    serviceLabel: profileConfig.labelSet.service.singular,
    laborRateLabel: profileConfig.labelSet.laborRate.singular,
    bundleTemplateLabel: profileConfig.labelSet.bundleTemplate.singular,
    defaultCategories: profileConfig.defaultCategories,
    unitsByKind: profileConfig.unitSetsByKind,
    vatRates: [0, 5.5, 10, 20],
    dimensionModes: ['none', 'linear', 'area', 'volume'],
  }
}

export function getCatalogItemKindLabel(labels: CatalogLabelSet, itemKind: 'article' | 'service'): string {
  return itemKind === 'service' ? labels.service.singular : labels.material.singular
}

export function toCatalogItem(input: {
  id: string
  name: string
  reference: string | null
  category: string | null
  unit: string | null
  vat_rate: number | null
  sale_price: number | null
  margin_rate: number | null
  is_active: boolean
  purchase_price: number | null
  item_kind: 'article' | 'service'
  dimension_pricing_mode?: DimensionPricingMode | null
}): CatalogItem {
  return {
    id: input.id,
    kind: input.item_kind === 'service' ? 'service' : 'material',
    label: input.name,
    internal_ref: input.reference,
    category: input.category,
    unit: input.unit,
    vat_rate: input.vat_rate,
    sale_price_ht: input.sale_price,
    target_margin: input.margin_rate,
    is_active: input.is_active,
    purchase_cost_ht: input.purchase_price,
    dimensional_mode: input.dimension_pricing_mode ?? 'none',
  }
}

export function toLaborRateModel(input: {
  id: string
  designation: string
  unit: string | null
  cost_rate: number | null
  rate: number | null
  margin_rate: number | null
  category: string | null
  is_active: boolean
}): LaborRateModel {
  return {
    id: input.id,
    label: input.designation,
    unit: input.unit,
    hourly_cost_ht: input.cost_rate,
    hourly_sale_ht: input.rate,
    margin_target: input.margin_rate,
    role: input.category,
    active: input.is_active,
  }
}

export function toBundleTemplateModel(input: {
  id: string
  name: string
  description: string | null
  category: string | null
  unit: string
  base_price_ht: number
  base_cost_ht: number
  base_margin_pct: number | null
  is_active: boolean
}): BundleTemplateModel {
  return {
    id: input.id,
    label: input.name,
    description: input.description,
    category: input.category,
    unit: input.unit,
    sale_price_ht: input.base_price_ht,
    cost_ht: input.base_cost_ht,
    margin_pct: input.base_margin_pct,
    active: input.is_active,
  }
}
