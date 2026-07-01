import type { BusinessProfile } from '@/lib/catalog-context'

export type ChecklistItem = {
  id: string
  label: string
  category: string
  checked: boolean
}

// ─── Items par profil ────────────────────────────────────────────────────────

const ITEMS_INDUSTRY: Omit<ChecklistItem, 'checked'>[] = [
  // Plans & cotes
  { id: 'plans_recus',        category: 'Plans & cotes',    label: 'Plans / cotes reçus du client' },
  { id: 'cotes_terrain',      category: 'Plans & cotes',    label: 'Cotes terrain vérifiées' },
  { id: 'plans_valides',      category: 'Plans & cotes',    label: 'Plans validés (DWG / PDF)' },
  // Matière
  { id: 'nuance_confirmee',   category: 'Matière',          label: 'Nuance matière confirmée (acier / inox / alu)' },
  { id: 'tolerances',         category: 'Matière',          label: 'Tolérances validées (NF EN ISO 13920)' },
  { id: 'certif_matiere',     category: 'Matière',          label: 'Certificat matière requis (EN 10204 3.1)' },
  // Finition
  { id: 'finition_confirmee', category: 'Finition',         label: 'Finition confirmée (brut / grenaillé / galva / laqué)' },
  { id: 'couleur_ral',        category: 'Finition',         label: 'Teinte RAL / PANTONE validée' },
  { id: 'sous_traitance',     category: 'Finition',         label: 'Sous-traitant finition identifié' },
  // Transport & pose
  { id: 'transport_prevu',    category: 'Transport & pose', label: 'Transport / livraison prévu' },
  { id: 'pose_planifiee',     category: 'Transport & pose', label: 'Pose planifiée (date / équipe)' },
  { id: 'acces_chantier',     category: 'Transport & pose', label: 'Accès chantier confirmé (nacelle, grue, espace)' },
  // Soudure
  { id: 'proc_soudure',       category: 'Soudure',          label: 'Procédé de soudure défini (TIG / MIG / MAG)' },
  { id: 'qualif_soudeur',     category: 'Soudure',          label: 'Qualification soudeur vérifiée' },
]

const ITEMS_BTP: Omit<ChecklistItem, 'checked'>[] = [
  // Dossier
  { id: 'plans_recus',        category: 'Dossier',          label: 'Plans / descriptif reçus' },
  { id: 'visite_chantier',    category: 'Dossier',          label: 'Visite de chantier effectuée' },
  { id: 'cotes_valides',      category: 'Dossier',          label: 'Métrés / cotes validés' },
  // Technique
  { id: 'materiaux_confirmes',category: 'Technique',        label: 'Matériaux / fournitures confirmés' },
  { id: 'normes_verifiees',   category: 'Technique',        label: 'Normes applicables vérifiées (DTU, RE2020…)' },
  { id: 'sous_traitants',     category: 'Technique',        label: 'Sous-traitants / co-traitants identifiés' },
  // Accès & logistique
  { id: 'acces_chantier',     category: 'Accès & logistique', label: 'Accès chantier confirmé (horaires, benne, stationnement)' },
  { id: 'protection_chantier',category: 'Accès & logistique', label: 'Protections / bâchages prévus' },
  { id: 'evacuation_dechets', category: 'Accès & logistique', label: 'Évacuation des déchets planifiée' },
  // Planning
  { id: 'date_debut',         category: 'Planning',         label: 'Date de début confirmée avec le client' },
  { id: 'planning_corps',     category: 'Planning',         label: 'Planning des corps de métier établi' },
  { id: 'garanties',          category: 'Planning',         label: 'Garanties / assurances décennale vérifiées' },
]

const ITEMS_CLEANING: Omit<ChecklistItem, 'checked'>[] = [
  // Site
  { id: 'surface_mesuree',    category: 'Site',             label: 'Surface / zones mesurées et confirmées' },
  { id: 'acces_locaux',       category: 'Site',             label: 'Accès aux locaux confirmé (badge, clés, code)' },
  { id: 'nb_sanitaires',      category: 'Site',             label: 'Nombre de sanitaires / vestiaires relevé' },
  // Prestation
  { id: 'frequence_validee',  category: 'Prestation',       label: 'Fréquence de passage validée' },
  { id: 'horaires_confirmes', category: 'Prestation',       label: 'Horaires d\'intervention confirmés' },
  { id: 'produits_fournis',   category: 'Prestation',       label: 'Produits / matériel fournis par qui ?' },
  // Réglementation
  { id: 'fds_produits',       category: 'Réglementation',   label: 'Fiches de données de sécurité (FDS) disponibles' },
  { id: 'plan_prevention',    category: 'Réglementation',   label: 'Plan de prévention / protocole sécurité établi' },
  // Suivi
  { id: 'interlocuteur',      category: 'Suivi',            label: 'Interlocuteur client identifié' },
  { id: 'carnet_passages',    category: 'Suivi',            label: 'Carnet de passages / cahier de liaison prévu' },
]

const ITEMS_BY_PROFILE: Record<BusinessProfile, Omit<ChecklistItem, 'checked'>[]> = {
  industry: ITEMS_INDUSTRY,
  btp: ITEMS_BTP,
  cleaning: ITEMS_CLEANING,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDefaultItems(profile: BusinessProfile | null | undefined): Omit<ChecklistItem, 'checked'>[] {
  return ITEMS_BY_PROFILE[profile ?? 'industry'] ?? ITEMS_INDUSTRY
}

export function buildDefaultChecklist(profile?: BusinessProfile | null): ChecklistItem[] {
  return getDefaultItems(profile).map(item => ({ ...item, checked: false }))
}

export function mergeChecklist(
  saved: ChecklistItem[] | null | undefined,
  profile?: BusinessProfile | null,
): ChecklistItem[] {
  // Si des items custom ont été enregistrés (checklist non vide), on les préserve intégralement
  // et on ne réinjecte les defaults que pour les ids standards manquants
  const defaults = getDefaultItems(profile)
  const defaultIds = new Set(defaults.map(i => i.id))

  if (!saved || saved.length === 0) return buildDefaultChecklist(profile)

  // Items sauvegardés qui sont des ids standards connus pour ce profil → on prend le label du défaut
  // Items sauvegardés inconnus (custom ou autre profil) → on les garde tels quels
  const savedMap = new Map(saved.map(i => [i.id, i]))

  const merged: ChecklistItem[] = defaults.map(def => ({
    ...def,
    checked: savedMap.get(def.id)?.checked ?? false,
  }))

  // Réinjecter les items custom (id non présent dans les défauts)
  for (const item of saved) {
    if (!defaultIds.has(item.id)) {
      merged.push(item)
    }
  }

  return merged
}
