/**
 * Catalogue d'équipements loués couramment, par secteur ICP du module Chantiers.
 * Évolutif : ajoutez/retirez librement.
 *
 * Le secteur est lu depuis `organizations.sector` (choisi à l'onboarding,
 * modifiable dans Settings). Le formulaire de dépense propose un dropdown
 * filtré + l'option "Autre" pour saisie libre.
 */

export type RentalUnit = 'j' | 'sem' | 'mois'

export type RentalItem = {
  slug: string
  label: string
  defaultUnit: RentalUnit
}

export const RENTAL_CATALOG_BY_SECTOR: Record<string, RentalItem[]> = {
  btp: [
    { slug: 'echafaudage',     label: 'Échafaudage',                defaultUnit: 'sem'  },
    { slug: 'nacelle',         label: 'Nacelle élévatrice',         defaultUnit: 'j'    },
    { slug: 'mini_pelle',      label: 'Mini-pelle',                 defaultUnit: 'j'    },
    { slug: 'betonniere',      label: 'Bétonnière',                 defaultUnit: 'sem'  },
    { slug: 'container',       label: 'Container chantier',         defaultUnit: 'mois' },
    { slug: 'benne',           label: 'Benne à gravats',            defaultUnit: 'sem'  },
    { slug: 'compresseur',     label: 'Compresseur',                defaultUnit: 'j'    },
    { slug: 'outillage_elec',  label: 'Outillage électroportatif',  defaultUnit: 'j'    },
  ],
  nettoyage: [
    { slug: 'auto_laveuse',    label: 'Auto-laveuse',               defaultUnit: 'j'    },
    { slug: 'monobrosse',      label: 'Monobrosse',                 defaultUnit: 'j'    },
    { slug: 'nettoyeur_hp',    label: 'Nettoyeur haute pression',   defaultUnit: 'j'    },
    { slug: 'aspi_industriel', label: 'Aspirateur industriel',      defaultUnit: 'j'    },
    { slug: 'utilitaire',      label: 'Véhicule utilitaire',        defaultUnit: 'j'    },
    { slug: 'nacelle_vitres',  label: 'Nacelle (vitres en hauteur)',defaultUnit: 'j'    },
  ],
  paysagiste: [
    { slug: 'tondeuse_auto',   label: 'Tondeuse autoportée',        defaultUnit: 'j'    },
    { slug: 'broyeur',         label: 'Broyeur de végétaux',        defaultUnit: 'j'    },
    { slug: 'nacelle_elag',    label: 'Nacelle élagage',            defaultUnit: 'j'    },
    { slug: 'remorque',        label: 'Remorque',                   defaultUnit: 'j'    },
    { slug: 'mini_pelle',      label: 'Mini-pelle',                 defaultUnit: 'j'    },
    { slug: 'rotavator',       label: 'Motoculteur / rotavator',    defaultUnit: 'j'    },
  ],
  industrie: [
    { slug: 'pont_roulant',    label: 'Pont roulant mobile',        defaultUnit: 'sem'  },
    { slug: 'chariot_elev',    label: 'Chariot élévateur',          defaultUnit: 'sem'  },
    { slug: 'palan',           label: 'Palan / treuil',             defaultUnit: 'sem'  },
    { slug: 'gen_soudure',     label: 'Groupe de soudure mobile',   defaultUnit: 'j'    },
    { slug: 'plieuse',         label: 'Plieuse / cisaille mobile',  defaultUnit: 'sem'  },
    { slug: 'compresseur',     label: 'Compresseur industriel',     defaultUnit: 'sem'  },
  ],
}

/** Retourne la liste pour le secteur de l'org, ou [] si secteur inconnu/non couvert. */
export function getRentalCatalog(sector?: string | null): RentalItem[] {
  if (!sector) return []
  return RENTAL_CATALOG_BY_SECTOR[sector] ?? []
}

/** Retrouve un item depuis son slug (peu importe le secteur — utile pour ré-afficher une dépense saisie). */
export function findRentalItem(slug: string | null | undefined): RentalItem | null {
  if (!slug) return null
  for (const items of Object.values(RENTAL_CATALOG_BY_SECTOR)) {
    const found = items.find(i => i.slug === slug)
    if (found) return found
  }
  return null
}

export const RENTAL_UNIT_LABELS: Record<RentalUnit, string> = {
  j:    'jour(s)',
  sem:  'semaine(s)',
  mois: 'mois',
}

/** Calcule le nombre de "périodes" de l'unité donnée entre 2 dates (arrondi sup, min 1). */
export function computeRentalDuration(
  startDate: string,
  endDate: string,
  unit: RentalUnit,
): number {
  const s = new Date(startDate + 'T00:00:00')
  const e = new Date(endDate + 'T00:00:00')
  const days = Math.max(1, Math.ceil((e.getTime() - s.getTime()) / 86_400_000) + 1)
  if (unit === 'j')   return days
  if (unit === 'sem') return Math.max(1, Math.ceil(days / 7))
  return Math.max(1, Math.ceil(days / 30))
}
