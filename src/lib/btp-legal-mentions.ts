// Vérification des mentions légales obligatoires sur les devis BTP
// Sources : Code de la consommation, Code de commerce, Loi Elan, NF P03-001
//
// Usage : checkBtpMentions(quote, organization) → liste des mentions manquantes

export type BtpMentionCheck = {
  id: string
  label: string              // libellé court affiché dans l'UI
  detail: string             // explication complète
  category: BtpMentionCategory
  missing: boolean
  severity: 'bloquant' | 'important' | 'info'
}

export type BtpMentionCategory =
  | 'identification'
  | 'client'
  | 'description_travaux'
  | 'prix'
  | 'tva'
  | 'delai'
  | 'garanties'
  | 'paiement'
  | 'divers'

type QuoteForCheck = {
  title: string | null
  notes_client: string | null
  payment_conditions: string | null
  issue_date: string | null
  valid_until: string | null
  total_ht: number | null
  total_ttc: number | null
  items: { description: string | null; quantity: number; unit: string | null; unit_price: number; vat_rate: number }[]
	  client: {
	    type: string | null
	    company_name: string | null
	    first_name: string | null
	    last_name: string | null
    address_line1: string | null
    postal_code: string | null
    city: string | null
    siret: string | null
  } | null
}

export type OrgForCheck = {
  name: string
  siret: string | null
  rcs: string | null
  vat_number: string | null
  is_vat_subject: boolean
  address_line1: string | null
  postal_code: string | null
  city: string | null
  phone: string | null
  email: string | null
  insurance_info: string | null
  decennale_enabled: boolean | null
  forme_juridique: string | null
	  late_penalty_rate: string | number | null
	  payment_terms_days: number | null
	  iban: string | null
	  recovery_indemnity_text?: string | null
	}

export function checkBtpMentions(quote: QuoteForCheck, org: OrgForCheck): BtpMentionCheck[] {
  const checks: BtpMentionCheck[] = []

  function add(
    id: string,
    label: string,
    detail: string,
    category: BtpMentionCategory,
    missing: boolean,
    severity: BtpMentionCheck['severity'] = 'important',
  ) {
    checks.push({ id, label, detail, category, missing, severity })
  }

  const notes = (quote.notes_client ?? '').toLowerCase()
  const paymentCond = (quote.payment_conditions ?? '').toLowerCase()
	  const allText = notes + ' ' + paymentCond
	  const items = quote.items ?? []
	  const vatRates = [...new Set(items.map(i => i.vat_rate))]
	  const hasVat = org.is_vat_subject
	  const isClientPro = quote.client?.type === 'company'
	  const isClientIndividual = quote.client?.type === 'individual'
	  const hasPdfRecoveryIndemnity = Boolean(org.late_penalty_rate && isClientPro)
	  const hasExecutionStartEstimate =
	    allText.includes('début') ||
	    allText.includes('commencement') ||
	    allText.includes('démarrage') ||
	    allText.includes('demarrage') ||
	    allText.includes('planning') ||
	    allText.includes('calendrier') ||
	    allText.includes('prévision') ||
	    allText.includes('prevision') ||
	    allText.includes('estim') ||
	    allText.includes('après acceptation') ||
	    allText.includes('apres acceptation') ||
	    allText.includes('à confirmer') ||
	    allText.includes('a confirmer') ||
	    allText.includes('à définir') ||
	    allText.includes('a definir')

  // ── 1. Identification de l'entreprise ────────────────────────────────────────
  add('org_name', 'Nom/raison sociale', 'Le nom ou la raison sociale de l\'entreprise doit figurer sur le devis.', 'identification', !org.name, 'bloquant')
  add('org_siret', 'SIRET', 'Le numéro SIRET de l\'entreprise est obligatoire.', 'identification', !org.siret, 'bloquant')
  add('org_rcs', 'RCS ou RM', 'Le numéro d\'immatriculation RCS (sociétés) ou RM (artisans) doit figurer.', 'identification', !org.rcs, 'important')
  add('org_forme_juridique', 'Forme juridique', 'La forme juridique (SARL, SAS, EI, EURL...) doit être indiquée.', 'identification', !org.forme_juridique, 'important')
  add('org_address', 'Adresse siège social', 'L\'adresse du siège social de l\'entreprise est obligatoire.', 'identification', !org.address_line1 || !org.postal_code || !org.city, 'bloquant')
  add('org_phone', 'Téléphone', 'Un numéro de téléphone de contact doit être mentionné.', 'identification', !org.phone, 'info')
  add('org_email', 'Email', 'Une adresse email de contact doit être mentionnée.', 'identification', !org.email, 'info')
  add('org_vat', 'N° TVA intracommunautaire', 'Le numéro de TVA intracommunautaire est obligatoire si assujetti à la TVA.', 'identification', hasVat && !org.vat_number, 'bloquant')

  // ── 2. Identification du client ───────────────────────────────────────────────
  const clientName = quote.client?.company_name || [quote.client?.first_name, quote.client?.last_name].filter(Boolean).join(' ')
  add('client_name', 'Nom du client', 'Le nom ou la raison sociale du client destinataire doit figurer.', 'client', !clientName, 'bloquant')
  add('client_address', 'Adresse du client', 'L\'adresse du client doit être indiquée sur le devis.', 'client', !quote.client?.address_line1, 'important')

  // ── 3. Description des travaux ────────────────────────────────────────────────
  add('quote_title', 'Objet / intitulé des travaux', 'Le devis doit mentionner clairement l\'objet des travaux.', 'description_travaux', !quote.title, 'bloquant')
  add('quote_date', 'Date d\'établissement du devis', 'La date d\'établissement est obligatoire (art. L111-1 Code de la consommation).', 'description_travaux', !quote.issue_date, 'bloquant')
  add('quote_validity', 'Durée de validité', 'La durée de validité de l\'offre doit être indiquée.', 'description_travaux', !quote.valid_until, 'important')
  add('items_description', 'Désignation détaillée des travaux', 'Chaque prestation doit avoir une désignation précise (nature, quantité, unité, prix unitaire).', 'description_travaux', items.length === 0 || items.some(i => !i.description), 'bloquant')
  add('items_units', 'Unités et quantités', 'Chaque ligne doit indiquer la quantité et l\'unité de mesure.', 'description_travaux', items.some(i => !i.unit || i.quantity <= 0), 'important')
  add('items_pu', 'Prix unitaire HT', 'Le prix unitaire HT doit figurer pour chaque prestation.', 'description_travaux', items.some(i => i.unit_price <= 0), 'bloquant')

  // ── 4. Prix et montants ───────────────────────────────────────────────────────
  add('total_ht', 'Total HT', 'Le montant total HT doit apparaître clairement.', 'prix', !quote.total_ht || quote.total_ht <= 0, 'bloquant')
  add('total_ttc', 'Total TTC', 'Le montant total TTC doit apparaître clairement (si assujetti TVA).', 'prix', hasVat && (!quote.total_ttc || quote.total_ttc <= 0), 'bloquant')

  // ── 5. TVA ────────────────────────────────────────────────────────────────────
  add('vat_rate_per_line', 'Taux de TVA par ligne', 'Le taux de TVA applicable doit être indiqué sur chaque ligne de prestation.', 'tva', hasVat && vatRates.some(r => r === 0 && hasVat), 'important')
  add('vat_mention_exempt', 'Mention franchise TVA', 'Si non assujetti, la mention "TVA non applicable, art. 293B du CGI" est obligatoire.', 'tva', !hasVat && !allText.includes('293b'), 'bloquant')
  add('vat_5_5_mention', 'Attestation TVA 5,5% ou 10%', 'Pour les travaux à taux réduit (rénovation énergétique), une attestation de TVA réduite doit être jointe ou mentionnée.', 'tva', vatRates.some(r => r === 5.5 || r === 10) && !allText.includes('attestation'), 'important')

  // ── 6. Délais ─────────────────────────────────────────────────────────────────
	  add('start_date', 'Délai prévisionnel de début des travaux', 'Indiquer une date ou un délai estimatif suffit si le chantier n\'est pas encore planifié, par exemple "démarrage prévisionnel sous 4 à 6 semaines après acceptation du devis".', 'delai', !hasExecutionStartEstimate, 'important')
	  add('end_date', 'Durée ou délai prévisionnel d\'exécution', 'La durée prévisionnelle ou la date estimative de fin des travaux doit être indiquée.', 'delai', !allText.includes('durée') && !allText.includes('duree') && !allText.includes('semaine') && !allText.includes('jour') && !allText.includes('mois') && !allText.includes('fin de travaux') && !allText.includes('planning') && !allText.includes('calendrier') && !allText.includes('prévision') && !allText.includes('prevision') && !allText.includes('estim'), 'important')

  // ── 7. Garanties et assurances ────────────────────────────────────────────────
  add('insurance_decennale', 'Assurance décennale', 'La mention de l\'assurance de responsabilité décennale est obligatoire pour les travaux relevant de la garantie décennale (art. L241-1 Code des assurances).', 'garanties', !!org.decennale_enabled && !org.insurance_info, 'bloquant')
  add('insurance_rc', 'Assurance RC professionnelle', 'La mention de l\'assurance responsabilité civile professionnelle est obligatoire.', 'garanties', !org.insurance_info, 'important')
  add('garantie_parfait_achevement', 'Garantie de parfait achèvement', 'La garantie de parfait achèvement (1 an) peut être mentionnée pour rassurer le client (recommandé BTP).', 'garanties', !allText.includes('parfait achèvement') && !allText.includes('parfait achevement'), 'info')
  add('garantie_biennale', 'Garantie biennale', 'La garantie biennale (2 ans, équipements dissociables) peut être mentionnée.', 'garanties', !allText.includes('biennale') && !allText.includes('deux ans') && !allText.includes('2 ans'), 'info')
  add('garantie_decennale', 'Garantie décennale', 'La garantie décennale (10 ans, solidité et impropriété à destination) doit être mentionnée si applicable.', 'garanties', !!org.decennale_enabled && !allText.includes('décennale') && !allText.includes('decennale'), 'important')

  // ── 8. Conditions de paiement ─────────────────────────────────────────────────
	  add('payment_terms', 'Délai de paiement', 'Les modalités et délais de paiement doivent être indiqués.', 'paiement', !org.payment_terms_days && !paymentCond.includes('paiement') && !paymentCond.includes('règlement'), 'bloquant')
	  add('late_penalty', 'Pénalités de retard', 'Le taux des pénalités de retard est requis pour les clients professionnels et repris automatiquement sur le PDF si configuré dans les paramètres.', 'paiement', isClientPro && !org.late_penalty_rate && !allText.includes('pénalités') && !allText.includes('penalites') && !allText.includes('retard'), 'important')
	  add('recovery_indemnity', 'Indemnité forfaitaire de recouvrement 40€', 'Mention applicable aux clients professionnels. Le PDF l\'ajoute automatiquement si un taux de pénalités de retard est configuré.', 'paiement', isClientPro && !hasPdfRecoveryIndemnity && !allText.includes('40') && !allText.includes('indemnité forfaitaire') && !allText.includes('recouvrement'), 'important')
  add('iban', 'Coordonnées bancaires (IBAN)', 'Les coordonnées bancaires pour le virement doivent figurer si le paiement par virement est proposé.', 'paiement', !org.iban, 'info')
  add('acompte_mention', 'Modalités d\'acompte', 'Si un acompte est demandé, son montant ou pourcentage doit être précisé.', 'paiement', !allText.includes('acompte') && !allText.includes('avance'), 'info')

  // ── 9. Mentions diverses ──────────────────────────────────────────────────────
	  add('droit_retractation', 'Délai de rétractation (particuliers)', 'À mentionner pour un client particulier lorsque le devis est accepté à la suite d\'un démarchage ou hors établissement. Non applicable aux travaux/réparations d\'urgence.', 'divers', isClientIndividual && !allText.includes('rétractation') && !allText.includes('retractation') && !allText.includes('hors établissement') && !allText.includes('hors etablissement'), 'info')
	  add('signature_client', 'Signature et date client', 'Le PDF Atelier prévoit déjà le bloc "Bon pour accord, date et signature".', 'divers', false /* géré par le PDF Atelier */, 'info')
  add('numero_devis', 'Numérotation du devis', 'Le devis doit avoir un numéro unique pour le suivi.', 'divers', false /* géré par Atelier */, 'info')
  add('mentions_complementaires', 'Travaux supplémentaires', 'Indiquer les modalités de facturation des travaux imprévus ou supplémentaires.', 'divers', !allText.includes('avenant') && !allText.includes('supplément') && !allText.includes('supplement') && !allText.includes('imprévu'), 'info')
  add('tribunal_competent', 'Tribunal compétent', 'En cas de litige, le tribunal compétent peut être précisé (recommandé pour clients pro).', 'divers', !allText.includes('litige') && !allText.includes('tribunal') && !allText.includes('juridiction'), 'info')

  return checks
}

export function countMissingByCategory(checks: BtpMentionCheck[]) {
  const missing = checks.filter(c => c.missing)
  return {
    total: missing.length,
    bloquant: missing.filter(c => c.severity === 'bloquant').length,
    important: missing.filter(c => c.severity === 'important').length,
    info: missing.filter(c => c.severity === 'info').length,
  }
}
