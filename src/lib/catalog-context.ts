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
  item_type: 'free' | 'service'
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
      },
      internalLineHelp: "Les lignes internes (ressources, déplacements) contribuent au coût de revient mais n'apparaissent pas dans le devis client.",
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
      },
      internalLineHelp: "Les lignes internes (main-d'oeuvre, déplacements) contribuent au coût de revient mais n'apparaissent pas dans le devis client.",
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
      },
      internalLineHelp: "Les lignes internes (postes de charge, logistique) contribuent au coût de revient mais n'apparaissent pas dans le devis client.",
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
  },
  desinfection: {
    labelSet: { catalogSubtitle: 'Produits, protocoles et ressources dédiés aux traitements de désinfection.' },
    defaultCategories: {
      service: ['Traitement', 'Désinfection', 'Décontamination'],
      laborRate: ['Équipe mobile', 'Pulvérisateur', 'Nébulisation'],
    },
  },
  electricite: {
    labelSet: { catalogSubtitle: 'Fournitures, prestations et ressources cohérentes avec vos interventions électriques.' },
    defaultCategories: {
      material: ['Tableau', 'Câblage', 'Appareillage', 'Dépannage'],
      service: ['Pose', 'Recherche de panne', 'Mise en conformité'],
    },
  },
  plomberie: {
    labelSet: { catalogSubtitle: 'Fournitures, prestations et ressources adaptées aux chantiers de plomberie.' },
    defaultCategories: {
      material: ['Réseaux', 'Sanitaire', 'Chauffe-eau', 'Dépannage'],
      service: ['Installation', 'Recherche de fuite', 'Maintenance'],
    },
  },
  tolerie: {
    labelSet: { catalogSubtitle: 'Matières, opérations vendues et postes internes dédiés à la tôlerie.' },
    defaultCategories: {
      material: ['Tôle brute', 'Bac acier', 'Pliage', 'Découpe'],
      service: ['Découpe', 'Pliage', 'Finition'],
      laborRate: ['Laser', 'Presse plieuse', 'Outillage amorti'],
    },
  },
  decoupe_laser: {
    labelSet: { catalogSubtitle: 'Matières, opérations et postes de charge orientés découpe laser.' },
    defaultCategories: {
      service: ['Découpe laser', 'Programmation', 'Ébavurage'],
      laborRate: ['Machine laser', 'Approvisionnement', 'Maintenance'],
    },
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
  const override = BUSINESS_ACTIVITY_OVERRIDES[activityId]
  if (!override) {
    return {
      ...base,
      activityId,
      laborRateUi: base.laborRateUi,
      bundleTemplateUi: base.bundleTemplateUi,
      resourceTypeOptions: buildResourceTypeOptions(base.laborRateUi),
    }
  }

  const laborRateUi = mergeLaborRateUi(base.laborRateUi, override.laborRateUi)
  return {
    ...base,
    activityId,
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
