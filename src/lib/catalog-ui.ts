import type { ResolvedCatalogContext } from '@/lib/catalog-context'
import type { CatalogLaborRate, CatalogMaterial } from '@/lib/data/queries/catalog'
import type { VatConfig } from '@/lib/utils'
import { resolveDefaultVatRate } from '@/lib/utils'

type DimensionModeOption = {
  value: 'none' | 'linear' | 'area' | 'volume'
  label: string
  help: string
}

export type DimensionEditorLabels = {
  schemaHelp: string
  variantExampleHelp: string
  variantMaskedHelp: string
}

export function getDocumentDefaultVatRate(vatConfig: VatConfig): number {
  return resolveDefaultVatRate(vatConfig)
}

export function getCatalogDocumentVatRate(vatConfig: VatConfig): number {
  return getDocumentDefaultVatRate(vatConfig)
}

export function getInternalResourceUnitCost(laborRate: Pick<CatalogLaborRate, 'cost_rate' | 'rate'>): number {
  return laborRate.cost_rate ?? laborRate.rate ?? 0
}

export function getCatalogSaleUnitPrice(entry: CatalogMaterial | CatalogLaborRate): number {
  if ('sale_price' in entry) {
    return entry.sale_price ?? 0
  }
  return getInternalResourceUnitCost(entry)
}

export function getCatalogLabelsForProfile(catalogContext: ResolvedCatalogContext) {
  const forfaitExamples = catalogContext.businessProfile === 'cleaning'
    ? 'Ex : 1 passage, 1 intervention vitrerie.'
    : catalogContext.businessProfile === 'industry'
      ? 'Ex : 1 reglage machine, 1 operation atelier.'
      : 'Ex : 1 depannage, 1 pose complete.'

  const dimensionModes: DimensionModeOption[] = [
    {
      value: 'none',
      label: 'Fixe',
      help: 'Un prix unique, sans calcul de dimensions.',
    },
    {
      value: 'linear',
      label: 'Longueur',
      help: catalogContext.businessProfile === 'cleaning'
        ? 'Pour les lineaires simples.'
        : catalogContext.businessProfile === 'industry'
          ? 'Pour les profils, tubes et longueurs utiles.'
          : 'Pour les metres lineaires de chantier.',
    },
    {
      value: 'area',
      label: 'Surface',
      help: catalogContext.businessProfile === 'cleaning'
        ? 'Ideal pour les surfaces a traiter.'
        : catalogContext.businessProfile === 'industry'
          ? 'Pratique pour les pieces au m2.'
          : 'Ideal pour les surfaces a poser ou couvrir.',
    },
    {
      value: 'volume',
      label: 'Volume',
      help: catalogContext.businessProfile === 'industry'
        ? 'A reserver aux cas ou le volume compte vraiment.'
        : 'Pour les cas ou longueur x largeur x hauteur comptent.',
    },
  ]

  const dimensionEditorLabels: DimensionEditorLabels = catalogContext.businessProfile === 'cleaning'
    ? {
        schemaHelp: "Ces réglages sont facultatifs. Vous pouvez renommer les axes (ex : \"Surface\" → \"Surface à traiter\") ou changer l'unité.",
        variantExampleHelp: "Si ce produit existe en plusieurs conditionnements avec des prix différents (ex : bidon 5L = 18 €, bidon 20L = 58 €), ajoutez une variante par conditionnement. Le bon prix sera sélectionné automatiquement.",
        variantMaskedHelp: "Variantes masquées. La plupart des produits n'en ont pas besoin -- le prix de base s'applique.",
      }
    : catalogContext.businessProfile === 'industry'
      ? {
          schemaHelp: "Ces réglages sont facultatifs. Vous pouvez renommer les axes (ex : \"Longueur\" → \"Longueur utile\") ou changer l'unité.",
          variantExampleHelp: "Si cette matière existe en plusieurs épaisseurs ou formats avec des prix différents (ex : tôle 1mm = 8 €/m², tôle 2mm = 14 €/m²), ajoutez une variante par format. Le bon prix sera sélectionné automatiquement au chiffrage.",
          variantMaskedHelp: "Variantes masquées. La plupart des matières n'en ont pas besoin -- le prix de base s'applique.",
        }
      : {
          schemaHelp: "Ces réglages sont facultatifs. Vous pouvez renommer les axes (ex : \"Longueur\" → \"Longueur de chantier\") ou changer l'unité.",
          variantExampleHelp: "Si cette fourniture existe en plusieurs formats avec des prix différents (ex : lame 1m20 = 12 €, lame 2m10 = 19 €), ajoutez une variante par format. Le bon prix sera sélectionné automatiquement dans le devis.",
          variantMaskedHelp: "Variantes masquées. La plupart des fournitures n'en ont pas besoin -- le prix de base s'applique.",
        }

  const serviceItemPlaceholder = catalogContext.businessProfile === 'cleaning'
    ? 'ex: Nettoyage vitrerie'
    : catalogContext.businessProfile === 'industry'
      ? 'ex: Découpe laser'
      : 'ex: Pose menuiserie'

  const materialItemPlaceholder = catalogContext.businessProfile === 'cleaning'
    ? 'ex: Produit détergent'
    : catalogContext.businessProfile === 'industry'
      ? 'ex: Tôle S235'
      : 'ex: Parquet stratifié'

  return {
    forfaitHelp: `Forfait = prix global pour 1 intervention, 1 lot ou 1 passage. La quantite multiplie le nombre de forfaits. ${forfaitExamples}`,
    dimensionModes,
    dimensionEditorLabels,
    serviceItemPlaceholder,
    materialItemPlaceholder,
    resourceCostLabel: 'Cout entreprise / unite',
    templateColumns: {
      usage: 'Usage',
      composition: 'Composition',
      clientPrice: 'Prix client HT',
      internalCost: 'Cout interne',
      margin: 'Marge',
      active: 'Disponible',
    },
  }
}
