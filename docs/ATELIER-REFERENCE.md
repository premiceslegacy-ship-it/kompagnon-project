# Atelier — Document de référence produit

> Dernière mise à jour : avril 2026.
> Ce document est la source de vérité pour comprendre ce qu'est Atelier, à qui il s'adresse, ce qu'il fait, ce qu'il ne fait pas encore, et à quel prix. Il sert de base pour élaborer les stratégies commerciales, les contenus réseaux, les ads et l'outreach.

---

## 1. Ce qu'est Atelier en une phrase

Atelier est le premier outil de gestion pensé pour l'artisan BTP qui pilote son activité depuis son téléphone — devis, chantiers, équipe, rentabilité, et un agent WhatsApp qui travaille à sa place.

---

## 2. ICP — Le client idéal

### Profil primaire

**L'artisan-patron BTP 2nd oeuvre, 2 à 8 personnes, 200k à 800k€ de CA.**

Il dirige sa boîte depuis le terrain. Il gère les devis le soir sur la table de la cuisine, répond à ses clients sur WhatsApp personnel, oublie de relancer, ne sait jamais si un chantier est vraiment rentable avant d'avoir tout payé. Il déteste l'administratif mais il sait que c'est là qu'il perd de l'argent.

| Critère | Détail |
|---------|--------|
| Corps de métier cibles | Électricité, plomberie/CVC, menuiserie, tôlerie, peinture, plâtrerie/isolation, paysagisme |
| Taille | Patron + 1 à 7 personnes (ouvriers, sous-traitants, intérimaires) |
| CA | 200k à 800k€/an |
| Rapport au digital | Smartphone oui, ERP jamais. Il utilise Word, Excel, ou un logiciel vieillissant (EBP, Batappli, Sage) |
| Douleur n°1 | Les devis prennent trop de temps et les relances sont oubliées |
| Douleur n°2 | Il ne sait pas si ses chantiers sont rentables avant de les avoir terminés |
| Douleur n°3 | La gestion de l'équipe (heures, planning, communication) est un chaos de messages WhatsApp |
| Douleur n°4 | Il a peur de la facturation électronique obligatoire en 2026 et ne sait pas comment s'y préparer |

### Profil secondaire

**L'artisan avec équipe structurée, 8 à 15 personnes, 800k à 2M€ de CA.**

Il a déjà un comptable, peut-être une secrétaire. Il cherche à professionnaliser sa gestion de chantier et à avoir une visibilité en temps réel sur la rentabilité. Le module WhatsApp agent a une valeur quotidienne concrète pour lui — ses chefs d'équipe pointent leurs heures sans avoir à revenir au bureau.

### Métiers et niveau de fit

| Métier | Fit actuel | Raison principale |
|--------|-----------|-------------------|
| Tôlerie / métallerie | Excellent | Catalogue dimensionnel (ml, m²) natif, devis complexes multi-lignes |
| Menuiserie / agencement | Excellent | Tarification au m², variantes matière, chantiers avec jalons |
| Électricité / plomberie / CVC | Très bon | Devis rapides, acomptes, chantiers récurrents, catalogue par profil |
| Peinture / plâtrerie | Très bon | Tarification m², formulaire public devis, relances auto |
| Plaquiste / isolation | Très bon | Pose + fourniture, devis dimensionnel, acomptes |
| Charpente / couverture | Bon | Rien de bloquant, catalogue à enrichir côté matériaux |
| Maçonnerie / gros oeuvre | Bon | Chantiers longs, équipes, rentabilité — manque : situations de travaux / avancement % |
| Paysagisme | Bon | Factures récurrentes entretien, catalogue saisonnier |
| Nettoyage professionnel | Moyen | Factures récurrentes OK — manque planning tournées multi-sites et contrats de prestation |

**Règle de ciblage commercial :** se concentrer sur les métiers "Excellent" et "Très bon". Ne pas vendre aux métiers "Moyen" sans les modules adaptés — risque de clients insatisfaits.

---

## 3. Fonctionnalités complètes de l'app

### 3.1 Facturation et commercial

| Fonctionnalité | Détail |
|----------------|--------|
| Devis numérotés | Format DEV-XXXX-001, éditeur lignes, sous-total, TVA configurable |
| Tarification dimensionnelle | Prix au m², ml, m³ — calcul automatique selon dimensions saisies |
| Variantes tarifaires | Plusieurs grilles de prix selon le profil métier (BTP, Paysage, Nettoyage, Industrie) |
| Acomptes | Création en montant fixe ou % du devis, numérotation séparée |
| Aide/subvention déductible | MaPrimeRénov, CEE — affiché sur le PDF avec le reste à charge client |
| Signature électronique | Signature client sur le devis depuis un lien email |
| Factures numérotées | Format FAC-XXXX-001, conversion directe depuis devis accepté |
| Factures d'acompte | Avec balance_due_date (échéance du solde restant) |
| Factures récurrentes | Génération automatique + auto-envoi configurable (délai en jours après création) |
| Relances automatiques | Cron quotidien 8h Paris — relance devis et factures en retard, email rédigé par IA |
| Import document PDF/image | Extraction automatique des lignes depuis un bon de commande ou un document fournisseur |
| Formulaire public devis | Page `/demande/<slug>` — le client remplit sa demande, l'artisan reçoit une notification |
| CGV sur PDF | Texte CGV configurable dans Settings, affiché en pied de page des documents |
| Signature email | Bloc signature personnalisé ajouté à tous les emails sortants |
| Durée de validité | Configurable par organisation (défaut 30 jours) |
| Export comptable | ZIP de réversibilité complet (owner uniquement) |

### 3.2 Clients et catalogue

| Fonctionnalité | Détail |
|----------------|--------|
| Fiche client | Historique CA, factures, devis, contact référent, locale |
| Catalogue articles/services | CRUD complet, tarification dimensionnelle, sections, compositions |
| Prestations types | Templates de devis réutilisables avec lignes pré-remplies |
| Fournisseurs | Table fournisseurs avec lien vers les matériaux du catalogue |
| Saisie IA catalogue | Décrire un article en langage naturel → champs remplis automatiquement |
| Activité métier | Profil BTP/Paysage/Nettoyage/Industrie — filtre le catalogue et les suggestions IA |

### 3.3 Chantiers

| Fonctionnalité | Détail |
|----------------|--------|
| Fiche chantier | Titre, ville, client, budget HT, dates, statut, contact référent, marge cible (%) |
| Tâches | Drag & drop, assignation membre, statut, ordre |
| Jalons | Livrables avec date planifiée et statut — vue timeline |
| Suggestions IA tâches et jalons | L'IA propose une liste de tâches et jalons selon le type de chantier |
| Planning calendrier | Vue semaine/mois par chantier, par équipe, par membre individuel |
| Pointages heures | Saisie par chantier, par tâche, par membre — vue globale inter-chantiers |
| Équipes | Création d'équipes, assignation à un chantier |
| Membres individuels | Sans équipe parente, sans compte auth — accès via magic link `/mon-espace` |
| Espace membre | Le membre voit ses créneaux, pointe ses heures, peut demander son rapport |
| Rapport mensuel heures | Email PDF envoyé automatiquement au membre (1er du mois, si activé) |
| Notes de chantier | Journal horodaté, visible par toute l'équipe |
| Photos chantier | Upload, titre, flag "inclure dans rapport", partage client horodaté |
| Rapport chantier PDF | Généré avec sélection de photos + intro rédigée par IA |
| Rentabilité | CA chantier vs coûts réels : MO (taux horaire org/membre) + dépenses catégorisées |
| Dépenses chantier | Matériel, sous-traitance, location (avec équipements par secteur), transport carburant (km × conso × prix/L), lien catalogue |
| Marge cible | Alerte visuelle si les coûts dépassent le budget cible défini au lancement |
| Lien facture → chantier | Rattachement explicite d'une facture à un chantier (utilisé dans la rentabilité) |
| Assistant IA chantier | Chat contextuel sur le chantier — résume, suggère, répond |

### 3.4 Dashboard et pilotage

| Fonctionnalité | Détail |
|----------------|--------|
| Résumé "Ma semaine" | Synthèse IA de l'activité : devis en attente, factures à relancer, chantiers en retard |
| Planification semaine IA | L'IA propose un plan de la semaine selon les chantiers et la charge |
| Tâches urgentes | Widget dashboard — tâches en retard ou à faire aujourd'hui |
| Chantiers à risque | Vue des chantiers dont la marge cible est en danger |

### 3.5 Settings et conformité

| Fonctionnalité | Détail |
|----------------|--------|
| Profil entreprise | Logo, adresse, SIRET, téléphone, email |
| Assurance décennale | Champs structurés (assureur, numéro police, dates, zone) |
| IBAN / RIB | Affiché sur les PDFs factures |
| TVA | Configurable par taux, par organisation |
| Rôles et permissions | Owner, Admin, Manager, Collaborateur — permissions granulaires |
| Modules IA | Activation par module (quote_ai, planning_ai, whatsapp_agent…) depuis le cockpit |
| Mémoire entreprise | Contexte métier injecté dans tous les prompts IA (tarifs, process, clients types) |
| Données et confidentialité | Export complet + workflow de suppression organisation |
| Facturation électronique | Structure Factur-X préparée, IBAN/SIREN, prêt pour B2Brouter (sept. 2026) |

### 3.6 WhatsApp agent

Voir section 4 pour le détail complet.

---

## 4. Agent WhatsApp — détail complet

### Ce que c'est

Un agent conversationnel qui tourne 24h/24 sur le numéro bot Atelier (mode mutualisé) ou sur le numéro Meta propre du client (mode WABA). Il comprend le langage naturel, accède à toutes les données de l'organisation en temps réel, et peut lire comme écrire. Il connaît le contexte de l'entreprise via la mémoire RAG injectée à chaque conversation.

### Les 17 outils disponibles

**Lecture / contexte**

| Outil | Ce qu'il fait concrètement |
|-------|---------------------------|
| `get_resume` | Situation globale instantanée : chantiers en cours, factures impayées, devis en attente, acomptes |
| `get_chantiers` | Liste des chantiers actifs avec statut, ville, progression tâches, contact référent |
| `get_planning_day` | Planning d'une journée : chantiers actifs, tâches échéantes, heures déjà pointées |
| `get_factures_impayees` | Factures en retard avec montant, client, nombre de jours de retard |
| `get_acomptes` | Acomptes en attente ou partiellement encaissés |
| `get_prestation_types` | Catalogue complet avec tarifs et variantes — appelé avant création de devis |
| `get_chantier_profitability` | Rentabilité d'un chantier : CA vs coûts réels (MO + dépenses) |
| `get_chantiers_at_risk` | Chantiers dont la marge cible est dépassée ou en danger |

**Écriture — chantiers**

| Outil | Ce qu'il fait concrètement |
|-------|---------------------------|
| `add_pointage` | Saisit des heures sur un chantier (recherche par mots-clés, date libre, description) |
| `add_note_chantier` | Ajoute une note horodatée au journal de chantier |
| `update_chantier_status` | Change le statut : planifié / en cours / suspendu / terminé / annulé |
| `update_chantier_planning` | Déplace ou reprogramme un chantier dans le calendrier (date début + fin) |
| `add_chantier_expense` | Enregistre une dépense catégorisée (matériel, sous-traitance, transport…) avec FK fournisseur optionnel |

**Écriture — commercial**

| Outil | Ce qu'il fait concrètement |
|-------|---------------------------|
| `create_quote` | Crée un devis brouillon avec lignes catalogue, variantes tarifaires, notes d'introduction |
| `send_quote` | Envoie un devis par email avec PDF joint |
| `create_invoice_from_quote` | Convertit un devis accepté en facture |
| `send_invoice` | Envoie une facture par email avec PDF joint |
| `create_acompte` | Crée un acompte sur devis en montant fixe ou pourcentage du total |

### Exemple de conversation réelle

> "Ça s'est bien passé ce matin chez Martin, j'ai posé 4h. Envoie-moi la facture du devis qu'on avait fait."
>
> → L'agent pointe 4h sur le chantier Martin, cherche le devis correspondant, crée la facture et l'envoie par email au client. Il répond : "C'est fait — FAC-2026-012 envoyée à martin@gmail.com."

### Limites actuelles de l'agent

| Limitation | Impact | Priorité à corriger |
|-----------|--------|-------------------|
| Ne connaît pas les membres assignés à un chantier | Il ne peut pas dire "qui travaille sur Martin cette semaine" | Haute |
| `add_pointage` pointe toujours sur l'owner, pas sur le membre qui écrit | Un chef d'équipe qui envoie le message pointe les heures au nom du patron | Haute |
| Pas de `get_planning_membre` | Impossible de demander "quel est le planning de Jean cette semaine" | Moyenne |
| Pas d'`assign_tache` | Ne peut pas attribuer une tâche à un membre depuis WhatsApp | Moyenne |
| Pas de lecture des notes ou photos existantes | Peut écrire une note mais ne peut pas lire les notes précédentes | Basse |
| Pas de création de chantier | Peut gérer un chantier existant mais pas en créer un nouveau | Basse |

---

## 5. Bénéfices client — par douleur

| Douleur | Ce que l'app résout | Bénéfice mesurable |
|---------|--------------------|--------------------|
| Devis lents | Catalogue + tarification dimensionnelle + IA analyse → devis en 5 min | -70% de temps devis |
| Relances oubliées | Cron quotidien automatique, email rédigé par IA | 0 relance oubliée |
| Rentabilité inconnue | Suivi coûts réel vs budget + marge cible + alerte | Visibilité en temps réel |
| Planning chaotique | Vue calendrier + planning IA semaine + WhatsApp agent | 1 seul endroit pour tout |
| Heures perdues | Pointage WhatsApp depuis le terrain sans ouvrir l'app | -30 min/jour d'admin |
| Équipe à gérer | Espace membre magic link, rapport mensuel auto, planning individuel | Zéro friction pour l'ouvrier |
| Peur 2026 | Structure Factur-X prête, B2Brouter intégrable, IBAN/SIREN dans les docs | Conformité sans stress |

---

## 6. Angles morts et limites actuelles

### Fonctionnels

| Manque | Impact métier | Effort estimé |
|--------|--------------|---------------|
| Situations de travaux (facturation % avancement) | Bloquant pour maçonnerie / gros oeuvre | Moyen — extension éditeur facture |
| Planning par tournée multi-sites | Bloquant pour nettoyage | Gros — nouveau module |
| Retenue de garantie (5%) | Bloquant pour sous-traitance | Petit — champ facture |
| PV de réception / DOE | Bloquant pour promotion immobilière | Moyen — nouveau document |
| Import/export comptable FEC | Attendu par les comptables | Moyen |
| Multi-organisations (holding) | Rare mais bloquant pour gros clients | Moyen |
| Application mobile native | L'app est PWA — fonctionne mais pas dans l'App Store | Gros |

### Agent WhatsApp

Voir section 4 — limites détaillées.

### Positionnement

- Pas de période d'essai automatisée (onboarding manuel pour l'instant)
- Pas de marketplace / annuaire pour générer des leads organiques
- Pas d'intégration comptable directe (Pennylane, Indy, Axonaut)

---

## 7. Modèles IA utilisés et logique de coût

| Fonctionnalité | Modèle | Pourquoi ce choix |
|----------------|--------|-------------------|
| Relances auto (cron) | Claude Haiku 4.5 | Qualité rédactionnelle nécessaire pour un email client |
| Brouillon relance (modal) | Claude Haiku 4.5 | Idem |
| Intro email rapport chantier | Claude Haiku 4.5 | Ton professionnel requis |
| Résumé "Ma semaine" | Gemini 2.5 Flash Lite | Volume élevé, contexte long, coût prioritaire |
| Planification semaine IA | DeepSeek V4 Flash | Raisonnement planning, très bon rapport qualité/coût |
| Analyse devis (texte/image) | Gemini 2.5 Flash Lite | Vision + vitesse + coût |
| Estimation main d'oeuvre | Gemini 2.5 Flash Lite | Calcul structuré, coût minimal |
| Suggestions tâches et jalons | Gemini 2.5 Flash Lite | Génération de listes, coût minimal |
| Assistant chantier | Claude Haiku 4.5 | Conversation contextuelle, ton adapté |
| Import document PDF/image | Gemini 2.5 Flash Lite + fallback Sonnet 4.6 | Vision économique avec filet de sécurité |
| Transcription vocale (app + WA) | Voxtral Mini (Mistral direct) | Spécialisé STT, français natif |
| WhatsApp agent | Gemini 2.5 Flash | Raisonnement + outils + vitesse de réponse |
| Saisie catalogue IA | Gemini 2.5 Flash | Extraction structurée, vision si photo |
| Embeddings mémoire | Qwen3-Embedding-8B 4096 dims | Meilleure qualité sémantique en français |

---

## 8. Coûts réels par client / mois

### Infrastructure

| Service | Coût | Seuil |
|---------|------|-------|
| Supabase | 0€ | Jusqu'à 500MB DB, 50k MAU |
| Supabase Pro | ~23€ | Au-delà |
| Cloudflare Workers | 0€ | Jusqu'à ~400 clients actifs (100k req/jour partagées) |
| Cloudflare Workers Paid | ~5€ | Au-delà |
| Resend | 0€ | Jusqu'à 3k emails/mois |
| Resend payant | ~18€ | Au-delà |
| Domaine | ~0,85€ | Fixe |

### IA — coût mensuel par profil

| Profil | Hypothèses | Coût IA/mois |
|--------|-----------|-------------|
| Essentiel (sans WhatsApp) | 5 devis, 8 relances, 4 résumés semaine | ~0,05€ |
| Pro (sans WhatsApp) | 15 devis, 20 relances, 8 résumés, plannings IA | ~0,12€ |
| Expert (WhatsApp modéré) | +50 messages WA, 5 min vocal | ~0,30€ |
| Expert (WhatsApp intensif) | +150 messages WA, 20 min vocal | ~0,65€ |

### Coût total réel par client (phase early, free tier)

| Situation | Coût total/mois |
|-----------|----------------|
| Sans WhatsApp, free tier | 0,05 à 0,15€ |
| Avec WhatsApp modéré, free tier | ~0,30€ |
| Avec WhatsApp intensif, free tier | ~0,70€ |
| Worst case (Supabase Pro + Resend payant + WA intensif) | ~45€ |

---

## 9. Pricing recommandé

### Setup one-shot

| Prestation | Prix HT |
|-----------|---------|
| Déploiement standard (sans WhatsApp) | 500€ |
| Déploiement avec WhatsApp agent (config Meta + test) | 800€ |
| Activation B2Brouter (facturation électronique) | +190€ |
| Abonnement B2Brouter an 1 (M1, payé d'avance) | +480€ |

### Abonnements mensuels

| Tier | Nom | Prix HT/mois | Contenu | Marge brute |
|------|-----|-------------|---------|-------------|
| 1 | Essentiel | 59€ | Devis + Factures + Catalogue + Relances auto + 1 user | ~99% |
| 2 | Pro | 99€ | Tout + Chantiers complets + Équipe 5 membres + IA de base | ~99% |
| 3 | Expert | 149€ | Tout + WhatsApp agent + IA avancée + membres illimités | ~99% |
| 4 | Expert + Fact. élec. | 189€ | Tout + B2Brouter intégré (réception sept. 2026) | ~87% |

### Logique tarifaire

- Ne pas descendre sous 59€ au Starter — Obat démarre à 59€ sans WhatsApp ni chantiers complets. Se positionner en dessous envoie le mauvais signal.
- Ne pas inclure B2Brouter dans l'abonnement de base — le conditionner à l'activation pour ne pas porter un coût fixe sur des clients qui ne l'utilisent pas.
- Le WhatsApp agent est le seul différenciateur incopiable à court terme sur ce marché — le mettre en avant dans tous les supports.

---

## 10. Concurrents et positionnement

| Concurrent | Prix | Ce qu'ils font | Ce qu'Atelier fait de plus |
|-----------|------|---------------|--------------------------|
| Batappli | 79-199€/mois | Devis, factures, chantiers basiques | WhatsApp agent, rentabilité granulaire, IA intégrée |
| Obat | 59-149€/mois | Devis, factures, planning simple | Idem + mémoire entreprise, formulaire public |
| Sellsy | 99-199€/mois | CRM + facturation généraliste | Spécialisé BTP, modules chantier, agent WA |
| Batigest | 150-300€/mois | ERP BTP complet, lourd | Légèreté, mobile-first, prix, IA |
| Excel/Word | 0€ | Rien d'automatique | Tout |

**Territoire : entre Obat (trop simple) et Batigest (trop lourd).** Atelier est le seul outil mobile-first avec un agent WhatsApp qui travaille à la place de l'artisan.

---

## 11. Arguments commerciaux clés

**Pour l'outreach et les ads — par angle d'attaque**

### Angle temps
> "Tes devis te prennent 2h. Avec Atelier, 10 minutes."
> "Tes relances partent toutes seules. Tu ne rates plus un paiement."

### Angle argent
> "Tu sais enfin si tes chantiers sont rentables — avant d'avoir tout payé."
> "Un client qui te paye en retard coûte cher. Atelier relance à ta place."

### Angle WhatsApp
> "Tu gères déjà tout depuis WhatsApp. Autant que ça soit intelligent."
> "Depuis le chantier : 'pointe 4h sur Martin et envoie la facture'. C'est fait."

### Angle conformité 2026
> "La facturation électronique devient obligatoire en septembre 2026. Atelier est déjà prêt."

### Angle équipe
> "Ton ouvrier pointe ses heures depuis WhatsApp. Tu vois tout en temps réel."

---

## 12. Ce qui vient ensuite (roadmap connue)

### Agent WhatsApp — prochaines fonctions prioritaires
- Lecture des membres et équipes par chantier (`get_equipe_chantier`)
- Pointage attribué au membre qui écrit, pas à l'owner (`member_id` dans `add_pointage`)
- Planning par membre (`get_planning_membre`)
- Attribution de tâche à un membre (`assign_tache`)
- Création de chantier depuis WhatsApp (`create_chantier`)

### App
- Situations de travaux (facturation % avancement) → ouvre le marché maçonnerie/gros oeuvre
- Retenue de garantie 5% → sous-traitance
- Intégration comptable (Pennylane, Indy)
- Période d'essai automatisée (onboarding sans intervention manuelle)
