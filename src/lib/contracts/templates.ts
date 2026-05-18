import type { BusinessActivityId } from '@/lib/catalog-context'

export type ContractType = 'sous_traitance' | 'maintenance'
export type ContractRole = 'donneur_ordre' | 'sous_traitant'
export type ContractStatus = 'draft' | 'sent' | 'signed' | 'archived'

export type ContractClauseKey =
  | 'objet'
  | 'duree'
  | 'prix'
  | 'obligations'
  | 'assurances'
  | 'securite'
  | 'confidentialite'
  | 'resiliation'
  | 'annexes'

export type ContractClauses = Record<ContractClauseKey, string>

export type ContractCustomSection = {
  id: string
  title: string
  content: string
}

export type ContractTemplate = {
  key: string
  title: string
  type: ContractType
  trade: 'generique' | 'electricite' | 'plomberie' | 'second_oeuvre' | 'nettoyage' | 'personnalise'
  clauses: ContractClauses
  customSections?: ContractCustomSection[]
  isCustom?: boolean
}

export function normalizeCustomSections(input: unknown): ContractCustomSection[] {
  if (!Array.isArray(input)) return []
  return input
    .map((section, index) => {
      const raw = typeof section === 'object' && section !== null ? section as Record<string, unknown> : {}
      const title = typeof raw.title === 'string' ? raw.title.trim() : ''
      const content = typeof raw.content === 'string' ? raw.content.trim() : ''
      if (!title && !content) return null
      return {
        id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `section-${index + 1}`,
        title: title || `Section ${index + 1}`,
        content,
      }
    })
    .filter(Boolean) as ContractCustomSection[]
}

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: 'Brouillon',
  sent: 'Envoyé',
  signed: 'Signé',
  archived: 'Archivé',
}

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  sous_traitance: 'Sous-traitance',
  maintenance: 'Maintenance',
}

export const CONTRACT_ROLE_LABELS: Record<ContractRole, string> = {
  donneur_ordre: "Donneur d'ordre",
  sous_traitant: 'Sous-traitant',
}

export const CONTRACT_ROLE_LABELS_MAINTENANCE: Record<ContractRole, string> = {
  donneur_ordre: 'Client',
  sous_traitant: 'Prestataire',
}

export function getRoleLabel(role: ContractRole, contractType: ContractType): string {
  return contractType === 'maintenance'
    ? CONTRACT_ROLE_LABELS_MAINTENANCE[role]
    : CONTRACT_ROLE_LABELS[role]
}

export const CLAUSE_LABELS: Record<ContractClauseKey, string> = {
  objet: 'Objet du contrat',
  duree: 'Durée',
  prix: 'Prix et modalités de paiement',
  obligations: 'Obligations des parties',
  assurances: 'Assurances',
  securite: 'Sécurité et conformité',
  confidentialite: 'Confidentialité',
  resiliation: 'Résiliation',
  annexes: 'Annexes',
}

export const CONTRACT_DISCLAIMER =
  "Ce modèle est une aide opérationnelle. Il ne constitue pas un conseil juridique et doit être relu par un professionnel compétent avant signature."

// Placeholders remplacés à la génération PDF : {{DONNEUR_ORDRE}}, {{SOUS_TRAITANT}}, {{CHANTIER}}

const baseSousTraitance: ContractClauses = {
  objet: `Le présent contrat est conclu en application des dispositions de la loi n° 75-1334 du 31 décembre 1975 relative à la sous-traitance, et a pour objet de définir les conditions dans lesquelles {{SOUS_TRAITANT}} (ci-après "le Sous-traitant") réalise, pour le compte de {{DONNEUR_ORDRE}} (ci-après "le Donneur d'ordre"), les prestations décrites dans les documents contractuels visés à l'article "Annexes" du présent contrat.

Les prestations portent sur le chantier ou l'opération désignée sous le nom "{{CHANTIER}}", dont les caractéristiques techniques sont précisées dans le cahier des charges et les plans annexés.

Le Sous-traitant déclare avoir pris connaissance de l'ensemble des documents techniques et administratifs relatifs au chantier et des contraintes propres au site d'intervention. Il s'engage à exécuter les travaux conformément aux règles de l'art, aux normes en vigueur et aux prescriptions du Donneur d'ordre.

Les parties reconnaissent que la relation instaurée par le présent contrat est bien une sous-traitance au sens de la loi précitée, et que {{DONNEUR_ORDRE}} agit en qualité de maître d'ouvrage délégué ou d'entrepreneur principal vis-à-vis du maître d'ouvrage final.`,

  duree: `Le présent contrat prend effet à compter de sa signature par les deux parties et reste en vigueur jusqu'à la réception sans réserve des prestations par {{DONNEUR_ORDRE}}, constatée par procès-verbal contradictoire.

Les délais d'exécution sont définis dans le planning prévisionnel annexé au présent contrat. {{SOUS_TRAITANT}} s'engage à respecter ce planning et à informer {{DONNEUR_ORDRE}} sans délai de tout événement susceptible d'en compromettre le respect.

En cas de retard imputable à {{SOUS_TRAITANT}}, des pénalités pourront être appliquées selon les modalités prévues aux documents particuliers du marché, sauf si le retard est dû à un cas de force majeure dûment constaté, à une faute de {{DONNEUR_ORDRE}} ou à une cause extérieure aux deux parties.

La réception des travaux ne libère pas {{SOUS_TRAITANT}} de ses obligations légales de garantie : garantie de parfait achèvement (1 an), garantie de bon fonctionnement (2 ans) et garantie décennale (10 ans) pour les ouvrages relevant de l'article 1792 du Code civil.`,

  prix: `En contrepartie des prestations réalisées, {{DONNEUR_ORDRE}} s'engage à régler à {{SOUS_TRAITANT}} le montant convenu entre les parties, tel que défini dans les documents contractuels annexés (devis, bordereau de prix, détail estimatif).

Les prix sont fermes et non révisables sauf accord écrit préalable des deux parties. Toute prestation complémentaire, modification de programme ou travaux supplémentaires ne pourra être réalisée qu'après établissement et acceptation d'un avenant écrit.

La facturation est établie par {{SOUS_TRAITANT}} selon les modalités suivantes : acomptes à l'avancement selon le rythme convenu, solde à la réception des travaux sans réserve. Conformément à la loi n° 2013-100 du 28 janvier 2013 et à l'article L. 441-10 du Code de commerce, le délai maximal de paiement est de 45 jours à compter de la date d'émission de la facture, ou 60 jours à compter de la date d'émission de la facture si ce délai est expressément stipulé par accord entre les parties et ne constitue pas une clause abusive.

Tout retard de paiement entraîne de plein droit, sans mise en demeure préalable, l'application de pénalités calculées au taux de trois fois le taux d'intérêt légal en vigueur, ainsi que d'une indemnité forfaitaire pour frais de recouvrement de 40 euros par facture impayée, conformément à l'article D. 441-5 du Code de commerce.

Le prix s'entend hors taxes. La TVA applicable est celle en vigueur au jour de la facturation et sera portée séparément sur la facture.`,

  obligations: `Obligations de {{SOUS_TRAITANT}} :
{{SOUS_TRAITANT}} s'engage à exécuter les prestations objet du présent contrat avec toute la diligence et le soin requis, dans le respect des délais convenus, des normes techniques et réglementaires applicables, et des instructions de {{DONNEUR_ORDRE}}.
{{SOUS_TRAITANT}} s'engage à mettre à disposition un personnel qualifié et en nombre suffisant, à utiliser des matériaux et fournitures conformes aux spécifications contractuelles, et à coordonner ses interventions avec les autres corps d'état présents sur le chantier.
{{SOUS_TRAITANT}} s'engage à informer {{DONNEUR_ORDRE}} de toute difficulté technique ou administrative susceptible d'affecter la bonne exécution des travaux dans les plus brefs délais.
{{SOUS_TRAITANT}} s'engage à respecter les procédures qualité et de contrôle définies par {{DONNEUR_ORDRE}}, à tenir à sa disposition tout document justificatif (certificats, fiches techniques, procès-verbaux d'essais) et à accepter les vérifications et contrôles que {{DONNEUR_ORDRE}} jugera utiles d'effectuer.

Obligations de {{DONNEUR_ORDRE}} :
{{DONNEUR_ORDRE}} s'engage à mettre à disposition de {{SOUS_TRAITANT}} les installations de chantier nécessaires à l'exécution des travaux, à lui fournir les plans, documents techniques et informations utiles dans les délais convenus, et à lui permettre l'accès au chantier aux horaires définis.
{{DONNEUR_ORDRE}} s'engage à soumettre le présent contrat de sous-traitance à l'acceptation du maître d'ouvrage et à l'agrément de ses conditions de paiement, conformément aux articles 3 et 4 de la loi du 31 décembre 1975.
{{DONNEUR_ORDRE}} s'engage à instruire les demandes de règlement de {{SOUS_TRAITANT}} dans les délais légaux et contractuels.`,

  assurances: `Chaque partie déclare être couverte par les assurances professionnelles adaptées à son activité pendant toute la durée du présent contrat.

{{SOUS_TRAITANT}} déclare notamment disposer :
- d'une assurance responsabilité civile professionnelle et responsabilité civile chantier couvrant les dommages causés aux tiers dans le cadre de l'exécution des prestations ;
- d'une assurance décennale au sens de l'article L. 241-1 du Code des assurances, pour les travaux relevant de la garantie décennale prévue aux articles 1792 et suivants du Code civil ;
- le cas échéant, de toute assurance spécifique exigée par la nature des travaux (dommages aux existants, risques annexes, etc.).

{{SOUS_TRAITANT}} s'engage à fournir à {{DONNEUR_ORDRE}}, avant tout commencement d'exécution, les attestations d'assurances à jour, mentionnant les garanties souscrites, les montants de couverture et la période de validité.

En cas de résiliation ou de non-renouvellement d'une police d'assurance en cours de contrat, {{SOUS_TRAITANT}} en informe immédiatement {{DONNEUR_ORDRE}} et prend toute mesure pour rétablir la couverture dans les meilleurs délais.`,

  securite: `L'exécution des prestations est réalisée dans le strict respect des dispositions légales et réglementaires relatives à la sécurité et à la protection de la santé des travailleurs sur les chantiers, notamment le Code du travail (articles L. 4121-1 et suivants), et le décret n° 94-1159 du 26 décembre 1994 relatif à la coordination de sécurité et de protection de la santé.

{{SOUS_TRAITANT}} est tenu de respecter les consignes de sécurité propres au chantier "{{CHANTIER}}", le Plan de Prévention ou le Plan Particulier de Sécurité et de Protection de la Santé (PPSPS) le cas échéant, ainsi que les instructions spécifiques communiquées par {{DONNEUR_ORDRE}} ou le coordonnateur SPS.

{{SOUS_TRAITANT}} s'engage à équiper ses salariés et intervenants des équipements de protection individuelle adaptés aux risques, à ne pas employer de personnel non habilité pour les travaux à risques particuliers, et à signaler immédiatement à {{DONNEUR_ORDRE}} tout accident, incident ou situation dangereuse constatée sur le chantier.

{{SOUS_TRAITANT}} s'engage à respecter les règles relatives à la prévention du travail dissimulé et à remettre, dès la conclusion du contrat et tous les six mois jusqu'à la fin de son exécution, les documents prévus aux articles L. 8222-1 et D. 8222-5 du Code du travail (attestation de vigilance, extrait Kbis ou équivalent, liste nominative des travailleurs étrangers le cas échéant).`,

  confidentialite: `Chaque partie s'engage à traiter comme strictement confidentiels tous les documents, informations, données techniques, commerciales, financières ou stratégiques communiquées par l'autre partie dans le cadre de la préparation et de l'exécution du présent contrat, et notamment les plans, études, devis, tarifs, procédés de fabrication, méthodes de travail et informations relatives aux clients du Donneur d'ordre.

Cette obligation de confidentialité s'impose à chaque partie pendant toute la durée du contrat et pendant une période de cinq (5) ans à compter de son terme ou de sa résiliation.

Chacune des parties s'engage à ne divulguer les informations confidentielles qu'aux membres de son personnel ou de ses prestataires qui en ont strictement besoin pour l'exécution du contrat, et à les soumettre à des obligations de confidentialité équivalentes.

Les informations qui seraient dans le domaine public ou qui auraient été obtenues légitimement de sources tierces ne sont pas soumises à la présente obligation de confidentialité.

Chaque partie reconnaît que toute violation de la présente clause serait susceptible de causer un préjudice à l'autre partie, qui pourra demander en justice toute mesure conservatoire ou réparatrice appropriée.`,

  resiliation: `Le présent contrat peut être résilié dans les conditions suivantes :

Résiliation pour manquement : En cas de manquement grave de l'une des parties à ses obligations contractuelles, la partie lésée peut, après mise en demeure adressée par lettre recommandée avec accusé de réception restée sans effet dans un délai de quinze (15) jours calendaires, procéder à la résiliation du contrat aux torts exclusifs de la partie défaillante. La résiliation ouvre droit à réparation intégrale du préjudice subi, sans préjudice des éventuelles pénalités prévues au contrat.

Résiliation pour cessation d'activité : Le contrat est automatiquement résilié en cas d'ouverture d'une procédure de sauvegarde, de redressement ou de liquidation judiciaire à l'encontre de l'une des parties, sans préjudice des droits des créanciers dans le cadre de la procédure collective.

Résiliation à l'initiative de {{DONNEUR_ORDRE}} pour convenance : {{DONNEUR_ORDRE}} peut résilier le contrat à tout moment pour des motifs propres à l'organisation du chantier, moyennant un préavis de quinze (15) jours et le règlement à {{SOUS_TRAITANT}} des prestations réalisées jusqu'à la date d'effet de la résiliation, ainsi que des dépenses engagées et non récupérables dûment justifiées.

En cas de résiliation, {{SOUS_TRAITANT}} restitue sans délai l'ensemble des documents, plans et matériaux appartenant à {{DONNEUR_ORDRE}} ou au maître d'ouvrage, et laisse le chantier en état de sécurité.`,

  annexes: `Sont annexés au présent contrat et en font partie intégrante, par ordre de prévalence :

1. Le devis ou bordereau de prix détaillé des prestations de {{SOUS_TRAITANT}} ;
2. Le planning prévisionnel d'exécution des travaux pour le chantier "{{CHANTIER}}" ;
3. Le cahier des charges, les plans et les documents techniques relatifs aux prestations ;
4. Les attestations d'assurances en cours de validité de {{SOUS_TRAITANT}} (RC professionnelle, décennale) ;
5. Les documents relatifs à la lutte contre le travail dissimulé (attestation de vigilance, extrait Kbis ou équivalent) ;
6. Le cas échéant, les conditions générales de vente ou d'achat applicables entre les parties ;
7. Tout autre document expressément désigné comme annexe par accord écrit des parties.

En cas de contradiction entre les stipulations du présent contrat et celles d'un document annexé, les stipulations du présent contrat prévaudront, sauf disposition contraire expressément mentionnée dans l'annexe concernée.

Les parties conviennent que tout avenant modificatif doit être établi par écrit et signé par les deux parties pour être opposable.`,
}

const baseMaintenance: ContractClauses = {
  objet: `Le présent contrat a pour objet de définir les conditions dans lesquelles {{SOUS_TRAITANT}} (ci-après "le Prestataire") assure les prestations de maintenance, d'entretien et/ou de dépannage au profit de {{DONNEUR_ORDRE}} (ci-après "le Client"), sur les équipements, installations ou locaux désignés dans les documents annexés au présent contrat.

Les prestations comprennent, selon les modalités précisées aux annexes : la maintenance préventive (inspections, contrôles périodiques, remplacement des pièces d'usure), la maintenance corrective (diagnostic et réparation des pannes) et, le cas échéant, les interventions d'urgence selon les délais d'astreinte convenus.

Le périmètre précis des équipements couverts, les niveaux de service (SLA), les délais d'intervention et les exclusions éventuelles sont définis dans les conditions particulières annexées.

Le Prestataire déclare disposer des compétences techniques, des certifications et des ressources humaines et matérielles nécessaires à l'exécution des prestations définies.`,

  duree: `Le présent contrat est conclu pour une durée initiale définie par les parties dans les conditions particulières. À l'issue de cette période initiale, il se renouvelle par tacite reconduction pour des périodes successives de même durée, sauf dénonciation par l'une des parties par lettre recommandée avec accusé de réception, dans le respect d'un préavis de deux (2) mois avant l'échéance.

Chaque partie peut demander la renégociation des conditions tarifaires à chaque date anniversaire du contrat, en notifiant sa demande à l'autre partie au moins trois (3) mois avant l'échéance.

Le Prestataire s'engage à assurer la continuité des prestations et à ne pas interrompre les interventions de maintenance en cours d'exécution sans accord préalable de {{DONNEUR_ORDRE}}, sauf en cas de force majeure ou de danger immédiat pour la sécurité des personnes.`,

  prix: `En contrepartie des prestations de maintenance, {{DONNEUR_ORDRE}} s'engage à régler à {{SOUS_TRAITANT}} la rémunération définie dans les conditions particulières et le bordereau de prix annexés.

La facturation est émise selon la périodicité convenue (mensuelle, trimestrielle ou autre). Les interventions hors périmètre du forfait de maintenance (pièces non incluses, main-d'oeuvre supplémentaire, déplacements au-delà du quota convenu) font l'objet d'une facturation séparée sur la base du bordereau de prix, après accord préalable écrit de {{DONNEUR_ORDRE}}.

Conformément aux dispositions de l'article L. 441-10 du Code de commerce, le délai de paiement est fixé à 30 jours à compter de la date d'émission de la facture, sauf conditions particulières expressément convenues entre les parties dans la limite légale applicable.

Tout retard de paiement entraîne de plein droit, sans mise en demeure, des pénalités au taux de trois fois le taux d'intérêt légal en vigueur, ainsi qu'une indemnité forfaitaire pour frais de recouvrement de 40 euros par facture impayée (article D. 441-5 du Code de commerce).

Les prix peuvent être révisés annuellement selon l'indice de référence convenu entre les parties, ou, à défaut, selon l'indice BT01 ou l'indice des prix à la consommation publié par l'INSEE.`,

  obligations: `Obligations du Prestataire ({{SOUS_TRAITANT}}) :
{{SOUS_TRAITANT}} s'engage à réaliser les prestations de maintenance convenues dans les délais d'intervention définis, avec du personnel qualifié et disposant des habilitations nécessaires. Il s'engage à utiliser des pièces de rechange conformes aux spécifications du fabricant ou à des spécifications équivalentes approuvées par {{DONNEUR_ORDRE}}.
{{SOUS_TRAITANT}} s'engage à établir un rapport d'intervention après chaque visite préventive et chaque dépannage, à tenir à jour le carnet de maintenance des équipements et à informer {{DONNEUR_ORDRE}} de toute anomalie détectée susceptible d'affecter la sécurité ou la fiabilité des installations.
{{SOUS_TRAITANT}} s'engage à respecter les procédures de sécurité du site et à ne pas sous-traiter tout ou partie des prestations sans accord écrit préalable de {{DONNEUR_ORDRE}}.

Obligations du Client ({{DONNEUR_ORDRE}}) :
{{DONNEUR_ORDRE}} s'engage à permettre l'accès du Prestataire aux équipements et locaux faisant l'objet du contrat, dans des conditions de sécurité satisfaisantes et aux horaires convenus. Il s'engage à signaler sans délai toute panne ou dysfonctionnement, à ne pas faire intervenir d'autres prestataires sur les équipements couverts sans en informer préalablement {{SOUS_TRAITANT}}, et à régler les factures dans les délais contractuels.`,

  assurances: `Chaque partie déclare être couverte par les assurances professionnelles requises pour l'exercice de son activité.

{{SOUS_TRAITANT}} déclare disposer notamment :
- d'une assurance responsabilité civile professionnelle couvrant les dommages corporels, matériels et immatériels causés à {{DONNEUR_ORDRE}} ou aux tiers dans le cadre des prestations ;
- d'une assurance spécifique couvrant les risques liés aux interventions sur les installations et équipements objets du contrat.

{{SOUS_TRAITANT}} s'engage à remettre à {{DONNEUR_ORDRE}}, avant tout commencement d'exécution, une attestation d'assurance en cours de validité précisant la nature et le montant des garanties, et à l'informer sans délai de tout changement affectant sa couverture.

En cas de dommages causés aux équipements, installations ou biens de {{DONNEUR_ORDRE}} du fait de fautes ou négligences du Prestataire, la responsabilité de {{SOUS_TRAITANT}} est engagée dans les conditions du droit commun.`,

  securite: `L'ensemble des interventions réalisées dans le cadre du présent contrat est effectué dans le strict respect des dispositions légales et réglementaires en vigueur relatives à la sécurité au travail, notamment les articles L. 4121-1 et suivants du Code du travail.

Avant chaque intervention sur le site de {{DONNEUR_ORDRE}}, le Prestataire établit ou met à jour le plan de prévention prévu à l'article R. 4512-7 du Code du travail, ou, le cas échéant, le bon de travail précisant les risques identifiés et les mesures de prévention retenues.

{{SOUS_TRAITANT}} s'engage à respecter les procédures de consignation et de déconsignation des équipements, à ne procéder à aucune intervention sans avoir reçu les autorisations d'accès nécessaires, et à signaler immédiatement tout accident, incident ou situation dangereuse survenant sur le site.

{{SOUS_TRAITANT}} s'engage à fournir à son personnel les équipements de protection individuelle adaptés et les formations nécessaires, notamment les habilitations électriques, certifications et autres qualifications imposées par les normes applicables aux travaux réalisés.

Chaque partie informe l'autre des risques propres à son activité susceptibles d'affecter la sécurité des intervenants ou des occupants du site.`,

  confidentialite: `Dans le cadre de l'exécution des prestations, le Prestataire peut avoir accès à des informations relatives aux installations, aux accès, à l'organisation interne et aux activités de {{DONNEUR_ORDRE}}, y compris des données à caractère technique, commercial ou financier.

{{SOUS_TRAITANT}} s'engage à traiter l'ensemble de ces informations comme strictement confidentielles, à ne les utiliser que pour les besoins de l'exécution du présent contrat, et à ne pas les divulguer à des tiers sans l'accord écrit préalable de {{DONNEUR_ORDRE}}.

Cette obligation de confidentialité s'impose à {{SOUS_TRAITANT}} pendant toute la durée du contrat et pendant une période de trois (3) ans à compter de son terme ou de sa résiliation.

{{SOUS_TRAITANT}} s'engage à prendre toutes les mesures techniques et organisationnelles appropriées pour protéger les informations confidentielles de {{DONNEUR_ORDRE}} contre tout accès non autorisé, perte, divulgation ou altération.`,

  resiliation: `Le présent contrat peut être résilié dans les conditions suivantes :

Résiliation pour manquement : En cas de manquement grave ou répété de l'une des parties à ses obligations contractuelles, la partie lésée peut, après mise en demeure par lettre recommandée avec accusé de réception demeurée sans effet pendant quinze (15) jours calendaires, procéder à la résiliation du contrat aux torts de la partie défaillante. En cas de manquement grave de {{SOUS_TRAITANT}} mettant en danger la sécurité des personnes ou des biens, {{DONNEUR_ORDRE}} peut résilier le contrat avec effet immédiat.

Résiliation pour non-paiement : En cas de défaut de paiement de {{DONNEUR_ORDRE}} persistant plus de trente (30) jours après mise en demeure, {{SOUS_TRAITANT}} peut suspendre les prestations puis résilier le contrat, sans préjudice de son droit à obtenir le paiement des sommes dues et des dommages-intérêts.

Résiliation à l'issue du préavis : Chaque partie peut mettre fin au présent contrat à chaque échéance contractuelle, sous réserve du respect du préavis défini à l'article "Durée".

À la résiliation ou à l'expiration du contrat, {{SOUS_TRAITANT}} remet à {{DONNEUR_ORDRE}} l'ensemble des carnets de maintenance, rapports d'intervention et documentations techniques relatifs aux équipements.`,

  annexes: `Sont annexés au présent contrat et en font partie intégrante, par ordre de prévalence :

1. Les conditions particulières définissant le périmètre des équipements couverts, les niveaux de service et les délais d'intervention ;
2. Le bordereau de prix unitaires des prestations et des interventions hors forfait ;
3. La liste des équipements et installations objets du contrat, avec leurs caractéristiques ;
4. Les gammes de maintenance préventive et les fréquences d'intervention prévues ;
5. Les attestations d'assurances en cours de validité de {{SOUS_TRAITANT}} ;
6. Le cas échéant, les conditions générales de prestation de services applicables ;
7. Tout autre document expressément désigné comme annexe par accord écrit des parties.

Les parties conviennent que tout avenant modifiant le périmètre, les niveaux de service ou les tarifs doit être établi par écrit et signé par les deux parties pour être opposable.`,
}

function mergeClauses(base: ContractClauses, patch: Partial<ContractClauses>): ContractClauses {
  return { ...base, ...patch }
}

export const CONTRACT_TEMPLATES: ContractTemplate[] = [
  {
    key: 'sous_traitance_btp_generique',
    title: 'Contrat de sous-traitance BTP',
    type: 'sous_traitance',
    trade: 'generique',
    clauses: baseSousTraitance,
  },
  {
    key: 'maintenance_generique',
    title: 'Contrat de maintenance',
    type: 'maintenance',
    trade: 'generique',
    clauses: baseMaintenance,
  },
  {
    key: 'sous_traitance_electricite',
    title: 'Contrat de sous-traitance électricité',
    type: 'sous_traitance',
    trade: 'electricite',
    clauses: mergeClauses(baseSousTraitance, {
      objet: `Le présent contrat est conclu en application des dispositions de la loi n° 75-1334 du 31 décembre 1975 relative à la sous-traitance, et a pour objet de définir les conditions dans lesquelles {{SOUS_TRAITANT}} (ci-après "le Sous-traitant") réalise, pour le compte de {{DONNEUR_ORDRE}} (ci-après "le Donneur d'ordre"), les prestations électriques désignées ci-après : travaux d'installation, de pose, de raccordement, de mise en conformité, de contrôle ou de mise en service des équipements et installations électriques décrits dans les documents contractuels.

Les prestations portent sur le chantier ou l'opération désignée sous le nom "{{CHANTIER}}". {{SOUS_TRAITANT}} déclare disposer des qualifications, certifications et habilitations électriques requises (norme NF C 18-510, qualifications QUALIFELEC ou équivalentes) pour l'exécution des travaux confiés, et s'engage à les maintenir en cours de validité pendant toute la durée du contrat.

Les travaux seront réalisés conformément aux normes et réglementations applicables, notamment la norme NF C 15-100 pour les installations basse tension, les prescriptions UTE, le décret n° 88-1056 du 14 novembre 1988 relatif à la protection des travailleurs dans les établissements mettant en oeuvre des courants électriques, et toute autre norme applicable à la nature des travaux.`,

      securite: `Les travaux électriques sont réalisés dans le strict respect des dispositions relatives à la sécurité électrique, notamment la norme NF C 18-510 relative aux opérations sur les ouvrages et installations électriques, et le décret n° 88-1056 du 14 novembre 1988.

{{SOUS_TRAITANT}} s'engage à n'affecter à l'exécution des travaux électriques que du personnel disposant des habilitations électriques appropriées au niveau de tension et à la nature des opérations (B1, B2, BR, BC, H1, H2, HC selon classification NF C 18-510), et à tenir à jour les titres d'habilitation correspondants.

Les procédures de consignation (séparation, condamnation, vérification d'absence de tension, mise à la terre et en court-circuit) seront appliquées systématiquement avant toute intervention sur des installations sous tension ou susceptibles d'être mises sous tension. Aucun travail sous tension ne sera réalisé sans autorisation écrite de {{DONNEUR_ORDRE}} et sans les protections individuelles adaptées.

{{SOUS_TRAITANT}} veille à la protection des tiers et des autres corps d'état intervenant sur le chantier "{{CHANTIER}}" contre les risques électriques, et signale immédiatement tout défaut ou anomalie détectés sur les installations existantes.`,

      assurances: `{{SOUS_TRAITANT}} déclare disposer des assurances professionnelles suivantes, adaptées à la nature des travaux électriques confiés :
- Assurance responsabilité civile professionnelle et responsabilité civile chantier ;
- Assurance décennale au sens de l'article L. 241-1 du Code des assurances, pour les travaux relevant de la garantie décennale ;
- Assurance couvrant les risques spécifiques liés aux travaux électriques (dommages aux installations, incendie d'origine électrique).

{{SOUS_TRAITANT}} atteste que les qualifications professionnelles (QUALIFELEC ou équivalent) et habilitations électriques de son personnel sont en cours de validité et adaptées aux travaux visés par le présent contrat.

Les attestations d'assurances et les justificatifs de qualifications seront remis à {{DONNEUR_ORDRE}} avant tout commencement d'exécution des travaux sur le chantier "{{CHANTIER}}".`,
    }),
  },
  {
    key: 'sous_traitance_plomberie',
    title: 'Contrat de sous-traitance plomberie',
    type: 'sous_traitance',
    trade: 'plomberie',
    clauses: mergeClauses(baseSousTraitance, {
      objet: `Le présent contrat est conclu en application des dispositions de la loi n° 75-1334 du 31 décembre 1975 relative à la sous-traitance, et a pour objet de définir les conditions dans lesquelles {{SOUS_TRAITANT}} (ci-après "le Sous-traitant") réalise, pour le compte de {{DONNEUR_ORDRE}} (ci-après "le Donneur d'ordre"), les prestations de plomberie, sanitaires et réseaux hydrauliques désignées ci-après sur le chantier "{{CHANTIER}}" : travaux de plomberie sanitaire, réseaux d'eau froide et chaude, évacuations, équipements hydrauliques et appareils sanitaires décrits dans les documents contractuels.

{{SOUS_TRAITANT}} déclare disposer des qualifications professionnelles requises (QUALIBAT 5131 ou équivalente), des certifications RGE le cas échéant, et s'engage à réaliser les travaux conformément aux normes DTU applicables (notamment DTU 60.1, DTU 60.11, DTU 60.31) et à la réglementation en vigueur.

{{SOUS_TRAITANT}} déclare avoir pris connaissance des plans des réseaux existants et des contraintes spécifiques au site, et s'engage à prendre toutes les précautions nécessaires pour préserver l'intégrité des installations existantes lors de ses interventions.`,

      securite: `{{SOUS_TRAITANT}} s'engage à veiller à la protection des réseaux d'alimentation en eau et d'évacuation existants lors de ses interventions sur le chantier "{{CHANTIER}}", à localiser les réseaux enterrés avant tout terrassement, et à n'effectuer aucune coupure d'alimentation sans en informer préalablement {{DONNEUR_ORDRE}} et coordonner l'intervention avec les autres corps d'état concernés.

L'ensemble des travaux sera réalisé dans le respect des normes DTU applicables aux installations de plomberie et de chauffage, des prescriptions des fabricants d'équipements, et des règles de l'art en matière d'étanchéité, de résistance à la pression et de protection contre les risques de gel ou de corrosion.

{{SOUS_TRAITANT}} réalise les essais d'étanchéité et de mise en pression requis par les normes applicables et les documents contractuels, et en fournit les procès-verbaux à {{DONNEUR_ORDRE}}. Toute fuite ou anomalie détectée sur les installations existantes est immédiatement signalée.

Les règles de sécurité du chantier et les consignes de {{DONNEUR_ORDRE}} sont respectées en toutes circonstances. {{SOUS_TRAITANT}} prend les mesures nécessaires pour protéger les ouvrages environnants contre les risques de dégâts des eaux pendant et après les travaux.`,

      assurances: `{{SOUS_TRAITANT}} déclare disposer des assurances professionnelles adaptées aux travaux de plomberie confiés, notamment :
- Assurance responsabilité civile professionnelle et responsabilité civile chantier, incluant la couverture des risques de dégâts des eaux pouvant résulter des interventions ;
- Assurance décennale au sens de l'article L. 241-1 du Code des assurances, pour les travaux relevant de la garantie décennale ;
- Le cas échéant, assurance couvrant les dommages aux existants et aux ouvrages adjacents.

{{SOUS_TRAITANT}} s'engage à transmettre à {{DONNEUR_ORDRE}} ses attestations d'assurances en cours de validité et les justificatifs de ses qualifications (QUALIBAT ou équivalent) avant tout commencement d'exécution sur le chantier "{{CHANTIER}}".`,
    }),
  },
  {
    key: 'sous_traitance_second_oeuvre',
    title: 'Contrat de sous-traitance second oeuvre',
    type: 'sous_traitance',
    trade: 'second_oeuvre',
    clauses: mergeClauses(baseSousTraitance, {
      objet: `Le présent contrat est conclu en application des dispositions de la loi n° 75-1334 du 31 décembre 1975 relative à la sous-traitance, et a pour objet de définir les conditions dans lesquelles {{SOUS_TRAITANT}} (ci-après "le Sous-traitant") réalise, pour le compte de {{DONNEUR_ORDRE}} (ci-après "le Donneur d'ordre"), les prestations de second oeuvre désignées ci-après sur le chantier "{{CHANTIER}}" : travaux de finition, d'aménagement intérieur ou de rénovation (peinture, revêtements de sols et muraux, menuiseries, plâtrerie, faux-plafonds, carrelage, etc.) tels que décrits dans les documents contractuels.

{{SOUS_TRAITANT}} déclare disposer des qualifications professionnelles adaptées à la nature des prestations confiées et s'engage à les réaliser conformément aux normes DTU applicables (DTU 59.1, DTU 52.1, DTU 58.1, DTU 36.1 selon les travaux), aux règles de l'art et aux prescriptions de {{DONNEUR_ORDRE}}.

{{SOUS_TRAITANT}} déclare avoir visité le chantier et pris connaissance de l'état des lieux, des accès, des contraintes de coactivité et des règles de circulation sur le site afin d'organiser son intervention en conséquence.`,

      securite: `{{SOUS_TRAITANT}} s'engage à protéger les ouvrages réalisés par les autres corps d'état ainsi que les éléments existants susceptibles d'être affectés par ses travaux sur le chantier "{{CHANTIER}}" (parquets, fenêtres, équipements sanitaires, etc.), et à réparer à ses frais tout dommage causé aux travaux ou biens d'autrui du fait de ses interventions.

{{SOUS_TRAITANT}} maintient en permanence sa zone d'intervention propre et dégagée, évacue régulièrement les gravats et déchets dans les conteneurs désignés par {{DONNEUR_ORDRE}}, et respecte les obligations liées à la traçabilité et au tri des déchets du bâtiment (notamment la réglementation sur les déchets inertes et les déchets de chantier).

{{SOUS_TRAITANT}} respecte les règles de coactivité définies par {{DONNEUR_ORDRE}} et coordonne ses interventions avec les autres corps d'état présents, notamment pour les phases de peinture (risque d'émissions de COV), d'application de produits chimiques (colles, résines) et de travaux générateurs de poussières.

Les produits utilisés (peintures, colles, enduits) respectent les réglementations en vigueur relatives à la composition chimique, aux émissions en COV et aux fiches de données de sécurité (FDS) disponibles sur le chantier.`,
    }),
  },
  {
    key: 'maintenance_electricite',
    title: 'Contrat de maintenance électricité',
    type: 'maintenance',
    trade: 'electricite',
    clauses: mergeClauses(baseMaintenance, {
      objet: `Le présent contrat a pour objet de définir les conditions dans lesquelles {{SOUS_TRAITANT}} (ci-après "le Prestataire") assure la maintenance préventive et corrective des installations électriques de {{DONNEUR_ORDRE}} (ci-après "le Client"), telles que listées dans l'annexe équipements jointe au présent contrat.

Les prestations comprennent : les visites de maintenance préventive selon le plan de maintenance défini en annexe, les contrôles réglementaires périodiques (vérifications électriques initiales et périodiques prévues aux articles R. 4226-14 à R. 4226-21 du Code du travail), les interventions correctives (diagnostic et réparation des pannes et dysfonctionnements), et le cas échéant les interventions en astreinte selon les délais convenus.

{{SOUS_TRAITANT}} déclare disposer des habilitations électriques appropriées (norme NF C 18-510), des certifications et qualifications techniques nécessaires à l'exécution des prestations, et s'engage à les maintenir en validité pendant toute la durée du contrat.`,

      securite: `L'ensemble des interventions est réalisé dans le respect de la norme NF C 18-510 relative aux opérations sur les ouvrages et installations électriques et le décret n° 88-1056 du 14 novembre 1988.

{{SOUS_TRAITANT}} s'engage à n'affecter aux interventions électriques que du personnel disposant des habilitations appropriées au niveau de tension et à la nature des opérations, et à appliquer systématiquement les procédures de consignation (séparation, condamnation, vérification d'absence de tension, mise à la terre et en court-circuit) avant toute intervention sur des installations susceptibles d'être sous tension.

Avant chaque intervention sur le site de {{DONNEUR_ORDRE}}, {{SOUS_TRAITANT}} établit ou met à jour le plan de prévention prévu à l'article R. 4512-7 du Code du travail, en concertation avec {{DONNEUR_ORDRE}}. Tout accident ou incident survenant lors des interventions est immédiatement signalé à {{DONNEUR_ORDRE}}.

Les contrôles réglementaires réalisés dans le cadre du présent contrat font l'objet de rapports écrits transmis à {{DONNEUR_ORDRE}}, mentionnant les observations, les anomalies relevées et les recommandations.`,
    }),
  },
  {
    key: 'maintenance_plomberie',
    title: 'Contrat de maintenance plomberie',
    type: 'maintenance',
    trade: 'plomberie',
    clauses: mergeClauses(baseMaintenance, {
      objet: `Le présent contrat a pour objet de définir les conditions dans lesquelles {{SOUS_TRAITANT}} (ci-après "le Prestataire") assure la maintenance préventive et corrective des équipements de plomberie, des réseaux hydrauliques et des appareils sanitaires de {{DONNEUR_ORDRE}} (ci-après "le Client"), tels que listés dans l'annexe équipements jointe au présent contrat.

Les prestations comprennent : les visites de maintenance préventive et les contrôles périodiques (vérification de l'étanchéité, des pressions de réseau, du bon fonctionnement des équipements, des protections anti-retour, du traitement anti-légionelle le cas échéant), les interventions correctives sur pannes et fuites, et la fourniture et pose des pièces de remplacement nécessaires selon les conditions tarifaires définies en annexe.

{{SOUS_TRAITANT}} déclare disposer des qualifications professionnelles requises (QUALIBAT ou équivalentes) et s'engage à les maintenir en validité pendant toute la durée du contrat.`,

      securite: `Les interventions de maintenance sont réalisées dans le respect des normes et DTU applicables aux installations de plomberie (DTU 60.1, 60.11, 60.31), et des prescriptions réglementaires relatives à la qualité de l'eau et à la prévention du risque légionelles (circulaire DGS/SD7A n° 2002-243 du 22 avril 2002 et arrêtés applicables).

Avant toute coupure d'eau susceptible d'affecter les occupants ou les activités de {{DONNEUR_ORDRE}}, {{SOUS_TRAITANT}} en informe {{DONNEUR_ORDRE}} avec un préavis suffisant et coordonne l'intervention aux horaires convenus. Les mesures de protection nécessaires sont prises pour éviter tout dégât des eaux lors des travaux ou à l'occasion des remises en eau.

{{SOUS_TRAITANT}} prend en compte les risques liés aux pressions de réseau (coups de bélier, surpression) et aux températures (risque de brûlure, risque de gel) et adapte ses interventions en conséquence. Toute fuite, anomalie de pression ou risque sanitaire détecté est signalé immédiatement à {{DONNEUR_ORDRE}}.

Le plan de prévention prévu à l'article R. 4512-7 du Code du travail est établi ou mis à jour avant chaque campagne d'interventions sur le site de {{DONNEUR_ORDRE}}.`,
    }),
  },
  {
    key: 'maintenance_second_oeuvre',
    title: 'Contrat de maintenance second oeuvre',
    type: 'maintenance',
    trade: 'second_oeuvre',
    clauses: mergeClauses(baseMaintenance, {
      objet: `Le présent contrat a pour objet de définir les conditions dans lesquelles {{SOUS_TRAITANT}} (ci-après "le Prestataire") assure les interventions de maintenance, de réparation ou de remise en état des éléments de second oeuvre de {{DONNEUR_ORDRE}} (ci-après "le Client"), tels que listés dans l'annexe jointe : menuiseries intérieures et extérieures, revêtements de sols et muraux, peintures, faux-plafonds, cloisons, mobilier technique, etc.

Les prestations comprennent : les visites de maintenance préventive et d'inspection selon le plan de maintenance défini en annexe, les interventions correctives (réparations, remises en état, remplacements) à la suite de dégradations ou de défauts de fonctionnement, et les petits travaux d'entretien courant relevant du périmètre contractuel.

{{SOUS_TRAITANT}} déclare disposer des qualifications professionnelles adaptées à la nature des prestations et s'engage à intervenir avec du personnel formé et expérimenté dans les corps d'état de second oeuvre concernés.`,
    }),
  },
  {
    key: 'sous_traitance_nettoyage',
    title: 'Contrat de sous-traitance nettoyage',
    type: 'sous_traitance',
    trade: 'nettoyage',
    clauses: mergeClauses(baseSousTraitance, {
      objet: `Le présent contrat est conclu en application des dispositions de la loi n° 75-1334 du 31 décembre 1975 relative à la sous-traitance, et a pour objet de définir les conditions dans lesquelles {{SOUS_TRAITANT}} (ci-après "le Sous-traitant") réalise, pour le compte de {{DONNEUR_ORDRE}} (ci-après "le Donneur d'ordre"), les prestations de nettoyage, remise en état ou propreté de chantier désignées ci-après sur le site "{{CHANTIER}}" : nettoyage de fin de chantier, élimination des déchets et gravats, nettoyage des surfaces, vitres, revêtements, équipements et parties communes, selon les spécifications définies dans les documents contractuels.

{{SOUS_TRAITANT}} déclare disposer des compétences, du matériel et des produits adaptés à la nature des surfaces et des salissures, et s'engage à réaliser les prestations conformément aux normes d'hygiène et aux règles de l'art applicables au secteur du nettoyage professionnel, notamment les exigences de la norme NF EN 13549 et des guides de bonnes pratiques du secteur.

{{SOUS_TRAITANT}} déclare avoir pris connaissance des conditions d'accès au site, des surfaces à traiter, des contraintes d'intervention (présence d'autres corps d'état, horaires, matériaux à préserver) et s'engage à coordonner ses interventions avec {{DONNEUR_ORDRE}} pour ne pas perturber le bon avancement du chantier.`,

      securite: `L'ensemble des prestations de nettoyage est réalisé dans le strict respect des dispositions légales et réglementaires relatives à la sécurité et à la santé des travailleurs, notamment les articles L. 4121-1 et suivants du Code du travail et le décret n° 94-1159 du 26 décembre 1994.

{{SOUS_TRAITANT}} s'engage à utiliser exclusivement des produits d'entretien et de nettoyage conformes à la réglementation en vigueur (règlement CE 1907/2006 REACH, règlement CE 648/2004), à tenir les fiches de données de sécurité (FDS) disponibles sur le chantier pour chaque produit utilisé, et à respecter les règles de stockage, de dilution et d'élimination de ces produits.

{{SOUS_TRAITANT}} s'engage à équiper ses salariés des équipements de protection individuelle adaptés aux produits utilisés et aux risques identifiés (gants, lunettes, chaussures de sécurité, masques le cas échéant) et à ne pas utiliser de produits dangereux non compatibles avec les matériaux présents sur le site "{{CHANTIER}}".

Les déchets issus des prestations de nettoyage (gravats, emballages, produits usagés) sont triés, conditionnés et évacués conformément à la réglementation sur les déchets et aux instructions de {{DONNEUR_ORDRE}}.

{{SOUS_TRAITANT}} informe immédiatement {{DONNEUR_ORDRE}} de tout dommage causé aux surfaces, équipements ou matériaux lors des prestations.`,

      assurances: `{{SOUS_TRAITANT}} déclare disposer des assurances professionnelles adaptées aux prestations de nettoyage de chantier, notamment :
- Assurance responsabilité civile professionnelle couvrant les dommages corporels, matériels et immatériels causés aux tiers, aux ouvrages et aux équipements dans le cadre des prestations ;
- Assurance couvrant les risques liés à l'utilisation de produits chimiques (détergents, solvants) susceptibles d'endommager les matériaux ou revêtements traités.

{{SOUS_TRAITANT}} s'engage à transmettre à {{DONNEUR_ORDRE}}, avant tout commencement des prestations sur le chantier "{{CHANTIER}}", ses attestations d'assurances en cours de validité ainsi que les justificatifs des qualifications professionnelles de son personnel (agrément ou certification de nettoyage professionnel selon les travaux concernés).`,
    }),
  },
  {
    key: 'maintenance_nettoyage',
    title: 'Contrat de maintenance nettoyage',
    type: 'maintenance',
    trade: 'nettoyage',
    clauses: mergeClauses(baseMaintenance, {
      objet: `Le présent contrat a pour objet de définir les conditions dans lesquelles {{SOUS_TRAITANT}} (ci-après "le Prestataire") assure les prestations régulières de nettoyage, d'entretien et de propreté au profit de {{DONNEUR_ORDRE}} (ci-après "le Client"), sur les locaux, surfaces, équipements ou parties communes désignés dans l'annexe équipements et périmètre jointe au présent contrat.

Les prestations comprennent, selon la fréquence et les modalités définies en annexe : le nettoyage courant des sols et surfaces (balayage, lavage, aspiration), le nettoyage des sanitaires et espaces communs, le traitement des vitres et façades vitrées, le nettoyage des équipements techniques accessibles, la collecte et l'évacuation des déchets, et les opérations périodiques de remise en état (décapage, lustrage, nettoyage haute pression, etc.).

{{SOUS_TRAITANT}} déclare disposer des compétences, du matériel professionnel et des produits adaptés à la nature des surfaces et des prestations définies, et s'engage à maintenir un niveau de propreté conforme aux exigences de {{DONNEUR_ORDRE}} pendant toute la durée du contrat.`,

      securite: `L'ensemble des interventions est réalisé dans le respect des dispositions légales et réglementaires relatives à la sécurité et à la santé des travailleurs, notamment les articles L. 4121-1 et suivants du Code du travail.

{{SOUS_TRAITANT}} s'engage à utiliser des produits d'entretien conformes à la réglementation en vigueur (règlement CE 1907/2006 REACH, règlement CE 648/2004 sur les détergents), à tenir à jour les fiches de données de sécurité (FDS) et à les mettre à disposition de {{DONNEUR_ORDRE}} sur demande.

{{SOUS_TRAITANT}} s'engage à équiper son personnel des équipements de protection individuelle adaptés (gants, chaussures antidérapantes, lunettes de protection le cas échéant) et à respecter les consignes de sécurité propres aux locaux de {{DONNEUR_ORDRE}}, notamment en ce qui concerne les accès, la gestion des clés et badges, et les horaires d'intervention.

Les produits utilisés respectent les engagements environnementaux définis entre les parties (écolabels, biodégradabilité, concentration des dosages) et les déchets issus des interventions sont triés et éliminés conformément à la réglementation en vigueur.

Avant chaque campagne d'interventions dans les locaux de {{DONNEUR_ORDRE}}, {{SOUS_TRAITANT}} s'assure que le plan de prévention prévu à l'article R. 4512-7 du Code du travail est établi ou mis à jour.`,

      assurances: `{{SOUS_TRAITANT}} déclare disposer des assurances professionnelles adaptées aux prestations de nettoyage et d'entretien, notamment :
- Assurance responsabilité civile professionnelle couvrant les dommages corporels, matériels et immatériels causés à {{DONNEUR_ORDRE}} ou aux tiers dans le cadre des interventions ;
- Assurance couvrant les risques de vol ou de dommages aux biens de {{DONNEUR_ORDRE}} lors des interventions dans ses locaux.

{{SOUS_TRAITANT}} s'engage à remettre à {{DONNEUR_ORDRE}}, avant toute première intervention, une attestation d'assurance en cours de validité précisant les garanties souscrites. Il en informe {{DONNEUR_ORDRE}} sans délai en cas de modification ou de résiliation de sa couverture.`,
    }),
  },
]

export function resolveTradeFromActivity(activityId: BusinessActivityId | string | null | undefined): ContractTemplate['trade'] {
  if (activityId === 'electricite') return 'electricite'
  if (activityId === 'plomberie') return 'plomberie'
  if (activityId === 'renovation' || activityId === 'menuiserie' || activityId === 'peinture' || activityId === 'carrelage') return 'second_oeuvre'
  if (activityId === 'nettoyage') return 'nettoyage'
  return 'generique'
}

export function getContractTemplates(type?: ContractType | null, activityId?: string | null): ContractTemplate[] {
  const trade = resolveTradeFromActivity(activityId)
  return CONTRACT_TEMPLATES
    .filter(template => !type || template.type === type)
    .sort((a, b) => {
      const aScore = a.trade === trade ? 0 : a.trade === 'generique' ? 1 : 2
      const bScore = b.trade === trade ? 0 : b.trade === 'generique' ? 1 : 2
      return aScore - bScore || a.title.localeCompare(b.title, 'fr')
    })
}

export function getContractTemplate(key: string): ContractTemplate | null {
  return CONTRACT_TEMPLATES.find(template => template.key === key) ?? null
}

export function normalizeClauses(input: unknown, fallback: ContractClauses): ContractClauses {
  const raw = typeof input === 'object' && input !== null ? input as Partial<Record<ContractClauseKey, unknown>> : {}
  return (Object.keys(CLAUSE_LABELS) as ContractClauseKey[]).reduce((acc, key) => {
    const value = raw[key]
    acc[key] = typeof value === 'string' && value.trim() ? value.trim() : fallback[key]
    return acc
  }, {} as ContractClauses)
}

export function interpolateClauses(
  clauses: ContractClauses,
  vars: { donneurOrdre?: string | null; soustraitant?: string | null; chantier?: string | null },
): ContractClauses {
  const replacer = (text: string) =>
    text
      .replace(/\{\{DONNEUR_ORDRE\}\}/g, vars.donneurOrdre || 'le Donneur d\'ordre')
      .replace(/\{\{SOUS_TRAITANT\}\}/g, vars.soustraitant || 'le Sous-traitant')
      .replace(/\{\{CHANTIER\}\}/g, vars.chantier || 'le chantier')

  return (Object.keys(clauses) as ContractClauseKey[]).reduce((acc, key) => {
    acc[key] = replacer(clauses[key] ?? '')
    return acc
  }, {} as ContractClauses)
}

export function interpolateCustomSections(
  sections: ContractCustomSection[],
  vars: { donneurOrdre?: string | null; soustraitant?: string | null; chantier?: string | null },
): ContractCustomSection[] {
  const replacer = (text: string) =>
    text
      .replace(/\{\{DONNEUR_ORDRE\}\}/g, vars.donneurOrdre || 'le Donneur d\'ordre')
      .replace(/\{\{SOUS_TRAITANT\}\}/g, vars.soustraitant || 'le Sous-traitant')
      .replace(/\{\{CHANTIER\}\}/g, vars.chantier || 'le chantier')

  return sections.map(section => ({
    ...section,
    title: replacer(section.title),
    content: replacer(section.content),
  }))
}
