// ─── Types ───────────────────────────────────────────────────────────────────

export type SectorId =
  | 'renovation'
  | 'maconnerie'
  | 'plomberie'
  | 'electricite'
  | 'menuiserie'
  | 'peinture'
  | 'carrelage'
  | 'facade'
  | 'charpente'
  | 'tolerie'

export type SectorMaterial = {
  name: string
  category: string
  unit: string
  purchase_price: number  // prix achat HT (indicatif)
  sale_price: number      // prix vente HT (0 = à définir)
  margin_rate: number     // % marge brute indicative
  vat_rate: number
}

export type SectorLaborRate = {
  designation: string
  category: string
  unit: string
  rate: number            // prix HT à l'unité
  vat_rate: number
}

export type SectorTemplate = {
  id: SectorId
  label: string
  description: string
  default_vat_rate: number
  vat_rates_available: number[]
  ai_prompt_context: string       // contexte injecté dans le prompt Kompagnon IA
  default_units: string[]
  legal_mentions: string[]        // mentions spécifiques au secteur (PDF pied de page)
  materials: SectorMaterial[]
  labor_rates: SectorLaborRate[]
}

// ─── Templates ───────────────────────────────────────────────────────────────

export const SECTOR_TEMPLATES: Record<SectorId, SectorTemplate> = {

  renovation: {
    id: 'renovation',
    label: 'Rénovation générale',
    description: 'Tous corps de métier, travaux de rénovation intérieure et extérieure',
    default_vat_rate: 10,
    vat_rates_available: [10, 20, 5.5],
    ai_prompt_context: 'Tu es expert en rénovation tous corps d\'état pour logements. La TVA applicable est 10% pour rénovation de logement existant (plus de 2 ans). Regroupe les postes par corps de métier (maçonnerie, plomberie, électricité, peinture, carrelage, menuiserie…). Sois précis dans les descriptions et extrais les surfaces/quantités quand elles sont mentionnées.',
    default_units: ['m2', 'ml', 'u', 'forfait', 'h', 'ens'],
    legal_mentions: [
      'TVA à 10% applicable sur les travaux de rénovation de logements achevés depuis plus de 2 ans (Art. 279-0 bis CGI)',
      'Garantie décennale souscrite auprès de {{assureur}}, police n° {{police}}',
    ],
    materials: [
      { name: 'Plaque de plâtre BA13', category: 'Cloisonnement', unit: 'm2', purchase_price: 5.50, sale_price: 12, margin_rate: 55, vat_rate: 10 },
      { name: 'Laine de verre 100mm', category: 'Isolation', unit: 'm2', purchase_price: 4.80, sale_price: 11, margin_rate: 56, vat_rate: 10 },
      { name: 'Mortier-colle carrelage', category: 'Carrelage', unit: 'sac 25kg', purchase_price: 8.00, sale_price: 16, margin_rate: 50, vat_rate: 10 },
      { name: 'Peinture acrylique blanche 10L', category: 'Peinture', unit: 'bidon', purchase_price: 22, sale_price: 45, margin_rate: 51, vat_rate: 10 },
      { name: 'Enduit de rebouchage 5kg', category: 'Peinture', unit: 'bidon', purchase_price: 9, sale_price: 20, margin_rate: 55, vat_rate: 10 },
    ],
    labor_rates: [
      { designation: 'Main-d\'œuvre rénovation', category: 'Générale', unit: 'h', rate: 45, vat_rate: 10 },
      { designation: 'Chef de chantier', category: 'Encadrement', unit: 'h', rate: 65, vat_rate: 10 },
      { designation: 'Sous-traitance spécialisée', category: 'Sous-traitance', unit: 'forfait', rate: 0, vat_rate: 10 },
    ],
  },

  maconnerie: {
    id: 'maconnerie',
    label: 'Maçonnerie / Gros œuvre',
    description: 'Fondations, élévation, béton armé, dallage, terrassement',
    default_vat_rate: 20,
    vat_rates_available: [20, 10],
    ai_prompt_context: 'Tu es expert en maçonnerie et gros œuvre. TVA 20% pour le neuf, 10% pour rénovation logement existant. Regroupe par phase (terrassement, fondations, élévation, dalle, enduits). Les unités courantes sont m3 (béton, terrassement), m2 (murs, dalles), ml (linéaires). Tiens compte des armatures et coffrages séparément.',
    default_units: ['m3', 'm2', 'ml', 't', 'u', 'forfait'],
    legal_mentions: [
      'Garantie décennale, assurance souscrite auprès de {{assureur}}, police n° {{police}}',
      'Garantie de parfait achèvement : 1 an à compter de la réception',
    ],
    materials: [
      { name: 'Béton prêt à l\'emploi C25/30', category: 'Béton', unit: 'm3', purchase_price: 95, sale_price: 145, margin_rate: 35, vat_rate: 20 },
      { name: 'Parpaing 20×20×50', category: 'Maçonnerie', unit: 'u', purchase_price: 1.20, sale_price: 2.50, margin_rate: 52, vat_rate: 20 },
      { name: 'Brique monomur 30cm', category: 'Maçonnerie', unit: 'u', purchase_price: 3.80, sale_price: 7.50, margin_rate: 49, vat_rate: 20 },
      { name: 'Mortier de maçonnerie (sac 35kg)', category: 'Liant', unit: 'sac', purchase_price: 7.50, sale_price: 16, margin_rate: 53, vat_rate: 20 },
      { name: 'Acier HA Ø12 (barre 12m)', category: 'Armature', unit: 'u', purchase_price: 18, sale_price: 35, margin_rate: 49, vat_rate: 20 },
      { name: 'Coffrages perdus', category: 'Coffrage', unit: 'm2', purchase_price: 12, sale_price: 28, margin_rate: 57, vat_rate: 20 },
    ],
    labor_rates: [
      { designation: 'Maçon qualifié', category: 'Main-d\'œuvre', unit: 'h', rate: 50, vat_rate: 20 },
      { designation: 'Coffreur', category: 'Main-d\'œuvre', unit: 'h', rate: 55, vat_rate: 20 },
      { designation: 'Terrassement mécanique', category: 'Engins', unit: 'h', rate: 90, vat_rate: 20 },
      { designation: 'Location bétonnière 350L', category: 'Location', unit: 'jour', rate: 65, vat_rate: 20 },
    ],
  },

  plomberie: {
    id: 'plomberie',
    label: 'Plomberie / Sanitaire',
    description: 'Plomberie, chauffage, sanitaires, PAC, VMC',
    default_vat_rate: 10,
    vat_rates_available: [10, 20, 5.5],
    ai_prompt_context: 'Tu es expert en plomberie, chauffage et sanitaires. TVA 10% pour logements existants, 20% pour le neuf ou équipements thermiques neufs (chaudière, PAC). Regroupe par lot (alimentation, évacuation, sanitaires, chauffage). Distingue la pose (M.O.) des fournitures. Précise les marques et références quand mentionnées.',
    default_units: ['u', 'ml', 'forfait', 'h', 'm2'],
    legal_mentions: [
      'Garantie biennale sur les équipements : 2 ans à compter de la réception',
      'Garantie décennale souscrite auprès de {{assureur}}, police n° {{police}}',
      'Qualification RGE si travaux éligibles CEE',
    ],
    materials: [
      { name: 'Tube PER Ø16 rouge (rouleau 25m)', category: 'Alimentation', unit: 'rouleau', purchase_price: 18, sale_price: 38, margin_rate: 53, vat_rate: 10 },
      { name: 'Tube cuivre Ø22 (barre 4m)', category: 'Alimentation', unit: 'barre', purchase_price: 24, sale_price: 52, margin_rate: 54, vat_rate: 10 },
      { name: 'Collecteur 7 départs', category: 'Distribution', unit: 'u', purchase_price: 45, sale_price: 95, margin_rate: 53, vat_rate: 10 },
      { name: 'WC suspendu complet (bâti + cuvette)', category: 'Sanitaire', unit: 'u', purchase_price: 220, sale_price: 420, margin_rate: 48, vat_rate: 10 },
      { name: 'Lavabo céramique + robinetterie', category: 'Sanitaire', unit: 'u', purchase_price: 95, sale_price: 195, margin_rate: 51, vat_rate: 10 },
      { name: 'Chauffe-eau thermodynamique 200L', category: 'Chauffage eau', unit: 'u', purchase_price: 850, sale_price: 1500, margin_rate: 43, vat_rate: 20 },
    ],
    labor_rates: [
      { designation: 'Plombier qualifié', category: 'Main-d\'œuvre', unit: 'h', rate: 55, vat_rate: 10 },
      { designation: 'Technicien chauffage', category: 'Main-d\'œuvre', unit: 'h', rate: 65, vat_rate: 10 },
      { designation: 'Mise en service PAC / chaudière', category: 'Mise en service', unit: 'forfait', rate: 250, vat_rate: 20 },
    ],
  },

  electricite: {
    id: 'electricite',
    label: 'Électricité',
    description: 'Électricité générale, domotique, bornes IRVE, photovoltaïque',
    default_vat_rate: 10,
    vat_rates_available: [10, 20, 5.5],
    ai_prompt_context: 'Tu es expert en électricité bâtiment. TVA 10% pour logements existants, 20% pour neuf, photovoltaïque et bornes IRVE. Regroupe par lot (tableau, circuits, prises/éclairage, domotique). Distingue matériel et main-d\'œuvre. Précise la marque et la référence du tableau électrique. Pour les installations photovoltaïques, précise la puissance kWc.',
    default_units: ['u', 'ml', 'forfait', 'h', 'kWc'],
    legal_mentions: [
      'Qualification Qualifelec ou IRVE P1/P2/P3 selon travaux',
      'Attestation de conformité CONSUEL remise après travaux',
      'Garantie décennale souscrite auprès de {{assureur}}, police n° {{police}}',
    ],
    materials: [
      { name: 'Tableau électrique 13 modules', category: 'Tableau', unit: 'u', purchase_price: 65, sale_price: 145, margin_rate: 55, vat_rate: 10 },
      { name: 'Disjoncteur bipolaire 20A', category: 'Tableau', unit: 'u', purchase_price: 12, sale_price: 28, margin_rate: 57, vat_rate: 10 },
      { name: 'Câble électrique 2.5mm² (rouleau 100m)', category: 'Câblage', unit: 'rouleau', purchase_price: 55, sale_price: 115, margin_rate: 52, vat_rate: 10 },
      { name: 'Prise 2P+T avec plaque', category: 'Appareillage', unit: 'u', purchase_price: 8, sale_price: 20, margin_rate: 60, vat_rate: 10 },
      { name: 'Interrupteur va-et-vient', category: 'Appareillage', unit: 'u', purchase_price: 7.50, sale_price: 18, margin_rate: 58, vat_rate: 10 },
      { name: 'Borne IRVE 7kW Type 2', category: 'IRVE', unit: 'u', purchase_price: 450, sale_price: 850, margin_rate: 47, vat_rate: 20 },
    ],
    labor_rates: [
      { designation: 'Électricien qualifié', category: 'Main-d\'œuvre', unit: 'h', rate: 55, vat_rate: 10 },
      { designation: 'Technicien domotique', category: 'Main-d\'œuvre', unit: 'h', rate: 70, vat_rate: 10 },
      { designation: 'Mise en service IRVE', category: 'Mise en service', unit: 'forfait', rate: 150, vat_rate: 20 },
    ],
  },

  menuiserie: {
    id: 'menuiserie',
    label: 'Menuiserie / Charpente',
    description: 'Menuiseries extérieures, portes, fenêtres, charpente bois',
    default_vat_rate: 10,
    vat_rates_available: [10, 20],
    ai_prompt_context: 'Tu es expert en menuiserie et charpente. TVA 10% pour rénovation de logements existants, 20% pour neuf. Distingue menuiseries extérieures (fenêtres, portes, volets) et intérieures (portes, placards, escaliers). Précise les matériaux (PVC, aluminium, bois), les dimensions approximatives et les couleurs si mentionnées. Pour la charpente, distingue fermettes, poutres et chevrons.',
    default_units: ['u', 'm2', 'ml', 'forfait', 'h'],
    legal_mentions: [
      'Garantie décennale souscrite auprès de {{assureur}}, police n° {{police}}',
      'Certification CTB ou PEFC sur les bois d\'origine française si applicable',
    ],
    materials: [
      { name: 'Fenêtre PVC double vitrage 120×120', category: 'Menuiserie ext.', unit: 'u', purchase_price: 280, sale_price: 580, margin_rate: 52, vat_rate: 10 },
      { name: 'Baie coulissante alu 240×215', category: 'Menuiserie ext.', unit: 'u', purchase_price: 850, sale_price: 1700, margin_rate: 50, vat_rate: 10 },
      { name: 'Porte d\'entrée alu isolée', category: 'Menuiserie ext.', unit: 'u', purchase_price: 1100, sale_price: 2200, margin_rate: 50, vat_rate: 10 },
      { name: 'Volet roulant électrique 120×100', category: 'Volets', unit: 'u', purchase_price: 320, sale_price: 650, margin_rate: 51, vat_rate: 10 },
      { name: 'Porte intérieure isophonique 83×204', category: 'Menuiserie int.', unit: 'u', purchase_price: 95, sale_price: 220, margin_rate: 57, vat_rate: 10 },
      { name: 'Fermette charpente industrielle', category: 'Charpente', unit: 'u', purchase_price: 180, sale_price: 360, margin_rate: 50, vat_rate: 20 },
    ],
    labor_rates: [
      { designation: 'Menuisier poseur', category: 'Main-d\'œuvre', unit: 'h', rate: 55, vat_rate: 10 },
      { designation: 'Charpentier', category: 'Main-d\'œuvre', unit: 'h', rate: 60, vat_rate: 10 },
      { designation: 'Dépose ancienne menuiserie', category: 'Dépose', unit: 'u', rate: 80, vat_rate: 10 },
    ],
  },

  peinture: {
    id: 'peinture',
    label: 'Peinture / Revêtements',
    description: 'Peinture intérieure/extérieure, papier peint, revêtements muraux',
    default_vat_rate: 10,
    vat_rates_available: [10, 20],
    ai_prompt_context: 'Tu es expert en peinture et revêtements muraux. TVA 10% pour logements existants, 20% pour neuf. Regroupe par zone (chambre, séjour, cuisine, façade…) ou par type (murs, plafonds, boiseries). Les surfaces sont en m2. Précise le nombre de couches et la préparation des supports (rebouchage, impression). Pour la façade, précise le type d\'enduit.',
    default_units: ['m2', 'ml', 'u', 'forfait'],
    legal_mentions: [
      'Préparation des supports incluse sauf mention contraire',
      'Teintes au choix du client dans la gamme standard, teintes spéciales en supplément',
    ],
    materials: [
      { name: 'Peinture acrylique mate 2 couches', category: 'Peinture mur', unit: 'm2', purchase_price: 4.50, sale_price: 12, margin_rate: 63, vat_rate: 10 },
      { name: 'Peinture plafond blanche 2 couches', category: 'Peinture plafond', unit: 'm2', purchase_price: 4.00, sale_price: 10, margin_rate: 60, vat_rate: 10 },
      { name: 'Enduit lissage murs', category: 'Préparation', unit: 'm2', purchase_price: 3.50, sale_price: 9, margin_rate: 61, vat_rate: 10 },
      { name: 'Peinture façade siloxane 2 couches', category: 'Façade', unit: 'm2', purchase_price: 8, sale_price: 22, margin_rate: 64, vat_rate: 10 },
      { name: 'Papier peint intissé (rouleau 10m)', category: 'Revêtement mural', unit: 'rouleau', purchase_price: 28, sale_price: 65, margin_rate: 57, vat_rate: 10 },
    ],
    labor_rates: [
      { designation: 'Peintre qualifié', category: 'Main-d\'œuvre', unit: 'h', rate: 42, vat_rate: 10 },
      { designation: 'Protection et bâchage', category: 'Préparation', unit: 'forfait', rate: 120, vat_rate: 10 },
    ],
  },

  carrelage: {
    id: 'carrelage',
    label: 'Carrelage / Sols',
    description: 'Carrelage, parquet, revêtements de sols, faïence',
    default_vat_rate: 10,
    vat_rates_available: [10, 20],
    ai_prompt_context: 'Tu es expert en carrelage et revêtements de sols. TVA 10% pour logements existants, 20% pour neuf. Sépare les lots (sol, mur/faïence). Extrais les surfaces en m2. Précise le format (ex: 60×60), la qualité et la pose (droit, décalé, à 45°). N\'oublie pas les joints, la préparation du support (ragréage, chape), les plinthes et les seuils.',
    default_units: ['m2', 'ml', 'u', 'forfait'],
    legal_mentions: [
      'Carrelage fourni avec 10% de chute inclus dans le métré',
      'Teintes et références validées par le client avant commande',
    ],
    materials: [
      { name: 'Carrelage grès cérame 60×60 (sol)', category: 'Carrelage sol', unit: 'm2', purchase_price: 18, sale_price: 38, margin_rate: 53, vat_rate: 10 },
      { name: 'Faïence salle de bain 30×60', category: 'Faïence', unit: 'm2', purchase_price: 16, sale_price: 35, margin_rate: 54, vat_rate: 10 },
      { name: 'Mortier-colle C2 (sac 25kg)', category: 'Pose', unit: 'sac', purchase_price: 12, sale_price: 24, margin_rate: 50, vat_rate: 10 },
      { name: 'Joint carrelage (sac 5kg)', category: 'Finition', unit: 'sac', purchase_price: 8, sale_price: 18, margin_rate: 55, vat_rate: 10 },
      { name: 'Ragréage autolissant (sac 25kg)', category: 'Préparation sol', unit: 'sac', purchase_price: 14, sale_price: 30, margin_rate: 53, vat_rate: 10 },
      { name: 'Parquet stratifié 8mm (boîte 2m2)', category: 'Parquet', unit: 'boîte', purchase_price: 22, sale_price: 48, margin_rate: 54, vat_rate: 10 },
    ],
    labor_rates: [
      { designation: 'Carreleur qualifié', category: 'Main-d\'œuvre', unit: 'h', rate: 48, vat_rate: 10 },
      { designation: 'Pose parquet flottant', category: 'Pose', unit: 'm2', rate: 18, vat_rate: 10 },
      { designation: 'Dépose ancien carrelage', category: 'Dépose', unit: 'm2', rate: 12, vat_rate: 10 },
    ],
  },

  facade: {
    id: 'facade',
    label: 'Façade / Isolation extérieure',
    description: 'ITE, ravalement, enduits de façade, isolation thermique par l\'extérieur',
    default_vat_rate: 10,
    vat_rates_available: [10, 20, 5.5],
    ai_prompt_context: 'Tu es expert en façade et isolation thermique par l\'extérieur (ITE). TVA 5.5% pour travaux d\'isolation éligibles CEE, 10% pour rénovation de logements existants, 20% pour neuf. Regroupe par poste : nettoyage/traitement, isolation, enduit de finition. Les surfaces sont en m2. Précise l\'épaisseur de l\'isolant (ex: 100mm PSE), la nature de l\'enduit (minéral, organique), et si des échafaudages sont nécessaires.',
    default_units: ['m2', 'ml', 'u', 'forfait'],
    legal_mentions: [
      'Qualification RGE Qualibat 7131 ou équivalent pour travaux éligibles CEE/MaPrimeRénov\'',
      'Garantie décennale souscrite auprès de {{assureur}}, police n° {{police}}',
    ],
    materials: [
      { name: 'Panneau PSE façade 100mm', category: 'ITE', unit: 'm2', purchase_price: 14, sale_price: 30, margin_rate: 53, vat_rate: 5.5 },
      { name: 'Enduit de finition grain fin', category: 'Enduit', unit: 'm2', purchase_price: 6, sale_price: 16, margin_rate: 63, vat_rate: 10 },
      { name: 'Primaire d\'accrochage', category: 'Préparation', unit: 'm2', purchase_price: 3, sale_price: 8, margin_rate: 63, vat_rate: 10 },
      { name: 'Profilé départ de façade', category: 'Accessoires ITE', unit: 'ml', purchase_price: 4.50, sale_price: 10, margin_rate: 55, vat_rate: 10 },
      { name: 'Échafaudage (location semaine)', category: 'Location', unit: 'm2/sem', purchase_price: 3, sale_price: 7, margin_rate: 57, vat_rate: 20 },
    ],
    labor_rates: [
      { designation: 'Façadier / Enduiseur', category: 'Main-d\'œuvre', unit: 'h', rate: 52, vat_rate: 10 },
      { designation: 'Nettoyage Haute Pression', category: 'Nettoyage', unit: 'm2', rate: 4, vat_rate: 10 },
      { designation: 'Traitement hydrofuge', category: 'Traitement', unit: 'm2', rate: 8, vat_rate: 10 },
    ],
  },

  charpente: {
    id: 'charpente',
    label: 'Charpente / Couverture / Zinguerie',
    description: 'Charpente traditionnelle et industrielle, toiture, zinguerie',
    default_vat_rate: 10,
    vat_rates_available: [10, 20],
    ai_prompt_context: 'Tu es expert en charpente, couverture et zinguerie. TVA 10% pour rénovation de logements existants, 20% pour neuf. Regroupe par lot : charpente, couverture, isolation en rampants, zinguerie. Les surfaces de toiture sont en m2. Précise la pente du toit, le type de couverture (tuiles, ardoises, bac acier), et si un désamiantage est nécessaire pour les anciennes toitures.',
    default_units: ['m2', 'ml', 'u', 'forfait', 'm3'],
    legal_mentions: [
      'Garantie décennale souscrite auprès de {{assureur}}, police n° {{police}}',
      'Traitement des bois de charpente inclus, garantie traitement 10 ans',
    ],
    materials: [
      { name: 'Tuiles canal terre cuite', category: 'Couverture', unit: 'u', purchase_price: 1.20, sale_price: 2.80, margin_rate: 57, vat_rate: 10 },
      { name: 'Ardoise naturelle 32×22', category: 'Couverture', unit: 'u', purchase_price: 1.80, sale_price: 4.20, margin_rate: 57, vat_rate: 10 },
      { name: 'Membrane sous-toiture HPV', category: 'Sous-toiture', unit: 'm2', purchase_price: 3.50, sale_price: 8, margin_rate: 56, vat_rate: 10 },
      { name: 'Liteaux 38×25 (botte)', category: 'Liteau', unit: 'ml', purchase_price: 0.80, sale_price: 2, margin_rate: 60, vat_rate: 10 },
      { name: 'Solive sapin 63×175 4m', category: 'Charpente', unit: 'u', purchase_price: 28, sale_price: 65, margin_rate: 57, vat_rate: 10 },
      { name: 'Gouttière zinc Ø100 (3m)', category: 'Zinguerie', unit: 'ml', purchase_price: 18, sale_price: 42, margin_rate: 57, vat_rate: 10 },
    ],
    labor_rates: [
      { designation: 'Charpentier couvreur', category: 'Main-d\'œuvre', unit: 'h', rate: 58, vat_rate: 10 },
      { designation: 'Zingueur', category: 'Main-d\'œuvre', unit: 'h', rate: 60, vat_rate: 10 },
      { designation: 'Traitement charpente curatif', category: 'Traitement', unit: 'm2', rate: 15, vat_rate: 10 },
    ],
  },

  tolerie: {
    id: 'tolerie',
    label: 'Tôlerie industrielle',
    description: 'Tôlerie, chaudronnerie, découpe laser, pliage, soudure',
    default_vat_rate: 20,
    vat_rates_available: [20],
    ai_prompt_context: 'Tu es expert en tôlerie industrielle et chaudronnerie. TVA 20% sur toutes les prestations. Les unités sont kg, m2, pièces ou forfaits selon la nature du travail. Regroupe par type de pièce ou par opération (découpe, pliage, soudure, finition). Précise les matériaux (acier galva, inox 304/316, aluminium, laiton), l\'épaisseur en mm, et les finitions (brut, grenaillé, peint, anodisé). Les prix dépendent fortement du cours de l\'acier.',
    default_units: ['kg', 'm2', 'u', 'ml', 'h', 'forfait'],
    legal_mentions: [
      'Prix matières premières basés sur les cours en vigueur à la date de devis, révisables en cas de variation > 5%',
      'Délai de fabrication indicatif, confirmé à réception de commande',
    ],
    materials: [
      { name: 'Tôle acier galvanisé 1.5mm', category: 'Acier', unit: 'm2', purchase_price: 14, sale_price: 32, margin_rate: 56, vat_rate: 20 },
      { name: 'Tôle inox 304 2mm', category: 'Inox', unit: 'm2', purchase_price: 55, sale_price: 120, margin_rate: 54, vat_rate: 20 },
      { name: 'Tôle aluminium 3mm', category: 'Aluminium', unit: 'm2', purchase_price: 32, sale_price: 72, margin_rate: 55, vat_rate: 20 },
      { name: 'Tube acier carré 40×40×3', category: 'Profilé', unit: 'ml', purchase_price: 6.50, sale_price: 15, margin_rate: 57, vat_rate: 20 },
      { name: 'Consommables soudure (fil + gaz)', category: 'Consommables', unit: 'forfait', purchase_price: 0, sale_price: 0, margin_rate: 50, vat_rate: 20 },
    ],
    labor_rates: [
      { designation: 'Opérateur découpe laser/plasma', category: 'Découpe', unit: 'h', rate: 85, vat_rate: 20 },
      { designation: 'Chaudronnier / Plieur', category: 'Formage', unit: 'h', rate: 65, vat_rate: 20 },
      { designation: 'Soudeur TIG / MIG', category: 'Soudure', unit: 'h', rate: 70, vat_rate: 20 },
      { designation: 'Peinture poudre / thermolaquage', category: 'Finition', unit: 'm2', rate: 28, vat_rate: 20 },
    ],
  },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getSectorTemplate(id: string): SectorTemplate | null {
  return SECTOR_TEMPLATES[id as SectorId] ?? null
}

export const ALL_SECTORS = Object.values(SECTOR_TEMPLATES)
