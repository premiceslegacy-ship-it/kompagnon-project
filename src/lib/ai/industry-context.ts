type IndustryPromptUsage = 'quote' | 'catalog'

type IndustryPromptInput = {
  sector: string
  activityDescription?: string | null
  secondaryActivityLabels?: string[]
  businessProfile?: string | null
  usage?: IndustryPromptUsage
}

function normalizeForSearch(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

export function buildIndustryQualityPrompt(input: IndustryPromptInput): string {
  const haystack = normalizeForSearch([
    input.sector,
    input.activityDescription,
    ...(input.secondaryActivityLabels ?? []),
    input.businessProfile,
  ].filter(Boolean).join(' '))

  const applies = input.businessProfile === 'industry' || [
    'industrie',
    'industry',
    'metallerie',
    'tolerie',
    'chaudronnerie',
    'soudure',
    'fabrication metallique',
    'metal',
  ].some(token => haystack.includes(token))

  if (!applies) return ''

  const catalogRules = input.usage === 'catalog'
    ? `
Regles catalogue supplementaires :
- Structure les matieres avec des references exploitables : nuance, epaisseur, format, etat ou finition quand connu (ex : "Tole acier S235 2 mm", "Tube inox 316L 40x40x2").
- Classe les operations vendues au client en services/prestations : decoupe laser, pliage, roulage, soudure TIG/MIG/MAG, meulage, passivation, thermolaquage RAL, galvanisation, controle, dossier qualite.
- Classe les moyens internes en ressources : operateur atelier, soudeur qualifie, poste TIG/MIG/MAG, presse plieuse, laser, rouleuse, cabine peinture, banc de controle, sous-traitant traitement de surface.
- Les certificats, PV et controles vendus comme livrables doivent pouvoir devenir des prestations visibles : certificat matiere EN 10204 3.1, dossier qualite, controle ressuage, PV dimensionnel, note de calcul.
- Ne cree pas une certification entreprise comme si elle etait acquise. Si une norme apparait sans preuve de qualification interne, cree plutot une prestation ou une note "a confirmer".`
    : `
Regles devis supplementaires :
- Les exigences qualite peuvent devenir des lignes visibles si elles sont vendues comme livrable (ex : "Dossier qualite et tracabilite matiere", "Controle ressuage", "Note de calcul"). Sinon, mets-les dans details ou quoteWarnings.`

  return `## Exigences industrie metal, qualite et tracabilite
Ce bloc s'applique aux activites de tolerie, metallerie, chaudronnerie, soudure, fabrication inox/acier/aluminium et environnements industriels reglementes.

Regles obligatoires :
- Ne promets jamais une certification, une qualification, un certificat matiere ou une conformite normative si elle n'est pas explicitement fournie par l'entreprise ou demandee par le client. Si l'exigence est probable mais non confirmee, signale qu'elle est a confirmer.
- Si le projet est structurel ou destine a etre mis sur le marche comme composant acier/aluminium de construction, prevois une verification EN 1090 / marquage CE / classe d'execution.
- Si le client demande des certificats matiere, PV matiere, tracabilite ou un dossier qualite, mentionne EN 10204 et precise le type demande si connu : 2.1, 2.2, 3.1 ou 3.2. Pour les environnements exigeants, propose a minima "certificat matiere EN 10204 3.1 a confirmer fournisseur"; 3.2 uniquement si le client/contrat l'exige.
- Si soudage : repere les procedes TIG, MIG, MAG, electrode, inox, alu, acier. Si le client demande une qualite soudage, prevois ISO 3834 a verifier. Si qualification soudeur ou procedure demandee : mentionne ISO 9606 pour qualification soudeur, ISO 15614 / QMOS / DMOS / WPQR / WPS pour procedure.
- Pour inox et aluminium, distingue les nuances quand le besoin l'exige : inox 304L / 316L, acier S235 / S355, aluminium 5083 / 5754 / 6082. Si milieu marin, exterieur agressif, alimentaire, pharma ou chimique : privilegie inox 316L ou ajoute une validation matiere a confirmer.
- Si finition ou etat de surface : precise thermolaquage RAL, galvanisation, anodisation, brossage, passivation inox, decapage/passivation soudure, rugosite si pharma/agro.
- Si controle demande ou environnement reglemente : ajoute les controles utiles : controle visuel, dimensionnel, ressuage, etancheite, PV de controle, note de calcul, plan de fabrication, dossier des ouvrages executes / dossier constructeur.
- Si le cahier des charges mentionne pharma, agroalimentaire, medical, pression, levage, garde-corps, structure, machine ou securite utilisateur, baisse la confiance si les normes, charges, plans, nuances, certificats et controles ne sont pas explicites.
${catalogRules}
`
}
